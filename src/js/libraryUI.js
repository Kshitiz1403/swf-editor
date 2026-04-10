'use strict';

var LibraryUI = (function() {

  // Private state — the two pieces of cross-function state the module needs:
  // which workflow is pending deletion, and a callback to run after the user
  // resolves an unsaved-changes prompt.
  var _pendingDeleteId = null;
  var _pendingLoadCb   = null;

  // Module entry point — wires up every subsystem in one call. Invoked once
  // from DOMContentLoaded after WorkflowLibrary has been initialised.

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

  // Apply persisted settings at startup — restores the sidebar collapsed state
  // and the active sort selection so the UI looks the same as when the user left.

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
  }

  // Storage warning badge — if the app fell back to sessionStorage or
  // in-memory storage, show a persistent notice in the sidebar footer so the
  // user knows their work won't survive a page reload.

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

  // List rendering — rebuilds the sidebar workflow list from scratch given an
  // array of index entries. A private helper builds each card's HTML.

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
    li.title = entry.description ? entry.description : 'Click to open';

    li.innerHTML =
      '<div class="workflow-item-main">' +
        '<div class="workflow-item-header">' +
          '<span class="workflow-item-name">' + _escapeHtml(entry.name) + '</span>' +
          '<button class="btn-icon btn-rename-inline lib-rename-btn" title="Rename" data-id="' + entry.id + '">' +
            '<i class="fa fa-pencil"></i>' +
          '</button>' +
        '</div>' +
        (entry.description ? '<span class="workflow-item-description">' + _escapeHtml(entry.description) + '</span>' : '') +
        '<span class="workflow-item-meta">' + entry.stateCount + ' states &middot; ' + relativeTime(entry.modifiedAt) + '</span>' +
      '</div>' +
      '<div class="workflow-item-actions">' +
        '<button class="btn-icon lib-duplicate-btn" title="Duplicate workflow" data-id="' + entry.id + '">' +
          '<i class="fa fa-clone"></i><span>Duplicate</span>' +
        '</button>' +
        '<button class="btn-icon lib-export-btn" title="Export" data-id="' + entry.id + '">' +
          '<i class="fa fa-download"></i><span>Export</span>' +
        '</button>' +
        '<button class="btn-icon lib-delete-btn danger" title="Delete workflow" data-id="' + entry.id + '">' +
          '<i class="fa fa-trash"></i><span>Delete</span>' +
        '</button>' +
      '</div>';

    return li;
  }

  // Toolbar name sync — keeps the workflow title in the editor toolbar in
  // step with whatever is currently active in the library.

  function _syncActiveWorkflowName() {
    var id = WorkflowLibrary.getActiveId();
    var nameEl = document.getElementById('active-workflow-name');
    if (!nameEl) return;
    if (!id) { nameEl.textContent = 'Unsaved workflow'; return; }
    var entry = WorkflowLibrary.getIndexEntry(id);
    nameEl.textContent = entry ? entry.name : 'Unsaved workflow';
  }

  // Modal open/close — shows and hides the custom dialogs by toggling a CSS
  // class. Also manages the shared backdrop and auto-focuses the first input.

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

  // Toast notifications — brief pop-up messages at the bottom-right corner.
  // Pass duration 0 to keep a toast open until the user dismisses it manually.

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

  // Autosave status indicator — updates the small text next to the workflow
  // name in the toolbar to reflect the current save state (unsaved, saving,
  // saved, or error). The "Saved" message fades out after a few seconds.

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

  // Storage info footer — counts workflows, calculates total bytes in use,
  // and updates both the footer label and the quota progress bar.

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

  // Unsaved-changes guard — before loading a different workflow, checks whether
  // the editor content differs from the last saved snapshot. If it does, shows
  // the banner so the user can save, discard, or cancel.

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

  // Action handlers — the functions that actually do things: load a workflow
  // into the editor, save it, create a blank one, duplicate, and export.

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
    // Auto-generate diagram after a brief tick so Monaco has processed setValue
    setTimeout(function() {
      if (typeof generateDiagram === 'function') generateDiagram();
    }, 80);
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

  function _doExportJson(id) {
    var result = WorkflowLibrary.exportWorkflow(id);
    if (!result.ok) { showToast('Export failed: ' + result.error, 'error'); return; }
    _triggerDownload(result.json, result.filename, 'application/json');
    showToast('"' + result.filename + '" downloaded.', 'success', 2000);
  }

  function _doExportImage() {
    var svg = document.querySelector('.workflowdiagram svg');
    if (!svg) {
      showToast('No diagram rendered yet. Load a workflow first.', 'warning', 3000);
      return;
    }
    if (typeof generateImageFromSVG === 'function') generateImageFromSVG(1);
  }

  function _showExportMenu(id, triggerBtn) {
    // Toggle off if already open
    var existing = document.getElementById('export-dropdown');
    if (existing) { existing.remove(); return; }

    var menu = document.createElement('div');
    menu.id = 'export-dropdown';
    menu.className = 'export-dropdown';

    function makeItem(iconClass, label, onClick) {
      var btn = document.createElement('button');
      btn.className = 'export-dropdown-item';
      btn.innerHTML = '<i class="fa ' + iconClass + '"></i>' + label;
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        menu.remove();
        onClick();
      });
      return btn;
    }

    menu.appendChild(makeItem('fa-file-code-o', 'Export JSON',  function() { _doExportJson(id); }));
    menu.appendChild(makeItem('fa-picture-o',   'Export Image', function() { _doExportImage(); }));

    // Position below the trigger button
    var rect = triggerBtn.getBoundingClientRect();
    menu.style.top  = (rect.bottom + 4) + 'px';
    menu.style.left = rect.left + 'px';
    document.body.appendChild(menu);

    // Close on any outside click
    function onOutside(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', onOutside, true); }
    }
    setTimeout(function() { document.addEventListener('click', onOutside, true); }, 0);
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

  // Modal data setup — populates the delete/rename/import modals with the
  // right values before opening them, and resets the import modal between uses.

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

  // Modal confirm handlers — the logic that runs when the user clicks the
  // primary action in a dialog: saving a new workflow, renaming, or importing.

  function _doSaveNew() {
    var content;
    try { content = monaco.editor.getModels()[0].getValue(); } catch (_) { content = '{}'; }
    var parsed;
    try { parsed = JSON.parse(content); } catch (_) { parsed = {}; }
    var name = (parsed.name || parsed.id || 'My Workflow').trim();
    var result = WorkflowLibrary.createWorkflow(name, content);
    if (result.ok) {
      AutoSave.lastSavedContent = content;
      _syncActiveWorkflowName();
      _refreshList();
      updateStorageInfo();
      showToast('"' + name + '" saved.', 'success', 2000);
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

  // Sidebar event wiring — attaches listeners for the collapse toggle, New and
  // Import buttons, the workflow list (click-to-load and action buttons),
  // search input, and sort dropdown.

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
        // Action button click — handle first, do not propagate to item load
        var btn = e.target.closest('.btn-icon');
        if (btn && btn.dataset.id) {
          var id = btn.dataset.id;
          if (btn.classList.contains('lib-rename-btn')) {
            _openRenameModal(id);
          } else if (btn.classList.contains('lib-duplicate-btn')) {
            _doDuplicate(id);
          } else if (btn.classList.contains('lib-export-btn')) {
            _showExportMenu(id, btn);
          } else if (btn.classList.contains('lib-delete-btn')) {
            _openDeleteModal(id);
          }
          e.stopPropagation();
          return;
        }
        // Click on the item row itself → load the workflow
        var item = e.target.closest('.workflow-item');
        if (item && item.dataset.id) {
          _guardUnsaved(item.dataset.id, function() { _doLoad(item.dataset.id); });
        }
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

  }

  // Toolbar event wiring — connects the Format and Generate Diagram buttons
  // above the Monaco editor to their respective functions in sweditor.js.

  function _bindToolbarEvents() {
    var formatBtn = document.getElementById('tb-format-btn');
    if (formatBtn) {
      formatBtn.addEventListener('click', function() {
        if (typeof formatJSON === 'function') formatJSON();
      });
    }

    var generateBtn = document.getElementById('tb-generate-btn');
    if (generateBtn) {
      generateBtn.addEventListener('click', function() {
        if (typeof generateDiagram === 'function') generateDiagram();
      });
    }
  }

  // Modal event wiring — attaches confirm/cancel/close listeners for every
  // dialog, the file drag-and-drop zone, the unsaved-changes banner buttons,
  // the quota link, and Enter-to-submit on name inputs.

  function _bindModalEvents() {
    document.querySelectorAll('.modal-close-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { closeModal(btn.dataset.modal); });
    });

    var backdrop = document.getElementById('modal-backdrop');
    if (backdrop) backdrop.addEventListener('click', _closeAllModals);

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
    ['rename-name'].forEach(function(inputId) {
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

  // Keyboard shortcuts — Escape closes any open modal; Cmd/Ctrl+S saves the
  // active workflow (or promotes it to a named one if it hasn't been saved yet).
  // We register the save shortcut via Monaco's addCommand API too, because Monaco
  // consumes keyboard events before they reach the document-level listener.

  function _bindKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        var openModalEl = document.querySelector('.modal.show');
        if (openModalEl) { closeModal(openModalEl.id); return; }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        var activeId = WorkflowLibrary.getActiveId();
        if (activeId) { _doSave(activeId); }
        else { _doSaveNew(); }
      }
    });

    // Monaco captures keyboard events before they reach `document`
    if (typeof editor !== 'undefined' && editor && typeof monaco !== 'undefined') {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function() {
        var activeId = WorkflowLibrary.getActiveId();
        if (activeId) { _doSave(activeId); }
        else { _doSaveNew(); }
      });
    }
  }

  // Public interface — the handful of functions other scripts can call: init,
  // renderList, showToast, showAutosaveStatus, and updateStorageInfo.

  return {
    init: init,
    renderList: renderList,
    showToast: showToast,
    showAutosaveStatus: showAutosaveStatus,
    updateStorageInfo: updateStorageInfo,
  };

})();

window.LibraryUI = LibraryUI;
