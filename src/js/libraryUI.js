'use strict';

var LibraryUI = (function() {

  // ── Private state ────────────────────────────────────────────────────────
  var _pendingDeleteId = null;
  var _pendingLoadCb   = null;

  // ── Init ─────────────────────────────────────────────────────────────────

  function init(libInfo) {
    _applySettings();
    renderList(WorkflowLibrary.listWorkflows());
    _bindSidebarEvents();
    _bindToolbarEvents();
    _bindModalEvents();
    _bindKeyboardShortcuts();
    updateStorageInfo();
    _syncActiveWorkflowName();
    _applyProviderBadge(libInfo);
  }

  // ── Settings application ─────────────────────────────────────────────────

  function _applySettings() {
    var settings = Settings.load();

    var sidebar = document.getElementById('library-sidebar');
    if (sidebar && settings.sidebar.collapsed) {
      sidebar.classList.add('collapsed');
      var btn = document.getElementById('sidebar-collapse-btn');
      if (btn) btn.textContent = '\u00BB';
    }

    var sortSelect = document.getElementById('lib-sort-select');
    if (sortSelect) sortSelect.value = settings.sidebar.sortBy || 'modifiedAt-desc';

    var autosaveSelect = document.getElementById('lib-autosave-select');
    if (autosaveSelect) {
      var ms = settings.autosave.enabled ? settings.autosave.intervalMs : 0;
      autosaveSelect.value = String(ms);
    }
  }

  // ── Provider badge ────────────────────────────────────────────────────────

  function _applyProviderBadge(libInfo) {
    if (!libInfo || libInfo.provider === 'localStorage') {
      if (libInfo && libInfo.migrated) {
        setTimeout(function() {
          var entries = WorkflowLibrary.listWorkflows();
          if (entries.length > 0) {
            showToast('Your previous workflow was saved as \u201C' + entries[0].name + '\u201D.', 'info', 5000);
          }
        }, 800);
      }
      return;
    }

    var footer = document.getElementById('lib-storage-info');
    if (footer) {
      var badge = document.createElement('span');
      badge.className = 'provider-badge ' + (libInfo.provider === 'sessionStorage' ? 'session' : 'memory');
      badge.textContent = libInfo.provider === 'sessionStorage'
        ? 'Session only \u2014 data lost on close'
        : 'No storage \u2014 export to keep work';
      var footerDiv = footer.closest('.library-footer');
      if (footerDiv) footerDiv.appendChild(badge);
    }
  }

  // ── List rendering ────────────────────────────────────────────────────────

  function _refreshList(query) {
    var entries = query
      ? WorkflowLibrary.searchWorkflows(query)
      : WorkflowLibrary.listWorkflows();
    renderList(entries);
  }

  function renderList(entries) {
    var list = document.getElementById('lib-workflow-list');
    if (!list) return;
    list.innerHTML = '';

    if (!entries || entries.length === 0) {
      var li = document.createElement('li');
      li.className = 'library-empty-state';
      li.innerHTML =
        '<span class="library-empty-state-icon">&#128196;</span>' +
        '<span>No workflows saved yet.</span>' +
        '<span>Click <strong>New</strong> to create one.</span>';
      list.appendChild(li);
      return;
    }

    var activeId = WorkflowLibrary.getActiveId();
    entries.forEach(function(entry) {
      list.appendChild(_renderItem(entry, entry.id === activeId));
    });
  }

  function _renderItem(entry, isActive) {
    var li = document.createElement('li');
    li.className = 'workflow-item' + (isActive ? ' active' : '');
    li.dataset.id = entry.id;
    li.title = entry.description || entry.name;

    li.innerHTML =
      '<div class="workflow-item-main">' +
        '<span class="workflow-item-name">' + _escapeHtml(entry.name) + '</span>' +
        '<span class="workflow-item-meta">' + entry.stateCount + ' states &middot; ' + _escapeHtml(entry.specVersion || '\u2014') + '</span>' +
        '<span class="workflow-item-date">' + relativeTime(entry.modifiedAt) + '</span>' +
      '</div>' +
      '<div class="workflow-item-actions">' +
        '<button class="btn-icon lib-load-btn"       title="Load"       data-id="' + entry.id + '">\u21D3</button>' +
        '<button class="btn-icon lib-rename-btn"     title="Rename"     data-id="' + entry.id + '">\u270E</button>' +
        '<button class="btn-icon lib-duplicate-btn"  title="Duplicate"  data-id="' + entry.id + '">\u29C9</button>' +
        '<button class="btn-icon lib-export-btn"     title="Export JSON" data-id="' + entry.id + '">\u21D3</button>' +
        '<button class="btn-icon lib-delete-btn danger" title="Delete"  data-id="' + entry.id + '">\uD83D\uDDD1</button>' +
      '</div>';

    return li;
  }

  // ── Active workflow name ───────────────────────────────────────────────────

  function _syncActiveWorkflowName() {
    var id = WorkflowLibrary.getActiveId();
    var nameEl = document.getElementById('active-workflow-name');
    if (!nameEl) return;
    if (!id) { nameEl.textContent = 'Unsaved workflow'; return; }
    var entry = WorkflowLibrary.getIndexEntry(id);
    nameEl.textContent = entry ? entry.name : 'Unsaved workflow';
  }

  // ── Modal open/close ─────────────────────────────────────────────────────

  function openModal(id) {
    var modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('show');
    var backdrop = document.getElementById('modal-backdrop');
    if (backdrop) {
      backdrop.style.display = 'block';
      setTimeout(function() { backdrop.classList.add('show'); }, 10);
    }
    var firstInput = modal.querySelector('input[type="text"], textarea');
    if (firstInput) setTimeout(function() { firstInput.focus(); }, 100);
  }

  function closeModal(id) {
    var modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('show');
    var backdrop = document.getElementById('modal-backdrop');
    if (backdrop) {
      backdrop.classList.remove('show');
      setTimeout(function() { backdrop.style.display = 'none'; }, 200);
    }
  }

  function _closeAllModals() {
    document.querySelectorAll('.modal.show').forEach(function(m) { closeModal(m.id); });
  }

  // ── Toast ────────────────────────────────────────────────────────────────

  function showToast(message, type, duration) {
    type = type || 'info';
    duration = (duration === undefined) ? 3000 : duration;

    var container = document.getElementById('toast-container');
    if (!container) return;

    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.innerHTML =
      '<span>' + _escapeHtml(message) + '</span>' +
      '<button class="toast-dismiss" aria-label="Dismiss">&times;</button>';

    toast.querySelector('.toast-dismiss').addEventListener('click', function() {
      _removeToast(toast);
    });
    container.appendChild(toast);

    if (duration > 0) setTimeout(function() { _removeToast(toast); }, duration);
  }

  function _removeToast(toast) {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.2s';
    setTimeout(function() { if (toast.parentNode) toast.remove(); }, 250);
  }

  // ── Auto-save status ──────────────────────────────────────────────────────

  function showAutosaveStatus(state, detail) {
    var el = document.getElementById('autosave-status');
    if (!el) return;

    el.className = 'autosave-status';
    el.style.opacity = '1';

    switch (state) {
      case 'unsaved':
        el.textContent = 'Unsaved changes';
        el.classList.add('status-dirty');
        break;
      case 'saving':
        el.textContent = 'Saving\u2026';
        el.classList.add('status-saving');
        break;
      case 'saved':
        el.textContent = 'Saved';
        el.classList.add('status-saved');
        setTimeout(function() { el.style.opacity = '0'; }, 3000);
        break;
      case 'error':
        el.textContent = 'Save failed' + (detail ? ': ' + detail : '');
        el.classList.add('status-error');
        break;
      default:
        el.textContent = '';
    }
  }

  // ── Storage info ──────────────────────────────────────────────────────────

  function updateStorageInfo() {
    var usage = WorkflowLibrary.getStorageUsage();
    var count = WorkflowLibrary.listWorkflows().length;
    var kb = (usage.used / 1024).toFixed(1);

    var info = document.getElementById('lib-storage-info');
    if (info) info.textContent = count + ' workflow' + (count !== 1 ? 's' : '') + ' \u00B7 ' + kb + '\u00A0KB';

    if (usage.quota) {
      var pct = Math.round((usage.used / usage.quota) * 100);
      var fill = document.querySelector('.quota-bar-fill');
      if (fill) {
        fill.style.width = Math.min(pct, 100) + '%';
        fill.className = 'quota-bar-fill' + (pct >= 95 ? ' danger' : pct >= 80 ? ' warn' : '');
      }
      var banner = document.getElementById('quota-banner');
      var pctEl = document.getElementById('quota-percent');
      if (banner && pctEl) {
        banner.style.display = pct >= 80 ? 'block' : 'none';
        pctEl.textContent = pct;
      }
    }
  }

  // ── Unsaved changes guard ─────────────────────────────────────────────────

  function _guardUnsaved(targetId, callback) {
    var settings = Settings.load();
    if (!settings.editor.confirmOnLoad) { callback(); return; }

    var model;
    try { model = monaco.editor.getModels()[0]; } catch (_) { callback(); return; }

    var activeId = WorkflowLibrary.getActiveId();
    if (!activeId) { callback(); return; }

    var currentContent = model.getValue();
    if (currentContent === AutoSave.lastSavedContent) { callback(); return; }

    _pendingLoadCb = callback;
    var banner = document.getElementById('unsaved-banner');
    if (banner) banner.classList.add('visible');
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  function _doLoad(id) {
    var result = WorkflowLibrary.loadWorkflow(id);
    var content;

    if (!result.ok) {
      if (result.error === 'CHECKSUM_MISMATCH' && result.content) {
        content = result.content;
        var name = (WorkflowLibrary.getIndexEntry(id) || {}).name || id;
        showToast('Warning: "' + name + '" may be corrupted. Please verify and re-save.', 'warning', 0);
      } else {
        showToast('Failed to load: ' + result.error, 'error', 5000);
        return;
      }
    } else {
      content = result.content;
    }

    try { monaco.editor.getModels()[0].setValue(content); } catch (_) {}
    WorkflowLibrary.setActiveId(id);
    AutoSave.lastSavedContent = content;
    _syncActiveWorkflowName();
    _refreshList();
    showAutosaveStatus('saved');
  }

  function _doSave(id) {
    var model;
    try { model = monaco.editor.getModels()[0]; } catch (_) { return; }
    var content = model.getValue();
    var result = WorkflowLibrary.saveWorkflow(id, content);
    if (result.ok) {
      AutoSave.lastSavedContent = content;
      _syncActiveWorkflowName();
      _refreshList();
      updateStorageInfo();
      showAutosaveStatus('saved');
      showToast('Saved.', 'success', 2000);
    } else {
      showToast('Save failed: ' + result.error, 'error', 5000);
    }
  }

  function _doNewWorkflow() {
    var defaultJson;
    try { defaultJson = JSON.stringify(customerApplication, null, 2); }
    catch (_) { defaultJson = '{}'; }
    try { monaco.editor.getModels()[0].setValue(defaultJson); } catch (_) {}
    WorkflowLibrary.setActiveId(null);
    AutoSave.lastSavedContent = defaultJson;
    _syncActiveWorkflowName();
    _refreshList();
    showAutosaveStatus('');
  }

  function _doDuplicate(id) {
    var entry = WorkflowLibrary.getIndexEntry(id);
    if (!entry) return;
    var result = WorkflowLibrary.duplicateWorkflow(id, entry.name + ' (copy)');
    if (result.ok) {
      _refreshList();
      updateStorageInfo();
      showToast('Duplicated as "' + entry.name + ' (copy)".', 'success', 2000);
    } else {
      showToast('Duplicate failed: ' + result.error, 'error');
    }
  }

  function _doExport(id) {
    var result = WorkflowLibrary.exportWorkflow(id);
    if (!result.ok) { showToast('Export failed: ' + result.error, 'error'); return; }
    _triggerDownload(result.json, result.filename, 'application/json');
    showToast('"' + result.filename + '" downloaded.', 'success', 2000);
  }

  function _triggerDownload(content, filename, mimeType) {
    var blob = new Blob([content], { type: mimeType });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  // ── Modal helpers ─────────────────────────────────────────────────────────

  function _openDeleteModal(id) {
    var entry = WorkflowLibrary.getIndexEntry(id);
    _pendingDeleteId = id;
    var nameEl = document.getElementById('modal-delete-workflow-name');
    if (nameEl) nameEl.textContent = entry ? entry.name : id;
    openModal('modal-confirm-delete');
  }

  function _openRenameModal(id) {
    var entry = WorkflowLibrary.getIndexEntry(id);
    if (!entry) return;
    var nameInput = document.getElementById('rename-name');
    var descInput = document.getElementById('rename-description');
    var hiddenId  = document.getElementById('rename-target-id');
    if (nameInput) { nameInput.value = entry.name; nameInput.classList.remove('is-invalid'); }
    if (descInput) descInput.value = entry.description || '';
    if (hiddenId)  hiddenId.value = id;
    openModal('modal-rename');
  }

  function _resetImportModal() {
    var paste    = document.getElementById('import-paste-area');
    var fileInput = document.getElementById('import-file-input');
    var errEl    = document.getElementById('import-error');
    if (paste) paste.value = '';
    if (fileInput) fileInput.value = '';
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  }

  // ── Confirm handlers ──────────────────────────────────────────────────────

  function _onSaveAsConfirm() {
    var nameInput = document.getElementById('save-as-name');
    var descInput = document.getElementById('save-as-description');
    var nameError = document.getElementById('save-as-name-error');

    var name = (nameInput ? nameInput.value : '').trim();
    if (!name) {
      if (nameInput) nameInput.classList.add('is-invalid');
      if (nameError) nameError.textContent = 'Name is required.';
      return;
    }
    if (nameInput) nameInput.classList.remove('is-invalid');

    var content;
    try { content = monaco.editor.getModels()[0].getValue(); } catch (_) { content = '{}'; }

    var desc = descInput ? descInput.value : '';
    var result = WorkflowLibrary.createWorkflow(name, content, desc);

    if (result.ok) {
      AutoSave.lastSavedContent = content;
      _syncActiveWorkflowName();
      _refreshList();
      updateStorageInfo();
      closeModal('modal-save-as');
      if (nameInput) nameInput.value = '';
      if (descInput) descInput.value = '';
      var descCount = document.getElementById('save-as-desc-count');
      if (descCount) descCount.textContent = '0';
      showToast('Workflow "' + name + '" saved.', 'success', 2000);
    } else {
      showToast('Save failed: ' + result.error, 'error');
    }
  }

  function _onRenameConfirm() {
    var nameInput = document.getElementById('rename-name');
    var descInput = document.getElementById('rename-description');
    var hiddenId  = document.getElementById('rename-target-id');
    var nameError = document.getElementById('rename-name-error');

    var id = hiddenId ? hiddenId.value : null;
    var name = (nameInput ? nameInput.value : '').trim();

    if (!id) return;
    if (!name) {
      if (nameInput) nameInput.classList.add('is-invalid');
      if (nameError) nameError.textContent = 'Name is required.';
      return;
    }
    if (nameInput) nameInput.classList.remove('is-invalid');

    var desc = descInput ? descInput.value : undefined;
    var result = WorkflowLibrary.renameWorkflow(id, name, desc);
    if (result.ok) {
      _syncActiveWorkflowName();
      _refreshList();
      closeModal('modal-rename');
      showToast('Renamed to "' + name + '".', 'success', 2000);
    } else {
      showToast('Rename failed: ' + result.error, 'error');
    }
  }

  function _onImportConfirm() {
    var paste  = document.getElementById('import-paste-area');
    var errEl  = document.getElementById('import-error');
    var content = paste ? paste.value.trim() : '';

    if (!content) {
      if (errEl) { errEl.style.display = 'block'; errEl.textContent = 'Paste or select a file to import.'; }
      return;
    }

    var result = WorkflowLibrary.importWorkflow(content);
    if (result.ok) {
      _refreshList();
      updateStorageInfo();
      closeModal('modal-import');
      var entry = WorkflowLibrary.getIndexEntry(result.id);
      showToast('"' + (entry ? entry.name : 'Workflow') + '" imported successfully.', 'success', 3000);
    } else {
      if (errEl) {
        errEl.style.display = 'block';
        errEl.textContent = 'Import failed: ' + result.error + '. Ensure the file is valid Serverless Workflow JSON or YAML.';
      }
    }
  }

  // ── Sidebar event binding ─────────────────────────────────────────────────

  function _bindSidebarEvents() {
    var collapseBtn = document.getElementById('sidebar-collapse-btn');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', function() {
        var sidebar = document.getElementById('library-sidebar');
        var collapsed = sidebar.classList.toggle('collapsed');
        collapseBtn.textContent = collapsed ? '\u00BB' : '\u00AB';
        Settings.save({ sidebar: { collapsed: collapsed } });
        setTimeout(function() {
          if (typeof editor !== 'undefined' && editor) {
            editor.layout({ width: 0, height: 0 });
            window.requestAnimationFrame(function() { editor.layout(); });
          }
        }, 220);
      });
    }

    var libNewBtn = document.getElementById('lib-new-btn');
    if (libNewBtn) {
      libNewBtn.addEventListener('click', function() { _guardUnsaved(null, _doNewWorkflow); });
    }

    var importBtn = document.getElementById('lib-import-btn');
    if (importBtn) {
      importBtn.addEventListener('click', function() { _resetImportModal(); openModal('modal-import'); });
    }

    var list = document.getElementById('lib-workflow-list');
    if (list) {
      list.addEventListener('click', function(e) {
        var btn = e.target.closest('[data-id]');
        if (!btn) return;
        var id = btn.dataset.id;
        if (btn.classList.contains('lib-load-btn')) {
          _guardUnsaved(id, function() { _doLoad(id); });
        } else if (btn.classList.contains('lib-rename-btn')) {
          _openRenameModal(id);
        } else if (btn.classList.contains('lib-duplicate-btn')) {
          _doDuplicate(id);
        } else if (btn.classList.contains('lib-export-btn')) {
          _doExport(id);
        } else if (btn.classList.contains('lib-delete-btn')) {
          _openDeleteModal(id);
        }
        e.stopPropagation();
      });
    }

    var sortSelect = document.getElementById('lib-sort-select');
    if (sortSelect) {
      sortSelect.addEventListener('change', function(e) {
        Settings.save({ sidebar: { sortBy: e.target.value } });
        var searchInput = document.getElementById('lib-search-input');
        _refreshList(searchInput ? searchInput.value : '');
      });
    }

    var searchInput = document.getElementById('lib-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function(e) { _refreshList(e.target.value); });
    }

    var clearBtn = document.getElementById('lib-search-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        if (searchInput) searchInput.value = '';
        _refreshList('');
      });
    }

    var autosaveSelect = document.getElementById('lib-autosave-select');
    if (autosaveSelect) {
      autosaveSelect.addEventListener('change', function(e) {
        var ms = parseInt(e.target.value, 10);
        AutoSave.setIntervalMs(ms);
        showToast(ms > 0 ? 'Auto-save set.' : 'Auto-save disabled.', 'info', 2000);
      });
    }
  }

  // ── Toolbar event binding ─────────────────────────────────────────────────

  function _bindToolbarEvents() {
    var saveBtn = document.getElementById('tb-save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', function() {
        var activeId = WorkflowLibrary.getActiveId();
        if (activeId) { _doSave(activeId); }
        else {
          var saveAsName = document.getElementById('save-as-name');
          if (saveAsName) saveAsName.value = '';
          openModal('modal-save-as');
        }
      });
    }

    var saveAsBtn = document.getElementById('tb-save-as-btn');
    if (saveAsBtn) {
      saveAsBtn.addEventListener('click', function() {
        var saveAsName = document.getElementById('save-as-name');
        var activeEntry = WorkflowLibrary.getIndexEntry(WorkflowLibrary.getActiveId());
        if (saveAsName) saveAsName.value = activeEntry ? activeEntry.name + ' (copy)' : '';
        openModal('modal-save-as');
      });
    }

    var newBtn = document.getElementById('tb-new-btn');
    if (newBtn) {
      newBtn.addEventListener('click', function() { _guardUnsaved(null, _doNewWorkflow); });
    }
  }

  // ── Modal event binding ───────────────────────────────────────────────────

  function _bindModalEvents() {
    document.querySelectorAll('.modal-close-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { closeModal(btn.dataset.modal); });
    });

    var backdrop = document.getElementById('modal-backdrop');
    if (backdrop) backdrop.addEventListener('click', _closeAllModals);

    var saveAsConfirm = document.getElementById('save-as-confirm-btn');
    if (saveAsConfirm) saveAsConfirm.addEventListener('click', _onSaveAsConfirm);

    var saveAsDesc = document.getElementById('save-as-description');
    var saveAsCount = document.getElementById('save-as-desc-count');
    if (saveAsDesc && saveAsCount) {
      saveAsDesc.addEventListener('input', function() { saveAsCount.textContent = saveAsDesc.value.length; });
    }

    var deleteConfirm = document.getElementById('delete-confirm-btn');
    if (deleteConfirm) {
      deleteConfirm.addEventListener('click', function() {
        if (!_pendingDeleteId) return;
        var entry = WorkflowLibrary.getIndexEntry(_pendingDeleteId);
        var name = entry ? entry.name : _pendingDeleteId;
        var result = WorkflowLibrary.deleteWorkflow(_pendingDeleteId);
        if (result.ok) {
          showToast('"' + name + '" deleted.', 'info', 2000);
          if (!WorkflowLibrary.getActiveId()) {
            try {
              monaco.editor.getModels()[0].setValue(JSON.stringify(customerApplication, null, 2));
            } catch (_) {}
            AutoSave.lastSavedContent = null;
          }
          _syncActiveWorkflowName();
          _refreshList();
          updateStorageInfo();
        } else {
          showToast('Delete failed: ' + result.error, 'error');
        }
        _pendingDeleteId = null;
        closeModal('modal-confirm-delete');
      });
    }

    var renameConfirm = document.getElementById('rename-confirm-btn');
    if (renameConfirm) renameConfirm.addEventListener('click', _onRenameConfirm);

    var importConfirm = document.getElementById('import-confirm-btn');
    if (importConfirm) importConfirm.addEventListener('click', _onImportConfirm);

    var fileInput = document.getElementById('import-file-input');
    if (fileInput) {
      fileInput.addEventListener('change', function(e) {
        var file = e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(ev) {
          var paste = document.getElementById('import-paste-area');
          if (paste) paste.value = ev.target.result;
        };
        reader.readAsText(file);
      });
    }

    var dropZone = document.getElementById('import-drop-zone');
    if (dropZone) {
      dropZone.addEventListener('dragover', function(e) { e.preventDefault(); dropZone.classList.add('drag-over'); });
      dropZone.addEventListener('dragleave', function() { dropZone.classList.remove('drag-over'); });
      dropZone.addEventListener('drop', function(e) {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        var file = e.dataTransfer.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(ev) {
          var paste = document.getElementById('import-paste-area');
          if (paste) paste.value = ev.target.result;
        };
        reader.readAsText(file);
      });
    }

    // Unsaved banner
    var saveBanner = document.getElementById('unsaved-save-btn');
    if (saveBanner) {
      saveBanner.addEventListener('click', function() {
        var activeId = WorkflowLibrary.getActiveId();
        if (activeId) _doSave(activeId);
        var banner = document.getElementById('unsaved-banner');
        if (banner) banner.classList.remove('visible');
        if (_pendingLoadCb) { _pendingLoadCb(); _pendingLoadCb = null; }
      });
    }

    var discardBanner = document.getElementById('unsaved-discard-btn');
    if (discardBanner) {
      discardBanner.addEventListener('click', function() {
        var banner = document.getElementById('unsaved-banner');
        if (banner) banner.classList.remove('visible');
        if (_pendingLoadCb) { _pendingLoadCb(); _pendingLoadCb = null; }
      });
    }

    var cancelBanner = document.getElementById('unsaved-cancel-btn');
    if (cancelBanner) {
      cancelBanner.addEventListener('click', function() {
        var banner = document.getElementById('unsaved-banner');
        if (banner) banner.classList.remove('visible');
        _pendingLoadCb = null;
      });
    }

    var quotaLink = document.getElementById('quota-manage-link');
    if (quotaLink) {
      quotaLink.addEventListener('click', function(e) {
        e.preventDefault();
        var sidebar = document.getElementById('library-sidebar');
        if (sidebar) sidebar.classList.remove('collapsed');
        var btn = document.getElementById('sidebar-collapse-btn');
        if (btn) btn.textContent = '\u00AB';
      });
    }

    // Enter key in name inputs submits the modal
    ['save-as-name', 'rename-name'].forEach(function(inputId) {
      var el = document.getElementById(inputId);
      if (el) {
        el.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') {
            var modal = el.closest('.modal');
            var confirmBtn = modal && modal.querySelector('[id$="-confirm-btn"]');
            if (confirmBtn) confirmBtn.click();
          }
        });
      }
    });
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  function _bindKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        var openModalEl = document.querySelector('.modal.show');
        if (openModalEl) { closeModal(openModalEl.id); return; }
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 's') {
        e.preventDefault();
        var activeId = WorkflowLibrary.getActiveId();
        if (activeId) { _doSave(activeId); }
        else { openModal('modal-save-as'); }
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 's') {
        e.preventDefault();
        openModal('modal-save-as');
      }
    });
  }

  // ── Public interface ──────────────────────────────────────────────────────

  return {
    init: init,
    renderList: renderList,
    showToast: showToast,
    showAutosaveStatus: showAutosaveStatus,
    updateStorageInfo: updateStorageInfo,
  };

})();

window.LibraryUI = LibraryUI;
