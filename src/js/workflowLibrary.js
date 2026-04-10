'use strict';

// Storage providers — we try localStorage first, fall back to sessionStorage,
// and finally to a plain in-memory store so the app runs even in restricted environments.

var LocalStorageProvider = {
  name: 'localStorage',
  getItem: function(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  },
  setItem: function(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      if (e instanceof DOMException && (
        e.code === 22 || e.code === 1014 ||
        e.name === 'QuotaExceededError' ||
        e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
      )) {
        throw { code: 'QUOTA_EXCEEDED', original: e };
      }
      throw { code: 'STORAGE_UNAVAILABLE', original: e };
    }
  },
  removeItem: function(key) {
    try { localStorage.removeItem(key); } catch (_) {}
  },
  keys: function() {
    var result = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        result.push(localStorage.key(i));
      }
    } catch (_) {}
    return result;
  },
};

var SessionStorageProvider = {
  name: 'sessionStorage',
  getItem: function(key) {
    try { return sessionStorage.getItem(key); } catch (_) { return null; }
  },
  setItem: function(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch (e) {
      if (e instanceof DOMException && (
        e.code === 22 || e.code === 1014 ||
        e.name === 'QuotaExceededError' ||
        e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
      )) {
        throw { code: 'QUOTA_EXCEEDED', original: e };
      }
      throw { code: 'STORAGE_UNAVAILABLE', original: e };
    }
  },
  removeItem: function(key) {
    try { sessionStorage.removeItem(key); } catch (_) {}
  },
  keys: function() {
    var result = [];
    try {
      for (var i = 0; i < sessionStorage.length; i++) {
        result.push(sessionStorage.key(i));
      }
    } catch (_) {}
    return result;
  },
};

var InMemoryProvider = (function() {
  var store = {};
  return {
    name: 'memory',
    getItem: function(key) { return (key in store) ? store[key] : null; },
    setItem: function(key, value) { store[key] = String(value); },
    removeItem: function(key) { delete store[key]; },
    keys: function() { return Object.keys(store); },
  };
})();

var _provider = null;
var _initialized = false;
var _lastInitResult = { provider: 'unknown', migrated: false };

function selectStorageProvider() {
  var testKey = '__swf_probe__';
  try {
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return LocalStorageProvider;
  } catch (_) {}
  try {
    sessionStorage.setItem(testKey, '1');
    sessionStorage.removeItem(testKey);
    return SessionStorageProvider;
  } catch (_) {}
  return InMemoryProvider;
}

function getProvider() {
  if (!_provider) throw new Error('WorkflowLibrary not initialized');
  return _provider;
}

// Small utility functions used throughout the library: UUID generation, CRC32
// checksums for corruption detection, human-readable relative timestamps,
// HTML escaping, and a simple deep-merge for settings objects.

function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, function(c) {
      return (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16);
    });
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function crc32(str) {
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i);
    for (var j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0');
}

function relativeTime(isoString) {
  var diff = Date.now() - new Date(isoString).getTime();
  var seconds = Math.floor(diff / 1000);
  if (seconds < 60)    return 'Just now';
  if (seconds < 3600)  return Math.floor(seconds / 60) + ' min ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + ' hr ago';
  return Math.floor(seconds / 86400) + ' days ago';
}

function _escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function deepMerge(target, source) {
  var result = Object.assign({}, target);
  Object.keys(source).forEach(function(key) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  });
  return result;
}

// The index is a lightweight JSON array (swf_library_index) that lists every
// workflow's metadata without loading the actual content. These helpers read,
// write, patch, and remove entries from it.

function _readIndex() {
  try {
    var raw = getProvider().getItem('swf_library_index');
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (_) { return []; }
}

function _writeIndex(entries) {
  try {
    getProvider().setItem('swf_library_index', JSON.stringify(entries));
  } catch (e) {
    throw e;
  }
}

function _updateIndexEntry(id, patch) {
  var entries = _readIndex();
  var idx = entries.findIndex(function(e) { return e.id === id; });
  if (idx === -1) return false;
  entries[idx] = Object.assign({}, entries[idx], patch);
  _writeIndex(entries);
  return true;
}

function _removeFromIndex(id) {
  var entries = _readIndex().filter(function(e) { return e.id !== id; });
  _writeIndex(entries);
}

// Each workflow's full content lives in its own key (swf_wf_{id}), so loading
// one workflow doesn't pull the entire library into memory. These helpers
// read, write, and build those records along with their index entries.

function _readRecord(id) {
  try {
    var raw = getProvider().getItem('swf_wf_' + id);
    if (!raw) return { ok: false, error: 'RECORD_NOT_FOUND' };
    var record = JSON.parse(raw);
    return { ok: true, record: record };
  } catch (_) {
    return { ok: false, error: 'INVALID_JSON' };
  }
}

function _writeRecord(record) {
  getProvider().setItem('swf_wf_' + record.id, JSON.stringify(record));
}

function _extractMeta(content) {
  try {
    var json = JSON.parse(content);
    return {
      name: json.name || json.id || 'Unnamed Workflow',
      specVersion: json.specVersion || '0.7',
      stateCount: Array.isArray(json.states) ? json.states.length : 0,
    };
  } catch (_) {
    return { name: 'Unnamed Workflow', specVersion: '0.7', stateCount: 0 };
  }
}

function _buildRecordAndEntry(id, content, name, description, tags, createdAt) {
  var now = new Date().toISOString();
  var at = createdAt || now;
  var checksum = crc32(content);
  var meta = _extractMeta(content);

  var record = {
    id: id,
    schemaVersion: '1',
    checksum: checksum,
    content: content,
    contentEncoding: 'none',
    createdAt: at,
    modifiedAt: now,
  };

  var indexEntry = {
    id: id,
    name: name || meta.name,
    description: description || '',
    createdAt: at,
    modifiedAt: now,
    specVersion: meta.specVersion,
    stateCount: meta.stateCount,
    tags: tags || [],
    sizeBytes: content.length * 2,
  };

  return { record: record, indexEntry: indexEntry };
}

// User preferences (sidebar state, sort order, etc.) persisted to swf_settings.
// Defaults are deep-merged at read time so adding a new setting never breaks
// existing stored data.

var Settings = {
  _defaults: {
    schemaVersion: '1',
    autosave: { enabled: true },
    sidebar: { collapsed: false, width: 260, sortBy: 'modifiedAt-desc' },
    editor: { confirmOnLoad: true, mirrorToLegacyKey: true },
  },

  load: function() {
    try {
      var raw = getProvider().getItem('swf_settings');
      if (!raw) return JSON.parse(JSON.stringify(this._defaults));
      return deepMerge(JSON.parse(JSON.stringify(this._defaults)), JSON.parse(raw));
    } catch (_) {
      return JSON.parse(JSON.stringify(this._defaults));
    }
  },

  save: function(patch) {
    var current = this.load();
    var updated = deepMerge(current, patch);
    try { getProvider().setItem('swf_settings', JSON.stringify(updated)); } catch (_) {}
    return updated;
  },

  get: function(path) {
    return path.split('.').reduce(function(obj, k) {
      return obj && obj[k] !== undefined ? obj[k] : undefined;
    }, this.load());
  },
};

// One-time migration: on the first run of the new library, we pick up whatever
// was stored in the old lastSWFJson key and bring it into the library as a
// proper named workflow.

function migrateIfNeeded() {
  var stored = parseInt(getProvider().getItem('swf_schema_version') || '0', 10);
  if (stored >= 1) return;
  // v0→v1: index structure unchanged; legacy content handled by migrateLegacyWorkflow
  try { getProvider().setItem('swf_schema_version', '1'); } catch (_) {}
}

// WorkflowLibrary is the main object the rest of the app talks to. It exposes
// create, read, update, delete, search, export, and import operations, plus
// active-workflow tracking and library-wide utilities like repair and migration.

var WorkflowLibrary = {

  init: function() {
    if (_initialized) return _lastInitResult;
    _initialized = true;

    _provider = selectStorageProvider();
    migrateIfNeeded();
    var migrationResult = this.migrateLegacyWorkflow();
    this.repairLibrary();

    _lastInitResult = { provider: _provider.name, migrated: migrationResult.migrated };
    return _lastInitResult;
  },

  getProviderName: function() {
    return _provider ? _provider.name : 'unknown';
  },

  // Index access — read and sort the lightweight metadata list without
  // touching individual workflow content records.

  listWorkflows: function(sortBy) {
    var sort = sortBy || Settings.get('sidebar.sortBy') || 'modifiedAt-desc';
    var entries = _readIndex();
    return entries.slice().sort(function(a, b) {
      switch (sort) {
        case 'modifiedAt-asc':  return a.modifiedAt.localeCompare(b.modifiedAt);
        case 'name-asc':        return a.name.localeCompare(b.name);
        case 'name-desc':       return b.name.localeCompare(a.name);
        case 'createdAt-desc':  return b.createdAt.localeCompare(a.createdAt);
        default:                return b.modifiedAt.localeCompare(a.modifiedAt);
      }
    });
  },

  getIndexEntry: function(id) {
    if (!id) return null;
    return _readIndex().find(function(e) { return e.id === id; }) || null;
  },

  // CRUD operations — create, save, load, rename, duplicate, and delete
  // individual workflows. Each method validates its inputs and returns a
  // result object with an ok flag so callers can react to failures.

  createWorkflow: function(name, jsonContent, description, tags) {
    if (!name || name.trim().length === 0 || name.length > 100) {
      return { ok: false, error: 'NAME_TOO_LONG' };
    }
    if (description && description.length > 300) {
      return { ok: false, error: 'DESCRIPTION_TOO_LONG' };
    }
    if (!jsonContent) jsonContent = '{}';

    var id = generateUUID();
    var built = _buildRecordAndEntry(id, jsonContent, name.trim(), description || '', tags || []);

    try {
      _writeRecord(built.record);
      var entries = _readIndex();
      entries.push(built.indexEntry);
      _writeIndex(entries);
      this.setActiveId(id);
      if (Settings.get('editor.mirrorToLegacyKey')) {
        try { getProvider().setItem('lastSWFJson', jsonContent); } catch (_) {}
      }
      return { ok: true, id: id };
    } catch (e) {
      return { ok: false, error: e.code || 'STORAGE_UNAVAILABLE' };
    }
  },

  saveWorkflow: function(id, jsonContent) {
    var result = _readRecord(id);
    if (!result.ok) return { ok: false, error: 'RECORD_NOT_FOUND' };

    var meta = _extractMeta(jsonContent);
    var now = new Date().toISOString();
    var checksum = crc32(jsonContent);

    var updatedRecord = Object.assign({}, result.record, {
      content: jsonContent,
      checksum: checksum,
      modifiedAt: now,
    });

    try {
      _writeRecord(updatedRecord);
      _updateIndexEntry(id, {
        modifiedAt: now,
        stateCount: meta.stateCount,
        specVersion: meta.specVersion,
        sizeBytes: jsonContent.length * 2,
      });
      if (Settings.get('editor.mirrorToLegacyKey')) {
        try { getProvider().setItem('lastSWFJson', jsonContent); } catch (_) {}
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.code || 'STORAGE_UNAVAILABLE' };
    }
  },

  loadWorkflow: function(id) {
    var result = _readRecord(id);
    if (!result.ok) return result;

    var record = result.record;
    var computed = crc32(record.content);
    if (computed !== record.checksum) {
      return { ok: false, error: 'CHECKSUM_MISMATCH', content: record.content };
    }
    return { ok: true, content: record.content };
  },

  renameWorkflow: function(id, newName, newDescription) {
    if (!newName || newName.trim().length === 0 || newName.length > 100) {
      return { ok: false, error: 'NAME_TOO_LONG' };
    }
    if (newDescription !== undefined && newDescription.length > 300) {
      return { ok: false, error: 'DESCRIPTION_TOO_LONG' };
    }
    var patch = { name: newName.trim() };
    if (newDescription !== undefined) patch.description = newDescription;
    var updated = _updateIndexEntry(id, patch);
    if (!updated) return { ok: false, error: 'RECORD_NOT_FOUND' };
    return { ok: true };
  },

  duplicateWorkflow: function(id, newName) {
    var result = this.loadWorkflow(id);
    if (!result.ok && result.error !== 'CHECKSUM_MISMATCH') {
      return { ok: false, error: result.error };
    }
    var content = result.content;
    var originalEntry = this.getIndexEntry(id);
    var name = newName || (originalEntry ? originalEntry.name + ' (copy)' : 'Workflow (copy)');
    return this.createWorkflow(name, content, originalEntry ? originalEntry.description : '');
  },

  deleteWorkflow: function(id) {
    var entries = _readIndex();
    var exists = entries.some(function(e) { return e.id === id; });
    if (!exists) return { ok: false, error: 'RECORD_NOT_FOUND' };
    _removeFromIndex(id);
    try { getProvider().removeItem('swf_wf_' + id); } catch (_) {}
    if (this.getActiveId() === id) this.setActiveId(null);
    return { ok: true };
  },

  // Search and filter — returns subsets of the index without loading any
  // workflow content. Search matches name, description, and tags.

  searchWorkflows: function(query) {
    var q = (query || '').toLowerCase().trim();
    var all = this.listWorkflows();
    if (!q) return all;
    return all.filter(function(entry) {
      return entry.name.toLowerCase().includes(q) ||
        (entry.description || '').toLowerCase().includes(q) ||
        (entry.tags || []).some(function(t) { return t.toLowerCase().includes(q); });
    });
  },

  filterWorkflows: function(options) {
    var entries = this.listWorkflows();
    if (!options) return entries;
    if (options.specVersions && options.specVersions.length > 0) {
      entries = entries.filter(function(e) { return options.specVersions.includes(e.specVersion); });
    }
    if (typeof options.minStates === 'number') {
      entries = entries.filter(function(e) { return e.stateCount >= options.minStates; });
    }
    if (typeof options.maxStates === 'number') {
      entries = entries.filter(function(e) { return e.stateCount <= options.maxStates; });
    }
    if (options.modifiedAfter) {
      entries = entries.filter(function(e) { return e.modifiedAt >= options.modifiedAfter; });
    }
    if (options.modifiedBefore) {
      entries = entries.filter(function(e) { return e.modifiedAt <= options.modifiedBefore; });
    }
    return entries;
  },

  // Active workflow tracking — remembers which workflow is currently open in
  // the editor so autosave knows where to persist changes.

  setActiveId: function(id) {
    if (id === null || id === undefined) {
      try { getProvider().removeItem('swf_active_id'); } catch (_) {}
    } else {
      try { getProvider().setItem('swf_active_id', id); } catch (_) {}
    }
  },

  getActiveId: function() {
    return getProvider().getItem('swf_active_id');
  },

  // Export and import — handles single-workflow files and full library bundles.
  // Export wraps the raw record in a versioned bundle so imports can round-trip
  // cleanly. Import accepts raw SWF JSON, YAML, or a bundle file.

  exportWorkflow: function(id) {
    var recResult = _readRecord(id);
    if (!recResult.ok) return { ok: false, error: recResult.error };

    var entry = this.getIndexEntry(id);
    var bundle = {
      exportFormat: 'swf-library-export',
      formatVersion: '1',
      exportedAt: new Date().toISOString(),
      workflow: recResult.record,
    };

    var safeName = (entry ? entry.name : 'workflow')
      .replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').toLowerCase();

    return { ok: true, json: JSON.stringify(bundle, null, 2), filename: safeName + '.swf.json' };
  },

  importWorkflow: function(fileContent, filename) {
    if (!fileContent || !fileContent.trim()) {
      return { ok: false, error: 'IMPORT_FORMAT_UNKNOWN' };
    }

    var parsed;
    try { parsed = JSON.parse(fileContent); }
    catch (_) {
      // Try YAML via SDK
      try {
        var wf = serverWorkflowSdk.Specification.Workflow.fromSource(fileContent);
        var asJson = serverWorkflowSdk.Specification.Workflow.toJson(wf);
        var meta = _extractMeta(asJson);
        return this.createWorkflow(meta.name, asJson);
      } catch (_2) {
        return { ok: false, error: 'IMPORT_FORMAT_UNKNOWN' };
      }
    }

    // Case A: Library export bundle
    if (parsed.exportFormat === 'swf-library-export' && parsed.workflow) {
      var wfRecord = parsed.workflow;
      var wfMeta = _extractMeta(wfRecord.content || '{}');
      return this.createWorkflow(wfMeta.name, wfRecord.content || '{}', '');
    }

    // Case B: Raw SWF JSON — validate with SDK
    try { serverWorkflowSdk.Specification.Workflow.fromSource(fileContent); }
    catch (_) { return { ok: false, error: 'IMPORT_FORMAT_UNKNOWN' }; }

    var name = parsed.name || parsed.id ||
      (filename ? filename.replace(/\.(json|yaml|yml)$/i, '') : 'Imported Workflow');
    return this.createWorkflow(name, fileContent);
  },

  exportLibrary: function() {
    var self = this;
    var entries = _readIndex();
    var workflows = entries.map(function(entry) {
      var result = _readRecord(entry.id);
      return result.ok ? result.record : null;
    }).filter(Boolean);

    return JSON.stringify({
      exportFormat: 'swf-library-bundle',
      formatVersion: '1',
      exportedAt: new Date().toISOString(),
      workflowCount: workflows.length,
      workflows: workflows,
    }, null, 2);
  },

  importLibrary: function(bundleJson) {
    var self = this;
    var bundle;
    try { bundle = JSON.parse(bundleJson); }
    catch (_) { return { ok: false, error: 'IMPORT_FORMAT_UNKNOWN' }; }

    if (!bundle.workflows || !Array.isArray(bundle.workflows)) {
      return { ok: false, error: 'IMPORT_FORMAT_UNKNOWN' };
    }

    var imported = 0, skipped = 0;
    var existingIds = _readIndex().map(function(e) { return e.id; });

    bundle.workflows.forEach(function(wf) {
      if (!wf.content) { skipped++; return; }
      if (existingIds.includes(wf.id)) { skipped++; return; }
      var meta = _extractMeta(wf.content);
      var result = self.createWorkflow(meta.name, wf.content);
      if (result.ok) imported++; else skipped++;
    });

    return { ok: true, imported: imported, skipped: skipped };
  },

  // Utility methods — storage usage reporting, library repair (re-syncs the
  // index with actual stored records), and migration from older data formats.

  getStorageUsage: function() {
    var keys = getProvider().keys();
    var used = 0;
    var self = this;
    keys.forEach(function(key) {
      if (key.startsWith('swf_') || key === 'lastSWFJson') {
        var val = getProvider().getItem(key) || '';
        used += (key.length + val.length) * 2;
      }
    });

    var quota = WorkflowLibrary._cachedQuota || null;
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function(est) {
        WorkflowLibrary._cachedQuota = est.quota;
      }).catch(function() {});
    }
    return { used: used, quota: quota };
  },

  _cachedQuota: null,

  repairLibrary: function() {
    var entries = _readIndex();
    var repaired = [];
    var removed = [];

    var validEntries = entries.filter(function(entry) {
      var result = _readRecord(entry.id);
      if (result.ok || result.error === 'INVALID_JSON') return true;
      removed.push(entry.id);
      return false;
    });

    var allKeys = getProvider().keys().filter(function(k) { return k.startsWith('swf_wf_'); });
    var validIds = validEntries.map(function(e) { return e.id; });

    allKeys.forEach(function(key) {
      var id = key.replace('swf_wf_', '');
      if (!validIds.includes(id)) {
        var recResult = _readRecord(id);
        if (recResult.ok) {
          var meta = _extractMeta(recResult.record.content);
          validEntries.push({
            id: id,
            name: meta.name,
            description: 'Recovered workflow',
            createdAt: recResult.record.createdAt || new Date().toISOString(),
            modifiedAt: recResult.record.modifiedAt || new Date().toISOString(),
            specVersion: meta.specVersion,
            stateCount: meta.stateCount,
            tags: [],
            sizeBytes: recResult.record.content.length * 2,
          });
          repaired.push(id);
        }
      }
    });

    _writeIndex(validEntries);
    return { repaired: repaired, removed: removed };
  },

  clearLibrary: function() {
    var entries = _readIndex();
    entries.forEach(function(entry) {
      try { getProvider().removeItem('swf_wf_' + entry.id); } catch (_) {}
    });
    try { getProvider().removeItem('swf_library_index'); } catch (_) {}
    try { getProvider().removeItem('swf_active_id'); } catch (_) {}
    try { getProvider().removeItem('swf_schema_version'); } catch (_) {}
    try { getProvider().removeItem('swf_settings'); } catch (_) {}
  },

  migrateLegacyWorkflow: function() {
    var existingIndex = getProvider().getItem('swf_library_index');
    if (existingIndex !== null) return { migrated: false };

    var legacy = getProvider().getItem('lastSWFJson');
    if (!legacy) return { migrated: false };

    var meta = _extractMeta(legacy);
    var result = this.createWorkflow(meta.name, legacy, 'Migrated from previous session');
    return result.ok ? { migrated: true, id: result.id } : { migrated: false };
  },
};

// AutoSave watches the editor for changes and saves the active workflow after
// a short quiet period (800 ms). It debounces writes so rapid typing only
// triggers one save, and it updates the UI status indicator throughout.

var AutoSave = {
  _debounceTimer: null,
  lastSavedContent: null,

  // Auto-save is always on; saves are triggered via markDirty() on every edit.
  start: function() {},

  stop: function() {
    if (this._debounceTimer !== null) { clearTimeout(this._debounceTimer); this._debounceTimer = null; }
  },

  _tick: function() {
    var activeId = WorkflowLibrary.getActiveId();
    if (!activeId) return;

    var model;
    try { model = monaco.editor.getModels()[0]; } catch (_) { return; }
    var content = model.getValue();
    if (content === this.lastSavedContent) return;

    if (typeof LibraryUI !== 'undefined') LibraryUI.showAutosaveStatus('saving');

    var result = WorkflowLibrary.saveWorkflow(activeId, content);
    if (result.ok) {
      this.lastSavedContent = content;
      if (typeof LibraryUI !== 'undefined') {
        LibraryUI.showAutosaveStatus('saved');
        LibraryUI.updateStorageInfo();
      }
    } else {
      if (typeof LibraryUI !== 'undefined') LibraryUI.showAutosaveStatus('error', result.error);
    }
  },

  markDirty: function() {
    if (typeof LibraryUI !== 'undefined') LibraryUI.showAutosaveStatus('unsaved');

    var self = this;
    if (this._debounceTimer !== null) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(function() {
      self._debounceTimer = null;
      self._tick();
    }, 800);
  },
};

// Attach the library objects to window so the separately-loaded UI scripts
// (libraryUI.js, sweditor.js) can reach them without a module bundler.

window.WorkflowLibrary = WorkflowLibrary;
window.AutoSave        = AutoSave;
window.Settings        = Settings;
window.relativeTime    = relativeTime;
window._escapeHtml     = _escapeHtml;
