# Workflow Management System — Implementation Plan

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Existing Architecture Analysis](#2-existing-architecture-analysis)
3. [Current Data Structures](#3-current-data-structures)
4. [Current localStorage Usage](#4-current-localstorage-usage)
5. [Identified Problems](#5-identified-problems)
6. [New Feature Design](#6-new-feature-design)
7. [Data Schema & Storage Keys](#7-data-schema--storage-keys)
8. [Storage API Design](#8-storage-api-design)
9. [UI Components Design](#9-ui-components-design)
10. [Auto-Save Implementation](#10-auto-save-implementation)
11. [Export & Import Implementation](#11-export--import-implementation)
12. [Search & Filtering](#12-search--filtering)
13. [Confirmation Dialogs](#13-confirmation-dialogs)
14. [Error Handling & Quota Management](#14-error-handling--quota-management)
15. [Validation & Corruption Detection](#15-validation--corruption-detection)
16. [Backward Compatibility](#16-backward-compatibility)
17. [Testing Plan](#17-testing-plan)
18. [Phased Implementation Roadmap](#18-phased-implementation-roadmap)
19. [Storage Provider Fallback Chain](#19-storage-provider-fallback-chain)
20. [Library Settings & Preferences Schema](#20-library-settings--preferences-schema)
21. [Complete CSS Specification for library.css](#21-complete-css-specification-for-librarycss)
22. [Complete HTML Markup for Modals](#22-complete-html-markup-for-modals)
23. [libraryUI.js — Internal Function Design](#23-libraryuijs--internal-function-design)
24. [workflowLibrary.js — Internal Structure & Init Sequence](#24-workflowlibraryjs--internal-structure--init-sequence)
25. [Unit Test Code Examples](#25-unit-test-code-examples)
26. [Integration Test Code Examples](#26-integration-test-code-examples)
27. [User-Facing Error Messages Reference](#27-user-facing-error-messages-reference)

---

## 1. Executive Summary

The Serverless Workflow Online Editor (`swf-editor-versioning`) is a client-side single-page application that lets users write and visualize Temporal Serverless Workflow definitions in JSON, rendered as Mermaid state diagrams. Currently it stores exactly **one** workflow in `localStorage`. Any time a user starts a new workflow or loads an example, their in-progress work is silently overwritten.

This document specifies the complete design and implementation plan for a **local storage-based Workflow Library** — a multi-workflow management system that lets users save, name, organize, search, load, export/import, and delete workflows without losing prior work. No backend changes are needed; everything is browser-side.

---

## 2. Existing Architecture Analysis

### 2.1 File Structure

```
src/
├── index.html                         # Main entry point — Bootstrap layout, script imports
├── css/
│   ├── sws.css                        # Custom styles (~140 lines, Bootstrap-extended)
│   ├── termynal.css                   # Unused terminal animation CSS
│   └── editor/
│       └── editor.main.css            # Monaco editor bundled CSS (~66 KB)
└── js/
    ├── sweditor.js                    # Core application logic (353 lines)
    ├── examples.js                    # Pre-defined workflow JSON objects (379 lines)
    ├── sws.js                         # Minimal stub (24 lines, mostly empty)
    ├── wrscript.js                    # Legacy form/AJAX handler (57 lines, inactive)
    ├── jquery-form-serializer.js      # jQuery plugin for form serialization (90 lines)
    ├── loader.js                      # Monaco editor AMD loader (minified)
    ├── editor.main.nls.js             # Monaco localization strings (minified)
    ├── editor.main.js                 # Monaco editor core (minified, ~2 MB)
    └── serverlessWorkflowSdk.umd.js   # Serverless Workflow SDK (18,196 lines, UMD bundle)
```

### 2.2 Technology Stack

| Concern | Library | Version | How Loaded |
|---|---|---|---|
| Layout / CSS | Bootstrap | 4.0.0 | CDN |
| Code Editor | Monaco Editor | (bundled) | Local `/min/vs` |
| Workflow Parsing | Serverless Workflow SDK | (bundled) | Local UMD |
| Diagram Rendering | Mermaid.js | 9.4.3 | CDN |
| Resizable Panels | Split.js | 1.6.0 | CDN |
| Pan/Zoom | Panzoom | 9.4.0 | CDN |
| DOM Utilities | jQuery | 3.3.1 | CDN |

### 2.3 Application Initialization Sequence

```
1. Browser loads index.html
2. SDK (serverlessWorkflowSdk.umd.js) loads — exposes `serverWorkflowSdk` global
3. monaco var `require` is configured to point to /min/vs
4. loader.js / editor.main.js / editor.main.nls.js load Monaco
5. sweditor.js loads — defines globals: customerApplication, examplesMap,
   LOCAL_STORAGE_SWF_JSON, LOCAL_STORAGE_SPLIT_SIZES, and all functions
6. Inline <script> in index.html:
   a. Reads localStorage["lastSWFJson"]
   b. Creates Monaco model from localStorage content OR customerApplication default
   c. Configures Monaco JSON schema validation against SWF 0.8.x spec
   d. Calls mountEditor()
7. DOMContentLoaded event fires:
   a. Reads localStorage["theme"] and applies dark/light theme
   b. Initializes Monaco editor instance bound to the model
   c. Initializes Mermaid with the correct theme
   d. Generates the initial diagram
   e. Attaches theme-toggle button listener
8. Split.js initializes the resizable editor/diagram pane layout
```

### 2.4 Core Functions in `sweditor.js`

| Function | Lines | Purpose |
|---|---|---|
| `generateDiagram()` | 123–146 | Parses Monaco model JSON → Mermaid DSL → SVG render |
| `mountEditor()` | 149–153 | Attaches `onDidChangeContent` listener that calls `saveToLocalStorage()` |
| `formatJSON()` | 215–221 | Pretty-prints the current Monaco model value |
| `saveToLocalStorage()` | 223–228 | Writes current editor content to `localStorage["lastSWFJson"]` |
| `goFullScreen()` | 230–234 | Requests fullscreen on the diagram container |
| `getWorkflowName()` | 236–245 | Parses the `name` field from the current editor JSON |
| `generateImageFromSVG(quality)` | 247–314 | Exports the Mermaid SVG as a JPEG download |
| `setTheme(isDarkMode)` | 164–197 | Initializes Monaco and Mermaid themes, persists to localStorage |
| `toggleTheme()` | 200–208 | Flips theme in localStorage and reloads the page |
| `changeTheme(theme)` | 322–326 | Sets Monaco editor theme directly |
| Split.js initialization | 328–352 | Configures resizable panels, persists sizes |

### 2.5 Diagram Generation Flow

```
User action (button click OR Ctrl/Cmd+Enter)
  │
  ▼
generateDiagram()
  │
  ├─ monaco.editor.getModels()[0].getValue()        // Get raw JSON string
  │
  ├─ serverWorkflowSdk.Specification.Workflow
  │    .fromSource(jsonString)                      // Parse & validate
  │
  ├─ new serverWorkflowSdk.MermaidDiagram(workflow)
  │    .sourceCode()                                // Generate Mermaid DSL
  │
  ├─ mermaid.mermaidAPI.render("mermaid", source, callback)
  │    └─ callback: sets innerHTML of .workflowdiagram
  │
  ├─ panzoom(document.querySelector("#mermaid"))    // Enable pan/zoom
  │
  └─ Post-process SVG: replace "→" with ":" and "⊕" with ";"
```

### 2.6 State Management

The application has **no centralized state manager**. All runtime state lives in:

- The Monaco `model` object (the `ITextModel` instance — the single source of truth for workflow JSON)
- `localStorage` (three keys — see §4)
- DOM (rendered SVG inside `.workflowdiagram`)

There is no Redux, MobX, or Vue reactivity. Data flows one way: editor → generate → diagram. There is no two-way binding.

---

## 3. Current Data Structures

### 3.1 Serverless Workflow Definition (Top Level)

```jsonc
{
  "id": "string",              // Unique workflow identifier (kebab-case)
  "name": "string",            // Human-readable name
  "version": "string",         // Semantic version, e.g. "1.0"
  "specVersion": "0.7|0.8.x", // SWF specification version
  "description": "string",     // Optional description
  "start": "string | object",  // Starting state name OR { stateName, compensate }
  "timeouts": {
    "workflowExecTimeout": { "duration": "PT1M" },
    "actionExecTimeout": "PT10S"
  },
  "retries": [
    { "name": "string", "delay": "PT3S", "maxAttempts": 10 }
  ],
  "states": [],       // Required — array of State objects (see §3.2)
  "functions": [],    // Optional — REST/GraphQL/expression function definitions
  "events": [],       // Optional — event definitions
  "errors": [],       // Optional — named error definitions
  "auth": [],         // Optional — authentication definitions
  "constants": {},    // Optional — workflow-scoped constants
  "metadata": {}      // Optional — arbitrary metadata map
}
```

### 3.2 State Types

| Type | Key Properties |
|---|---|
| `event` | `onEvents[]`, `transition` |
| `operation` | `actions[]`, `actionMode` (sequential/parallel), `transition`, `stateDataFilter` |
| `switch` | `dataConditions[]` OR `eventConditions[]`, `defaultCondition`, `eventTimeout` |
| `parallel` | `branches[]`, `completionType` (allOf/oneOf/atLeastOneSucceeded) |
| `sleep` | `duration` (ISO 8601) |
| `foreach` | `inputCollection`, `actions[]`, `outputCollection` |
| `inject` | `data` |
| `callback` | `action`, `eventRef` |

### 3.3 Action Structure

```jsonc
{
  "name": "string",
  "functionRef": "string | { refName, arguments, invoke }",
  "subFlowRef": "string | { refName, arguments, invoke }",
  "eventRef": { "triggerEventRef": "", "data": "", "resultEventRef": "" },
  "retryRef": "string",
  "sleep": { "before": "PT1S", "after": "PT1S" },
  "actionDataFilter": { "useResults": true, "results": "$expr", "toStateData": "$expr" }
}
```

### 3.4 Bundled Example Workflows (in `examples.js`)

| Variable | Workflow Name | Key Features |
|---|---|---|
| `customerApplication` | Customer Application Workflow | Event state, switch state, operation states |
| `parallelStateExample` | Parallel Execution Workflow | Parallel state with branches |
| `eventBasedSwitchState` | Event Based Switch Transitions | Event-based switch, subflow references |
| `provisionOrdersExample` | Provision Orders | Error handling, onErrors |
| `monitorJobsExample` | Job Monitoring | Sleep state, polling loop |
| `vetAppointmentExample` | Vet Appointment Workflow | Event ref actions, timeouts |

---

## 4. Current localStorage Usage

| Key | Type | Content | Set By |
|---|---|---|---|
| `"lastSWFJson"` | `string` | Raw JSON string of the active workflow | `saveToLocalStorage()` — on every edit |
| `"split-sizes"` | `string` | JSON-serialized `[number, number]` array (e.g. `[50,50]`) | Split.js `onDragEnd` |
| `"theme"` | `string` | `"dark"` or `"light"` | `setTheme()` and `toggleTheme()` |

The global constant `LOCAL_STORAGE_SWF_JSON = "lastSWFJson"` is defined in `sweditor.js` at line 119.

**Critical observation:** `localStorage["lastSWFJson"]` is overwritten on every keystroke via the Monaco `onDidChangeContent` handler (line 150). There is no concept of "named" or "multiple" workflows. Loading any example or starting fresh silently destroys whatever was there.

---

## 5. Identified Problems

| # | Problem | Impact |
|---|---|---|
| P1 | Single-key storage destroys work when user loads an example | Data loss — no recovery path |
| P2 | No named workflows — cannot distinguish "Order Flow" from "Visa Flow" | Zero discoverability |
| P3 | No creation timestamps or modification history | Cannot tell which is newest |
| P4 | No way to have multiple workflows open or compare them | Productivity loss |
| P5 | `generateDiagram()` re-renders in place — no history or undo at diagram level | Limited debugging |
| P6 | No export as JSON — only image export | No interoperability or sharing |
| P7 | No import — users cannot drag-drop or paste a workflow from another source | Poor onboarding |
| P8 | No storage quota handling — silent corruption if quota exceeded | Data loss |
| P9 | No validation feedback on storage — corrupted JSON silently fails | Silent failures |

---

## 6. New Feature Design

### 6.1 Feature Overview

The new system introduces a **Workflow Library** sidebar panel with a full CRUD interface:

- **Save** the current workflow with a user-defined name
- **Create** a new blank (or template-based) workflow without losing current work
- **Load** any saved workflow into the editor
- **Rename** a saved workflow
- **Duplicate** a workflow to use it as a starting point
- **Delete** a workflow (with confirmation)
- **Export** a workflow as a `.json` file
- **Import** a `.json` or `.yaml` file into the library
- **Search** by name or description
- **Auto-save** the active workflow on a configurable interval

### 6.2 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser Window                               │
│                                                                       │
│  ┌──────────────┐  ┌──────────────────────────┐  ┌───────────────┐  │
│  │   Library    │  │      Monaco Editor        │  │  Mermaid      │  │
│  │   Sidebar    │  │   (active workflow JSON)  │  │  Diagram      │  │
│  │              │  │                           │  │  Panel        │  │
│  │  ┌────────┐  │  │  [Format] [Ctrl+Enter]    │  │               │  │
│  │  │ Search │  │  │                           │  │  [Generate]   │  │
│  │  └────────┘  │  │                           │  │  [Export Img] │  │
│  │              │  │                           │  │  [Fullscreen] │  │
│  │  workflow 1  │  │                           │  │               │  │
│  │  workflow 2  │  └──────────────────────────-┘  └───────────────┘  │
│  │  workflow 3  │                                                      │
│  │  ...         │  ┌──────────────────────────────────────────────┐  │
│  │              │  │  Toolbar: [New] [Save] [Save As] [Import]    │  │
│  │  [+ New]     │  └──────────────────────────────────────────────┘  │
│  │  [Import]    │                                                      │
│  └──────────────┘                                                      │
│                          ▼ localStorage                                │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  swf_library_index  →  WorkflowIndex[]                          │  │
│  │  swf_wf_{id}        →  WorkflowRecord (for each saved workflow) │  │
│  │  swf_active_id      →  string (currently loaded workflow id)    │  │
│  │  split-sizes        →  [number, number]  (unchanged)            │  │
│  │  theme              →  "dark" | "light"  (unchanged)            │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.3 New Files to Create

| File | Purpose |
|---|---|
| `src/js/workflowLibrary.js` | Storage API — all CRUD operations, serialization, validation |
| `src/js/libraryUI.js` | Sidebar and toolbar UI rendering + event wiring |
| `src/css/library.css` | Styles for the sidebar, toolbar, modals, search box |
| `src/js/workflowLibrary.test.js` | Unit tests for storage API (Jasmine/Jest compatible) |
| `src/js/libraryIntegration.test.js` | Integration tests for full workflow lifecycle |

---

## 7. Data Schema & Storage Keys

### 7.1 Storage Key Namespace

All new keys are prefixed with `swf_` to avoid collisions.

| localStorage Key | Value Type | Description |
|---|---|---|
| `"lastSWFJson"` | `string` | **Retained** — active workflow raw JSON (backward compat) |
| `"split-sizes"` | `string` | **Retained** — panel sizes JSON array |
| `"theme"` | `string` | **Retained** — dark/light theme |
| `"swf_library_index"` | `string` | JSON-serialized `WorkflowIndexEntry[]` — the library catalogue |
| `"swf_wf_{id}"` | `string` | JSON-serialized `WorkflowRecord` — one key per saved workflow |
| `"swf_active_id"` | `string` | ID string of the currently loaded workflow, or `null` |
| `"swf_autosave_interval"` | `string` | Number in ms (default `"30000"`) |
| `"swf_schema_version"` | `string` | Library schema version (current: `"1"`) |

### 7.2 WorkflowIndexEntry Schema

Stored in `swf_library_index` as an array. This index is always loaded — it must remain compact.

```jsonc
// WorkflowIndexEntry
{
  "id": "string",           // UUID v4, e.g. "f47ac10b-58cc-4372-a567-0e02b2c3d479"
  "name": "string",         // User-defined display name, max 100 chars
  "description": "string",  // Optional short description, max 300 chars
  "createdAt": "string",    // ISO 8601 timestamp, e.g. "2026-04-10T08:30:00.000Z"
  "modifiedAt": "string",   // ISO 8601 timestamp — updated on every save
  "specVersion": "string",  // SWF specVersion field value, e.g. "0.7" or "0.8.x"
  "stateCount": number,     // Count of states[] — for quick preview
  "tags": ["string"],       // Optional user-defined tags (future use)
  "sizeBytes": number       // Byte size of the stored workflow JSON
}
```

### 7.3 WorkflowRecord Schema

Stored individually at `swf_wf_{id}`. Contains the full workflow content.

```jsonc
// WorkflowRecord
{
  "id": "string",             // UUID v4 (same as index entry)
  "schemaVersion": "1",       // Library schema version — for migration
  "checksum": "string",       // CRC32 or SHA-1 hex of `content` — for corruption detection
  "content": "string",        // Raw workflow JSON string (exactly as typed in editor)
  "contentEncoding": "none",  // Reserved: "none" | "base64" | "gzip+base64"
  "createdAt": "string",      // ISO 8601
  "modifiedAt": "string"      // ISO 8601
}
```

### 7.4 UUID Generation

UUID v4 is generated without external libraries using the `crypto.getRandomValues` API:

```javascript
function generateUUID() {
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}
```

Fallback (no `crypto.getRandomValues`):

```javascript
function generateUUIDFallback() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
```

---

## 8. Storage API Design

All functions live in `src/js/workflowLibrary.js`, exposed as a global `WorkflowLibrary` object.

### 8.1 Public API

```javascript
const WorkflowLibrary = {

  // --- Index operations ---

  /**
   * Returns all WorkflowIndexEntry objects sorted by modifiedAt DESC.
   * @returns {WorkflowIndexEntry[]}
   */
  listWorkflows(),

  /**
   * Returns a single WorkflowIndexEntry by id, or null.
   * @param {string} id
   * @returns {WorkflowIndexEntry | null}
   */
  getIndexEntry(id),

  // --- CRUD operations ---

  /**
   * Save current editor content as a new workflow.
   * @param {string} name         Display name (required)
   * @param {string} jsonContent  Raw workflow JSON string
   * @param {string} [description]
   * @param {string[]} [tags]
   * @returns {{ ok: true, id: string } | { ok: false, error: string }}
   */
  createWorkflow(name, jsonContent, description, tags),

  /**
   * Overwrite the content of an existing workflow record.
   * Updates modifiedAt and refreshes the index.
   * @param {string} id
   * @param {string} jsonContent
   * @returns {{ ok: true } | { ok: false, error: string }}
   */
  saveWorkflow(id, jsonContent),

  /**
   * Load a workflow's raw JSON content. Verifies checksum before returning.
   * @param {string} id
   * @returns {{ ok: true, content: string } | { ok: false, error: string }}
   */
  loadWorkflow(id),

  /**
   * Rename a workflow and optionally update its description.
   * @param {string} id
   * @param {string} newName
   * @param {string} [newDescription]
   * @returns {{ ok: true } | { ok: false, error: string }}
   */
  renameWorkflow(id, newName, newDescription),

  /**
   * Duplicate a workflow under a new name.
   * @param {string} id
   * @param {string} newName
   * @returns {{ ok: true, newId: string } | { ok: false, error: string }}
   */
  duplicateWorkflow(id, newName),

  /**
   * Delete a workflow record and its index entry.
   * @param {string} id
   * @returns {{ ok: true } | { ok: false, error: string }}
   */
  deleteWorkflow(id),

  // --- Search ---

  /**
   * Full-text search across name, description, and tags.
   * @param {string} query
   * @returns {WorkflowIndexEntry[]}
   */
  searchWorkflows(query),

  /**
   * Filter by specVersion, stateCount range, date range.
   * @param {FilterOptions} options
   * @returns {WorkflowIndexEntry[]}
   */
  filterWorkflows(options),

  // --- Active workflow tracking ---

  /**
   * Set the currently active workflow id (persisted to swf_active_id).
   * @param {string | null} id
   */
  setActiveId(id),

  /**
   * Get the currently active workflow id.
   * @returns {string | null}
   */
  getActiveId(),

  // --- Export / Import ---

  /**
   * Serialize a workflow to a downloadable JSON string (with metadata).
   * @param {string} id
   * @returns {{ ok: true, json: string, filename: string } | { ok: false, error: string }}
   */
  exportWorkflow(id),

  /**
   * Parse an imported file string, validate it, and add it to the library.
   * Supports both raw SWF JSON and WorkflowRecord export bundles.
   * @param {string} fileContent
   * @param {string} [filename]
   * @returns {{ ok: true, id: string } | { ok: false, error: string }}
   */
  importWorkflow(fileContent, filename),

  // --- Batch operations ---

  /**
   * Export the entire library as a single JSON bundle.
   * @returns {string} JSON string of { schemaVersion, exportedAt, workflows: WorkflowRecord[] }
   */
  exportLibrary(),

  /**
   * Import a full library bundle (merge, no duplicates by id).
   * @param {string} bundleJson
   * @returns {{ ok: true, imported: number, skipped: number } | { ok: false, error: string }}
   */
  importLibrary(bundleJson),

  // --- Utility ---

  /**
   * Estimate total localStorage bytes used by the library.
   * @returns { used: number, quota: number | null }
   */
  getStorageUsage(),

  /**
   * Detect and repair index/record inconsistencies (orphaned records, missing records).
   * @returns { repaired: string[], removed: string[] }
   */
  repairLibrary(),

  /**
   * Clear the entire library (irreversible). Used for testing and reset.
   */
  clearLibrary(),

  // --- Migration ---

  /**
   * Run on startup. If no swf_library_index exists but lastSWFJson does,
   * migrate the single legacy workflow into the library.
   * @returns {{ migrated: boolean }}
   */
  migrateLegacyWorkflow(),
};
```

### 8.2 FilterOptions Type

```javascript
/**
 * @typedef {Object} FilterOptions
 * @property {string[]} [specVersions]  - Filter by one or more specVersion values
 * @property {number} [minStates]       - Minimum state count
 * @property {number} [maxStates]       - Maximum state count
 * @property {string} [modifiedAfter]   - ISO 8601 — only show workflows modified after this
 * @property {string} [modifiedBefore]  - ISO 8601 — only show workflows modified before this
 * @property {string[]} [tags]          - Must include ALL listed tags
 */
```

### 8.3 Checksum Implementation

A simple CRC32 checksum is computed over the `content` string before storing and verified on load:

```javascript
function crc32(str) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i);
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0');
}
```

On `loadWorkflow(id)`: if `crc32(record.content) !== record.checksum`, return `{ ok: false, error: "CHECKSUM_MISMATCH" }`.

### 8.4 Storage Quota Handling

Before writing, estimate the byte impact using `JSON.stringify().length * 2` (UTF-16 approximation). Use the Storage API (`navigator.storage.estimate()`) where available to get real quota information.

```javascript
async function checkQuotaBeforeWrite(newDataStr) {
  const available = await getRemainingQuota(); // may return null in older browsers
  const needed = newDataStr.length * 2;        // UTF-16 bytes estimate
  if (available !== null && needed > available) {
    return { ok: false, error: "QUOTA_EXCEEDED" };
  }
  return { ok: true };
}
```

Always wrap `localStorage.setItem` in a `try/catch` and handle `DOMException` with `name === "QuotaExceededError"`.

---

## 9. UI Components Design

### 9.1 Layout Change

The current layout is a pure two-column split (`#editor-col` | `#diagram-col`). The new layout adds a **Library Sidebar** as a fixed-width left panel, making the overall structure a three-column layout:

```
[ Library Sidebar (260px) ] | [ Editor Column (flex) ] | [ Diagram Column (flex) ]
```

The Library Sidebar is collapsible to a 36px icon strip. Collapse state is persisted to `localStorage["swf_sidebar_collapsed"]`.

### 9.2 Library Sidebar (`#library-sidebar`)

```html
<div id="library-sidebar" class="library-sidebar theme">

  <!-- Sidebar header -->
  <div class="library-header">
    <span class="library-title">Workflows</span>
    <button id="sidebar-collapse-btn" title="Collapse sidebar">«</button>
  </div>

  <!-- Action buttons -->
  <div class="library-actions">
    <button id="lib-new-btn" class="btn btn-sm btn-primary" title="New workflow">
      <i class="fa fa-plus"></i> New
    </button>
    <button id="lib-import-btn" class="btn btn-sm btn-secondary" title="Import JSON/YAML">
      <i class="fa fa-upload"></i> Import
    </button>
  </div>

  <!-- Search box -->
  <div class="library-search">
    <input type="text" id="lib-search-input" placeholder="Search workflows…" autocomplete="off" />
    <button id="lib-search-clear" class="btn-icon" title="Clear search">✕</button>
  </div>

  <!-- Sort/filter controls -->
  <div class="library-filter-bar">
    <select id="lib-sort-select">
      <option value="modifiedAt-desc">Recently modified</option>
      <option value="modifiedAt-asc">Oldest modified</option>
      <option value="name-asc">Name A–Z</option>
      <option value="name-desc">Name Z–A</option>
      <option value="createdAt-desc">Recently created</option>
    </select>
  </div>

  <!-- Workflow list -->
  <ul id="lib-workflow-list" class="library-workflow-list">
    <!-- WorkflowListItem rendered per entry -->
  </ul>

  <!-- Storage usage footer -->
  <div class="library-footer">
    <span id="lib-storage-info">0 workflows · 0 KB used</span>
  </div>

</div>
```

### 9.3 Workflow List Item

Each entry in `#lib-workflow-list` renders as:

```html
<li class="workflow-item [active]" data-id="{id}">
  <div class="workflow-item-main">
    <span class="workflow-item-name">{name}</span>
    <span class="workflow-item-meta">{stateCount} states · {specVersion}</span>
    <span class="workflow-item-date">{relativeTime(modifiedAt)}</span>  <!-- e.g. "3 min ago" -->
  </div>
  <div class="workflow-item-actions">
    <button class="btn-icon lib-load-btn"     title="Load">↓</button>
    <button class="btn-icon lib-rename-btn"   title="Rename">✏</button>
    <button class="btn-icon lib-duplicate-btn" title="Duplicate">⧉</button>
    <button class="btn-icon lib-export-btn"   title="Export JSON">⬇</button>
    <button class="btn-icon lib-delete-btn"   title="Delete">🗑</button>
  </div>
</li>
```

The currently loaded workflow gets the `.active` class and a colored left border.

### 9.4 Editor Toolbar

A new toolbar bar is placed above the editor column (below the Format button area):

```html
<div id="editor-toolbar" class="editor-toolbar theme">
  <div class="toolbar-left">
    <span id="active-workflow-name" class="workflow-name-display">
      Unsaved workflow
    </span>
    <span id="autosave-status" class="autosave-status">
      <!-- "Saving…" | "Saved" | "Unsaved changes" -->
    </span>
  </div>
  <div class="toolbar-right">
    <button id="tb-save-btn"    class="btn btn-sm btn-success">Save</button>
    <button id="tb-save-as-btn" class="btn btn-sm btn-outline-primary">Save As…</button>
    <button id="tb-new-btn"     class="btn btn-sm btn-outline-secondary">New</button>
  </div>
</div>
```

### 9.5 Modals

All modals use Bootstrap 4 modal markup (already loaded via CDN). Four modals are needed:

#### Modal 1: New / Save As (`#modal-save-as`)

```
┌─────────────────────────────────────────┐
│  Save Workflow As                     ✕ │
├─────────────────────────────────────────┤
│  Name *     [____________________________] │
│  Description [____________________________] │
│             (optional, max 300 chars)     │
│                                           │
│             [Cancel]  [Save]              │
└─────────────────────────────────────────┘
```

#### Modal 2: Delete Confirmation (`#modal-confirm-delete`)

```
┌─────────────────────────────────────────┐
│  Delete Workflow                      ✕ │
├─────────────────────────────────────────┤
│  Are you sure you want to delete        │
│  "{workflow name}"?                     │
│                                         │
│  This action cannot be undone.          │
│                                         │
│             [Cancel]  [Delete]          │
└─────────────────────────────────────────┘
```

#### Modal 3: Rename (`#modal-rename`)

```
┌─────────────────────────────────────────┐
│  Rename Workflow                      ✕ │
├─────────────────────────────────────────┤
│  New name * [____________________________] │
│  Description [____________________________] │
│                                           │
│             [Cancel]  [Rename]            │
└─────────────────────────────────────────┘
```

#### Modal 4: Import (`#modal-import`)

```
┌─────────────────────────────────────────┐
│  Import Workflow                      ✕ │
├─────────────────────────────────────────┤
│  Drag & drop a .json or .yaml file here │
│  ┌───────────────────────────────────┐  │
│  │        [Browse files]             │  │
│  └───────────────────────────────────┘  │
│  — or paste JSON below —               │
│  [________________________________]    │
│  [________________________________]    │
│                                         │
│             [Cancel]  [Import]          │
└─────────────────────────────────────────┘
```

### 9.6 Unsaved Changes Guard

When the user tries to load a different workflow while having unsaved changes (detected by comparing current editor value against last saved content), show an inline confirmation banner above the editor:

```
⚠ You have unsaved changes.  [Save Now]  [Discard & Load]  [Cancel]
```

### 9.7 Toast Notifications

Lightweight toast messages (no library needed — plain CSS + JS) for non-blocking feedback:

- "Workflow saved" (success, 2s)
- "Workflow deleted" (info, 2s)
- "Import successful — 'Name' added" (success, 3s)
- "Storage quota warning: 85% used" (warning, persistent)
- "Storage quota exceeded. Please delete old workflows." (error, persistent)
- "Checksum mismatch detected in 'Name'. Data may be corrupted." (error, persistent)

---

## 10. Auto-Save Implementation

### 10.1 Behavior

Auto-save writes the current editor content back to the **active workflow** (if one is loaded) using `WorkflowLibrary.saveWorkflow(activeId, content)`. It does NOT auto-create named workflows for unsaved content — unsaved content continues to be written to `localStorage["lastSWFJson"]` only.

### 10.2 Implementation

```javascript
// In workflowLibrary.js
const AutoSave = {
  _timerId: null,
  _lastSavedContent: null,
  _interval: parseInt(localStorage.getItem('swf_autosave_interval') || '30000', 10),

  start() {
    this.stop();
    this._timerId = setInterval(() => this._tick(), this._interval);
  },

  stop() {
    if (this._timerId !== null) {
      clearInterval(this._timerId);
      this._timerId = null;
    }
  },

  _tick() {
    const activeId = WorkflowLibrary.getActiveId();
    if (!activeId) return;                          // Nothing to auto-save

    const model = monaco.editor.getModels()[0];
    const content = model.getValue();

    if (content === this._lastSavedContent) return; // No changes since last save

    const result = WorkflowLibrary.saveWorkflow(activeId, content);
    if (result.ok) {
      this._lastSavedContent = content;
      LibraryUI.showAutosaveStatus('saved');
    } else {
      LibraryUI.showAutosaveStatus('error', result.error);
    }
  },

  setInterval(ms) {
    this._interval = ms;
    localStorage.setItem('swf_autosave_interval', String(ms));
    this.start(); // Restart with new interval
  },

  markDirty() {
    LibraryUI.showAutosaveStatus('unsaved');
  },
};
```

### 10.3 Auto-Save Status Display

The `#autosave-status` span shows:

| State | Text | CSS class |
|---|---|---|
| No active workflow | _(hidden)_ | — |
| Content changed | "Unsaved changes" | `.status-dirty` |
| Auto-saving | "Saving…" | `.status-saving` |
| Saved | "Saved" (fades after 3s) | `.status-saved` |
| Error | "Save failed" | `.status-error` |

### 10.4 Integration with Monaco `onDidChangeContent`

The existing `mountEditor()` function calls `saveToLocalStorage()` on each change. The new system extends this:

```javascript
function mountEditor() {
  monaco.editor.getModels()[0].onDidChangeContent(e => {
    saveToLocalStorage();    // Retain: still writes to lastSWFJson for backward compat
    AutoSave.markDirty();   // New: update the toolbar status indicator
  });
}
```

---

## 11. Export & Import Implementation

### 11.1 Export Single Workflow

`WorkflowLibrary.exportWorkflow(id)` produces a **bundle file** (not raw SWF JSON) with this shape:

```jsonc
{
  "exportFormat": "swf-library-export",
  "formatVersion": "1",
  "exportedAt": "2026-04-10T08:30:00.000Z",
  "workflow": {
    // full WorkflowRecord object
  }
}
```

The file is triggered as a browser download via a programmatic `<a download>` click, named `{workflow-name}.swf.json`.

### 11.2 Import Logic

`WorkflowLibrary.importWorkflow(fileContent, filename)` handles two cases:

**Case A — Bundle import** (exported from this tool):
- Detect `"exportFormat": "swf-library-export"` key
- Extract `workflow.content`, validate JSON structure with the SWF SDK
- Assign a new UUID (to avoid ID collisions)
- Save as a new WorkflowRecord

**Case B — Raw SWF JSON** (pasted or from external source):
- No `exportFormat` key detected
- Attempt `Specification.Workflow.fromSource(fileContent)` — if it throws, reject
- Derive name from `json.name` field or from filename (strip `.json`/`.yaml`)
- Save as a new WorkflowRecord with derived metadata

**Case C — YAML** (`.yaml` or `.yml` extension):
- The SDK's `Specification.Workflow.fromSource()` already handles YAML
- Parse → get the JS object → re-serialize to JSON → save as Case B

### 11.3 Drag & Drop Support

The import modal's drop zone listens for `dragover` and `drop` events. On drop, read the file with `FileReader.readAsText()` and pass to the import logic above.

### 11.4 Library Bundle Export/Import

"Export Library" downloads a JSON file with **all** workflows:

```jsonc
{
  "exportFormat": "swf-library-bundle",
  "formatVersion": "1",
  "exportedAt": "2026-04-10T08:30:00.000Z",
  "workflowCount": 5,
  "workflows": [ /* WorkflowRecord[] */ ]
}
```

"Import Library" reads a bundle file, iterates the `workflows` array, and calls `importWorkflow()` for each entry that does not already exist (by `id`).

---

## 12. Search & Filtering

### 12.1 Search Algorithm

The search is entirely in-memory on the `WorkflowIndexEntry[]` array. No indexing library needed at this scale (typical library: < 100 workflows).

```javascript
function searchWorkflows(query) {
  const q = query.toLowerCase().trim();
  if (!q) return WorkflowLibrary.listWorkflows();

  return WorkflowLibrary.listWorkflows().filter(entry =>
    entry.name.toLowerCase().includes(q) ||
    (entry.description || '').toLowerCase().includes(q) ||
    (entry.tags || []).some(t => t.toLowerCase().includes(q))
  );
}
```

### 12.2 Sort Options

| Option | Implementation |
|---|---|
| Recently modified | Sort by `modifiedAt` DESC |
| Oldest modified | Sort by `modifiedAt` ASC |
| Name A–Z | Sort by `name` ASC (locale-aware) |
| Name Z–A | Sort by `name` DESC |
| Recently created | Sort by `createdAt` DESC |

### 12.3 Filter Panel (Future Enhancement)

A collapsible filter panel below the search box (hidden by default, toggled with a "Filters" button) provides:

- Spec version checkboxes (0.7, 0.8.x)
- State count range slider (min/max)
- Date range pickers (modified after, modified before)

---

## 13. Confirmation Dialogs

All destructive operations require confirmation. The Bootstrap 4 modal system is used (already loaded).

### 13.1 Delete Confirmation

Triggered by `lib-delete-btn`. Before showing the modal:

- Set `#modal-confirm-delete .modal-workflow-name` to the workflow's name
- Store the pending `id` in a `data-pending-id` attribute on the modal
- On "Delete" click: call `WorkflowLibrary.deleteWorkflow(pendingId)`, refresh list, show toast

### 13.2 Unsaved Changes Guard

On `lib-load-btn` click OR `tb-new-btn` click:

1. Compare `monaco.editor.getModels()[0].getValue()` with the last saved content
2. If different, show the inline banner: "You have unsaved changes. [Save Now] [Discard & Load] [Cancel]"
3. "Save Now" triggers `WorkflowLibrary.saveWorkflow(activeId, currentContent)` then loads the target
4. "Discard & Load" loads without saving
5. "Cancel" dismisses the banner and does nothing

### 13.3 Clear Library Confirmation

A "Clear all" option in a settings panel requires typing "DELETE" into a text field before the button becomes enabled (similar to GitHub repository deletion UX).

---

## 14. Error Handling & Quota Management

### 14.1 Error Code Catalogue

All API functions return either `{ ok: true, ... }` or `{ ok: false, error: ErrorCode, message?: string }`.

| Error Code | Trigger |
|---|---|
| `QUOTA_EXCEEDED` | `localStorage.setItem` throws `QuotaExceededError` |
| `CHECKSUM_MISMATCH` | Computed checksum ≠ stored checksum on `loadWorkflow` |
| `INVALID_JSON` | `JSON.parse` fails on stored record |
| `INVALID_SWF` | SDK's `Workflow.fromSource()` throws on stored content |
| `RECORD_NOT_FOUND` | `localStorage.getItem("swf_wf_{id}")` returns null |
| `INDEX_NOT_FOUND` | `swf_library_index` key is missing or unparseable |
| `DUPLICATE_NAME` | User tries to save with a name that already exists |
| `NAME_TOO_LONG` | Name exceeds 100 chars |
| `DESCRIPTION_TOO_LONG` | Description exceeds 300 chars |
| `IMPORT_FORMAT_UNKNOWN` | File is neither valid SWF JSON/YAML nor a bundle |
| `STORAGE_UNAVAILABLE` | `localStorage` access throws (private browsing mode, etc.) |

### 14.2 Storage Availability Check

On application startup, run:

```javascript
function isStorageAvailable() {
  try {
    const testKey = '__swf_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch (e) {
    return false;
  }
}
```

If storage is unavailable, show a persistent banner: "Local storage is not available in this browser. Workflows will not be saved." Disable all save/library buttons.

### 14.3 Quota Warning Thresholds

| Used % | Action |
|---|---|
| ≥ 80% | Show yellow warning toast |
| ≥ 95% | Show red persistent error banner with a "Manage Workflows" link that opens the library sidebar |
| 100% | Reject the write, show error, suggest deleting old workflows |

### 14.4 Browser Compatibility

The library is tested against:

- Chrome 90+ (full support)
- Firefox 88+ (full support)
- Safari 14+ (full support; Private Browsing: storage unavailable gracefully handled)
- Edge 90+ (full support)
- IE 11: **not supported** — the codebase already uses arrow functions and template literals

---

## 15. Validation & Corruption Detection

### 15.1 Index Validation

On startup (`WorkflowLibrary.migrateLegacyWorkflow()` → `repairLibrary()`):

1. Parse `swf_library_index` — if `JSON.parse` fails, attempt to recover from `swf_wf_*` keys
2. For each entry in the index, verify `swf_wf_{id}` key exists
3. For each `swf_wf_*` key in localStorage, verify it has a corresponding index entry
4. Repair mismatches: orphaned records get added back to the index; missing records get removed from the index

### 15.2 Record Validation

`loadWorkflow(id)` performs:

1. `JSON.parse(rawRecord)` — if fails → `INVALID_JSON`
2. `crc32(record.content) === record.checksum` — if fails → `CHECKSUM_MISMATCH`
3. `Specification.Workflow.fromSource(record.content)` — if throws → `INVALID_SWF` (soft warning, not a hard error — still return content to user)

### 15.3 Schema Migration

The `swf_schema_version` key tracks the library data schema. On startup, if the version in storage < current:

```javascript
function migrateIfNeeded() {
  const storedVersion = parseInt(localStorage.getItem('swf_schema_version') || '0', 10);
  const currentVersion = 1;
  if (storedVersion < currentVersion) {
    runMigrations(storedVersion, currentVersion);
    localStorage.setItem('swf_schema_version', String(currentVersion));
  }
}
```

Migration functions are versioned:
- `migration_0_to_1()`: Reads `lastSWFJson`, creates a WorkflowRecord from it if valid, adds to library

---

## 16. Backward Compatibility

### 16.1 Retained Behavior

- `localStorage["lastSWFJson"]` continues to be written on every keystroke (existing `saveToLocalStorage()` is not modified)
- `localStorage["split-sizes"]` behavior is unchanged
- `localStorage["theme"]` behavior is unchanged
- The Monaco model initialization in `index.html` (lines 90–96) is unchanged — it still falls back to `customerApplication`
- `generateDiagram()`, `formatJSON()`, `generateImageFromSVG()` are unchanged

### 16.2 Migration Path for Existing Users

On first load after the update:

1. `WorkflowLibrary.migrateLegacyWorkflow()` is called
2. If `swf_library_index` does NOT exist AND `lastSWFJson` DOES exist:
   - Parse the `lastSWFJson` content
   - Extract `name` from the parsed JSON (or default to "Imported Workflow")
   - Call `WorkflowLibrary.createWorkflow(name, content, "Migrated from previous session")`
   - Set the new workflow as active (`WorkflowLibrary.setActiveId(newId)`)
3. Show a toast: "Your previous workflow was saved to the library as '{name}'."
4. Set `swf_schema_version` to `"1"`

### 16.3 No-Library Fallback

If the library UI fails to initialize (JS error), the core editor continues to function normally using the existing `lastSWFJson` mechanism. The library UI is layered on top, not replacing core functionality.

---

## 17. Testing Plan

### 17.1 Unit Tests (`workflowLibrary.test.js`)

Tests use a mock localStorage (`window.localStorage` replaced with an in-memory map in the test harness).

| Test Suite | Tests |
|---|---|
| **createWorkflow** | Creates record + index entry; rejects missing name; rejects duplicate name; rejects name > 100 chars; returns UUID |
| **saveWorkflow** | Updates content + checksum + modifiedAt; returns error for unknown id |
| **loadWorkflow** | Returns content; returns CHECKSUM_MISMATCH on corrupted data; returns RECORD_NOT_FOUND |
| **renameWorkflow** | Updates name in index; rejects duplicate name; rejects unknown id |
| **duplicateWorkflow** | Creates new record with new UUID; original unchanged |
| **deleteWorkflow** | Removes record + index entry; returns error for unknown id |
| **searchWorkflows** | Matches on name; matches on description; case-insensitive; empty query returns all |
| **filterWorkflows** | Filters by specVersion; filters by state count range; filters by date range |
| **exportWorkflow** | Returns bundle JSON with exportFormat key; valid JSON |
| **importWorkflow** | Imports bundle format; imports raw SWF JSON; imports YAML; rejects invalid JSON |
| **exportLibrary** | Contains all workflow records; valid JSON |
| **importLibrary** | Merges without duplicates; returns imported/skipped counts |
| **getStorageUsage** | Returns numeric `used` value |
| **repairLibrary** | Removes index entries without records; adds orphaned records to index |
| **migrateLegacyWorkflow** | Creates library entry from lastSWFJson; skips if library already exists |
| **crc32** | Known input/output pairs; consistent results |
| **generateUUID** | Returns v4-format UUID; uniqueness across 10,000 calls |
| **Quota handling** | setItem throws QuotaExceededError → returns QUOTA_EXCEEDED |
| **Storage unavailable** | localStorage unavailable → isStorageAvailable() returns false |

### 17.2 Integration Tests (`libraryIntegration.test.js`)

Using a headless browser (Puppeteer) or JSDOM:

| Scenario | Steps |
|---|---|
| **Full create/load lifecycle** | Create workflow → load it → edit content → save → verify content persisted |
| **Multiple workflows** | Create 5 workflows → list shows 5 → each loads correct content |
| **Delete active workflow** | Load workflow A → delete it → editor shows unsaved state |
| **Auto-save** | Load workflow → edit → wait for interval → verify save without explicit button press |
| **Export then import** | Export workflow → delete it → import the file → verify restored |
| **Library bundle roundtrip** | Export library → clear library → import bundle → verify all workflows restored |
| **Legacy migration** | Set lastSWFJson → initialize library → verify migrated workflow appears |
| **Corruption recovery** | Manually corrupt checksum → load → verify CHECKSUM_MISMATCH error shown |
| **Search** | Create 3 workflows with different names → search → verify correct results |
| **Quota exceeded UX** | Fill storage near limit → attempt save → verify error toast shown |
| **Unsaved changes guard** | Edit workflow → try to load another → verify confirmation shown |

### 17.3 Manual Test Cases

| Test | Expected Result |
|---|---|
| Open editor fresh (no localStorage) | Library sidebar shows 0 workflows; editor shows `customerApplication` |
| Save current workflow | Modal prompts for name; on save, entry appears in list |
| Load a saved workflow | Editor content changes; active item highlighted in list |
| Edit and auto-save fires | "Saved" status appears in toolbar after interval |
| Delete last workflow | Library shows empty state message |
| Import corrupted JSON file | Error shown; library unchanged |
| Fill localStorage and try to save | Quota exceeded error shown; existing data safe |
| Collapse/expand sidebar | Layout adjusts; state persists on reload |
| Dark/light theme toggle | Sidebar adopts correct theme; persists on reload |

---

## 18. Phased Implementation Roadmap

### Phase 1 — Storage API (Foundation)

**Files:** `src/js/workflowLibrary.js`

1. Implement `generateUUID()` with crypto fallback
2. Implement `crc32()` checksum
3. Implement `isStorageAvailable()` guard
4. Implement `listWorkflows()`, `createWorkflow()`, `saveWorkflow()`, `loadWorkflow()`
5. Implement `renameWorkflow()`, `duplicateWorkflow()`, `deleteWorkflow()`
6. Implement `getActiveId()`, `setActiveId()`
7. Implement `migrateLegacyWorkflow()` — backward compat migration
8. Write all unit tests for the above
9. Verify all tests pass against a mock localStorage

**Exit criterion:** All unit tests green; no changes to existing `sweditor.js` or `index.html`.

### Phase 2 — Export/Import & Search

**Files:** `src/js/workflowLibrary.js` (extended)

1. Implement `exportWorkflow()` with file download trigger
2. Implement `importWorkflow()` supporting bundle, raw JSON, and YAML
3. Implement `exportLibrary()` and `importLibrary()`
4. Implement `searchWorkflows()` and `filterWorkflows()`
5. Implement `repairLibrary()` and `getStorageUsage()`
6. Implement `migrateIfNeeded()` schema version check
7. Write integration tests for export/import roundtrips

**Exit criterion:** Full API surface implemented; import/export roundtrip tests pass.

### Phase 3 — UI: Sidebar & Toolbar

**Files:** `src/css/library.css`, `src/js/libraryUI.js`, `src/index.html` (additions only)

1. Add `library.css` with sidebar, toolbar, workflow-item, toast styles
2. Add `#library-sidebar` HTML to `index.html`
3. Add `#editor-toolbar` HTML above the editor column
4. Add all four modal HTML blocks to `index.html`
5. Implement `libraryUI.js`:
   - `LibraryUI.init()` — wires all event listeners
   - `LibraryUI.renderList(entries)` — renders `#lib-workflow-list`
   - `LibraryUI.renderItem(entry, isActive)` — renders a single `<li>`
   - `LibraryUI.showToast(message, type, duration)` — toast notifications
   - `LibraryUI.showAutosaveStatus(state)` — updates toolbar status span
   - `LibraryUI.openSaveAsModal()` / `closeSaveAsModal()`
   - `LibraryUI.openDeleteModal(id, name)` / `closeDeleteModal()`
   - `LibraryUI.openRenameModal(id, name, description)` / `closeRenameModal()`
   - `LibraryUI.openImportModal()` / `closeImportModal()`
   - `LibraryUI.showUnsavedChangesGuard(targetId)` / `hideUnsavedChangesGuard()`
   - `LibraryUI.setSidebarCollapsed(bool)` / `getSidebarCollapsed()`
   - `LibraryUI.updateStorageInfo()`
6. Adjust Split.js initialization to account for the sidebar column

**Exit criterion:** Sidebar renders and all CRUD actions work from UI; theme is consistent.

### Phase 4 — Auto-Save Integration

**Files:** `src/js/workflowLibrary.js` (AutoSave object), `src/js/sweditor.js` (small extension)

1. Implement `AutoSave.start()`, `stop()`, `_tick()`, `markDirty()`, `setInterval()`
2. Extend `mountEditor()` in `sweditor.js` to call `AutoSave.markDirty()` on content change
3. Call `AutoSave.start()` in `DOMContentLoaded` after editor initialization
4. Add auto-save interval setting to library sidebar footer (dropdown: 15s / 30s / 1m / 5m / Off)

**Exit criterion:** Changes auto-save at configured interval; toolbar status updates correctly.

### Phase 5 — Error Handling & Hardening

1. Add quota detection to all write operations
2. Add persistent banners for quota warning (80%), critical (95%), exceeded (100%)
3. Add `repairLibrary()` call on startup after `migrateLegacyWorkflow()`
4. Add checksum validation on `loadWorkflow()` with visible error message
5. Test all error paths manually against all target browsers
6. Finalize integration test suite

**Exit criterion:** All error paths have visible feedback; no silent failures.

### Phase 6 — Polish & Documentation

1. Add relative time formatting for `modifiedAt` ("3 min ago", "2 days ago")
2. Add empty state illustration in sidebar when library has 0 workflows
3. Add keyboard shortcuts: `Ctrl/Cmd+S` → Save, `Ctrl/Cmd+Shift+S` → Save As
4. Add `title` attributes and `aria-label` to all interactive elements for accessibility
5. Ensure sidebar and toolbar adapt to narrow viewport widths (collapse sidebar automatically below 768px)
6. Review and finalize this `Implementation.md`

**Exit criterion:** All manual test cases pass; no console errors on any target browser.

---

## Appendix A — Relative Time Formatting

```javascript
function relativeTime(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60)    return 'Just now';
  if (seconds < 3600)  return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}
```

---

## Appendix B — CSS Variables for Theming

```css
:root {
  --lib-bg:             #f8f9fa;
  --lib-border:         #dee2e6;
  --lib-active-bg:      #e8f0fe;
  --lib-active-border:  #448cfb;
  --lib-text:           #212529;
  --lib-meta-text:      #6c757d;
  --lib-hover-bg:       #f0f4ff;
  --lib-btn-icon-color: #495057;
  --lib-width:          260px;
  --lib-width-collapsed: 36px;
}

.darkTheme {
  --lib-bg:             rgb(37, 37, 38);
  --lib-border:         rgb(60, 60, 60);
  --lib-active-bg:      rgb(28, 56, 120);
  --lib-active-border:  #448cfb;
  --lib-text:           #d4d4d4;
  --lib-meta-text:      #9e9e9e;
  --lib-hover-bg:       rgb(42, 45, 62);
  --lib-btn-icon-color: #cccccc;
}
```

---

## Appendix C — localStorage Size Estimation

`localStorage` quota is typically 5–10 MB per origin. Rough capacity estimates:

| Scenario | Storage Used |
|---|---|
| 1 medium workflow (50 states) | ~8 KB per record |
| Index entry per workflow | ~200 bytes |
| 100 workflows | ~800 KB records + 20 KB index |
| 500 workflows | ~4 MB records + 100 KB index |

The quota warning at 80% gives ample headroom for the user to export and clean up before hitting the limit.

---

## 19. Storage Provider Fallback Chain

### 19.1 Motivation

`localStorage` may be blocked or full in three real-world scenarios:

| Scenario | Why It Happens |
|---|---|
| Safari Private Browsing (< 14) | localStorage throws on any write |
| Firefox Enhanced Tracking Protection | May restrict third-party storage |
| localStorage quota exceeded | User stored too many workflows |
| Browser extension blocking | Some privacy extensions block storage |

Rather than crashing or silently losing data, the library falls back through a defined chain.

### 19.2 Provider Interface

All three providers implement the same four-method interface:

```javascript
/**
 * @typedef {Object} StorageProvider
 * @property {string}   name                   - "localStorage" | "sessionStorage" | "memory"
 * @property {function(string): string|null} getItem
 * @property {function(string, string): void}  setItem   - throws StorageError on quota
 * @property {function(string): void}          removeItem
 * @property {function(): string[]}            keys      - returns all stored keys
 */
```

### 19.3 LocalStorageProvider

```javascript
const LocalStorageProvider = {
  name: 'localStorage',

  getItem(key) {
    try { return localStorage.getItem(key); }
    catch (e) { return null; }
  },

  setItem(key, value) {
    // Throws with code "QUOTA_EXCEEDED" or "STORAGE_UNAVAILABLE"
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      if (e instanceof DOMException && (
        e.code === 22 ||                         // Chrome/Firefox legacy code
        e.code === 1014 ||                       // Firefox NS_ERROR_DOM_QUOTA_REACHED
        e.name === 'QuotaExceededError' ||
        e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
      )) {
        throw { code: 'QUOTA_EXCEEDED', original: e };
      }
      throw { code: 'STORAGE_UNAVAILABLE', original: e };
    }
  },

  removeItem(key) {
    try { localStorage.removeItem(key); } catch (_) { /* no-op */ }
  },

  keys() {
    const result = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        result.push(localStorage.key(i));
      }
    } catch (_) { /* private mode */ }
    return result;
  },
};
```

### 19.4 SessionStorageProvider

Identical to `LocalStorageProvider` but uses `sessionStorage`. Data survives tab reload but not browser close. Suitable for the current session when `localStorage` is blocked.

```javascript
const SessionStorageProvider = {
  name: 'sessionStorage',
  // ... same structure as LocalStorageProvider but s/localStorage/sessionStorage/
};
```

### 19.5 InMemoryProvider

JavaScript `Map`-based. Data lives only until page unload. The user can still export workflows to file before closing.

```javascript
const InMemoryProvider = (() => {
  const store = new Map();
  return {
    name: 'memory',
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
    keys: () => [...store.keys()],
  };
})();
```

### 19.6 Provider Selection at Startup

```javascript
function selectStorageProvider() {
  const testKey = '__swf_probe__';

  // Try localStorage
  try {
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return LocalStorageProvider;
  } catch (_) { /* fall through */ }

  // Try sessionStorage
  try {
    sessionStorage.setItem(testKey, '1');
    sessionStorage.removeItem(testKey);
    return SessionStorageProvider;
  } catch (_) { /* fall through */ }

  // Final fallback
  return InMemoryProvider;
}

// Called once during WorkflowLibrary.init()
let _provider = null;

function getProvider() {
  if (!_provider) throw new Error('WorkflowLibrary not initialized');
  return _provider;
}
```

### 19.7 UI Indicator for Provider Type

When the active provider is NOT `localStorage`, display a non-blocking badge in the library sidebar footer:

| Provider | Badge text | Badge color |
|---|---|---|
| `localStorage` | _(no badge)_ | — |
| `sessionStorage` | "Session only — data lost on close" | Yellow |
| `memory` | "No storage — export to keep work" | Orange |

---

## 20. Library Settings & Preferences Schema

### 20.1 Storage Key

Settings are stored at `swf_settings` as a JSON string. This key survives schema migrations.

### 20.2 Full Settings Schema

```jsonc
// swf_settings value
{
  "schemaVersion": "1",
  "autosave": {
    "enabled": true,            // false = auto-save disabled entirely
    "intervalMs": 30000,        // 15000 | 30000 | 60000 | 300000
    "debounceMs": 1500          // delay after last keystroke before dirty-save fires
  },
  "sidebar": {
    "collapsed": false,         // true = sidebar in icon-strip mode
    "width": 260,               // user-dragged width in px (min 180, max 400)
    "sortBy": "modifiedAt-desc" // active sort option id
  },
  "editor": {
    "confirmOnLoad": true,      // show unsaved-changes guard when loading another workflow
    "mirrorToLegacyKey": true   // keep writing lastSWFJson for backward compat
  }
}
```

### 20.3 Settings API

These helpers live inside `workflowLibrary.js`:

```javascript
const Settings = {
  _defaults: {
    schemaVersion: '1',
    autosave: { enabled: true, intervalMs: 30000, debounceMs: 1500 },
    sidebar: { collapsed: false, width: 260, sortBy: 'modifiedAt-desc' },
    editor: { confirmOnLoad: true, mirrorToLegacyKey: true },
  },

  load() {
    try {
      const raw = getProvider().getItem('swf_settings');
      if (!raw) return { ...this._defaults };
      return { ...this._defaults, ...JSON.parse(raw) };
    } catch (_) {
      return { ...this._defaults };
    }
  },

  save(patch) {
    const current = this.load();
    const updated = deepMerge(current, patch);
    try {
      getProvider().setItem('swf_settings', JSON.stringify(updated));
    } catch (_) { /* best-effort — settings are non-critical */ }
    return updated;
  },

  get(path) {
    // path is dot-notation string, e.g. "autosave.intervalMs"
    return path.split('.').reduce((obj, k) => obj?.[k], this.load());
  },
};
```

### 20.4 Auto-Save Interval Options (UI)

The sidebar footer contains a settings row rendered as:

```
Auto-save: [Every 15s ▾]
           [Every 30s ▾]  ← default
           [Every 1m  ▾]
           [Every 5m  ▾]
           [Off        ]
```

Changing the dropdown calls `Settings.save({ autosave: { intervalMs: value } })` and `AutoSave.setInterval(value)` (or `AutoSave.stop()` for "Off").

---

## 21. Complete CSS Specification for `library.css`

`library.css` is loaded in `index.html` after `sws.css`. It uses the CSS custom properties defined in Appendix B. All selectors follow the existing Bootstrap 4 conventions already in the project.

```css
/* =====================================================
   library.css — Workflow Library UI Styles
   ===================================================== */

/* --- Layout ----------------------------------------- */

.app-container {
  display: flex;
  flex-direction: row;
  height: 100vh;
  overflow: hidden;
}

#library-sidebar {
  width: var(--lib-width);
  min-width: var(--lib-width);
  max-width: var(--lib-width);
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: var(--lib-bg);
  border-right: 1px solid var(--lib-border);
  transition: width 0.2s ease, min-width 0.2s ease;
  overflow: hidden;
  flex-shrink: 0;
}

#library-sidebar.collapsed {
  width: var(--lib-width-collapsed);
  min-width: var(--lib-width-collapsed);
}

#library-sidebar.collapsed .library-title,
#library-sidebar.collapsed .library-actions,
#library-sidebar.collapsed .library-search,
#library-sidebar.collapsed .library-filter-bar,
#library-sidebar.collapsed #lib-workflow-list,
#library-sidebar.collapsed .library-footer-text {
  display: none;
}

.split-host {
  display: flex;
  flex-direction: row;
  flex: 1;
  overflow: hidden;
}

/* --- Sidebar Header --------------------------------- */

.library-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--lib-border);
  flex-shrink: 0;
}

.library-title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--lib-meta-text);
}

#sidebar-collapse-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--lib-btn-icon-color);
  font-size: 14px;
  padding: 2px 4px;
  line-height: 1;
  border-radius: 3px;
}

#sidebar-collapse-btn:hover {
  background-color: var(--lib-hover-bg);
}

/* --- Action Buttons --------------------------------- */

.library-actions {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  flex-shrink: 0;
}

.library-actions .btn {
  flex: 1;
  font-size: 12px;
}

/* --- Search ----------------------------------------- */

.library-search {
  display: flex;
  align-items: center;
  margin: 0 12px 6px;
  border: 1px solid var(--lib-border);
  border-radius: 4px;
  overflow: hidden;
  flex-shrink: 0;
}

#lib-search-input {
  flex: 1;
  border: none;
  outline: none;
  padding: 5px 8px;
  font-size: 12px;
  background-color: var(--lib-bg);
  color: var(--lib-text);
}

#lib-search-clear {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 7px;
  color: var(--lib-meta-text);
  font-size: 12px;
  line-height: 1;
}

#lib-search-clear:hover {
  color: var(--lib-text);
}

/* --- Filter Bar ------------------------------------- */

.library-filter-bar {
  padding: 0 12px 6px;
  flex-shrink: 0;
}

#lib-sort-select {
  width: 100%;
  font-size: 11px;
  padding: 3px 6px;
  border: 1px solid var(--lib-border);
  border-radius: 4px;
  background-color: var(--lib-bg);
  color: var(--lib-text);
  cursor: pointer;
}

/* --- Workflow List ---------------------------------- */

.library-workflow-list {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.library-workflow-list::-webkit-scrollbar {
  width: 4px;
}

.library-workflow-list::-webkit-scrollbar-thumb {
  background-color: var(--lib-border);
  border-radius: 2px;
}

/* --- Workflow List Item ----------------------------- */

.workflow-item {
  display: flex;
  flex-direction: column;
  padding: 8px 12px;
  cursor: pointer;
  border-left: 3px solid transparent;
  border-bottom: 1px solid var(--lib-border);
  transition: background-color 0.1s ease;
  position: relative;
}

.workflow-item:hover {
  background-color: var(--lib-hover-bg);
}

.workflow-item.active {
  border-left-color: var(--lib-active-border);
  background-color: var(--lib-active-bg);
}

.workflow-item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.workflow-item-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--lib-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.workflow-item-meta {
  font-size: 11px;
  color: var(--lib-meta-text);
}

.workflow-item-date {
  font-size: 10px;
  color: var(--lib-meta-text);
}

/* Action buttons — hidden until hover */
.workflow-item-actions {
  display: none;
  gap: 2px;
  margin-top: 4px;
}

.workflow-item:hover .workflow-item-actions {
  display: flex;
}

.btn-icon {
  background: none;
  border: 1px solid transparent;
  border-radius: 3px;
  cursor: pointer;
  padding: 2px 5px;
  font-size: 12px;
  color: var(--lib-btn-icon-color);
  line-height: 1;
}

.btn-icon:hover {
  background-color: var(--lib-border);
  border-color: var(--lib-border);
}

.btn-icon.danger:hover {
  background-color: #f8d7da;
  border-color: #f5c6cb;
  color: #721c24;
}

/* --- Empty State ------------------------------------ */

.library-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
  color: var(--lib-meta-text);
  font-size: 12px;
  gap: 8px;
}

.library-empty-state-icon {
  font-size: 32px;
  opacity: 0.4;
}

/* --- Sidebar Footer --------------------------------- */

.library-footer {
  padding: 8px 12px;
  border-top: 1px solid var(--lib-border);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.library-footer-text {
  font-size: 10px;
  color: var(--lib-meta-text);
}

.library-footer-autosave {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--lib-meta-text);
}

.library-footer-autosave select {
  font-size: 11px;
  padding: 1px 4px;
  border: 1px solid var(--lib-border);
  border-radius: 3px;
  background-color: var(--lib-bg);
  color: var(--lib-text);
}

/* --- Provider Badge --------------------------------- */

.provider-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  display: inline-block;
}

.provider-badge.session {
  background-color: #fff3cd;
  color: #856404;
  border: 1px solid #ffc107;
}

.provider-badge.memory {
  background-color: #ffe5d0;
  color: #7d4301;
  border: 1px solid #fd7e14;
}

/* --- Editor Toolbar --------------------------------- */

#editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-bottom: 1px solid var(--lib-border);
  background-color: var(--lib-bg);
  flex-shrink: 0;
  height: 36px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.workflow-name-display {
  font-size: 13px;
  font-weight: 600;
  color: var(--lib-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}

.autosave-status {
  font-size: 11px;
  transition: opacity 0.3s ease;
}

.autosave-status.status-dirty   { color: #856404; }
.autosave-status.status-saving  { color: var(--lib-meta-text); }
.autosave-status.status-saved   { color: #155724; }
.autosave-status.status-error   { color: #721c24; }

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

/* --- Unsaved Changes Banner ------------------------- */

#unsaved-banner {
  display: none;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  background-color: #fff3cd;
  border-bottom: 1px solid #ffc107;
  font-size: 12px;
  color: #856404;
  flex-shrink: 0;
}

#unsaved-banner.visible {
  display: flex;
}

#unsaved-banner .btn {
  font-size: 11px;
  padding: 2px 8px;
}

/* --- Toast Notifications ---------------------------- */

#toast-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 9999;
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  padding: 10px 16px;
  border-radius: 6px;
  font-size: 13px;
  max-width: 320px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  animation: toast-in 0.2s ease;
  display: flex;
  align-items: center;
  gap: 8px;
}

@keyframes toast-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.toast.success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
.toast.info    { background: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; }
.toast.warning { background: #fff3cd; color: #856404; border: 1px solid #ffc107; }
.toast.error   { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }

.toast-dismiss {
  margin-left: auto;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  color: inherit;
  opacity: 0.6;
  padding: 0;
  line-height: 1;
}

/* --- Storage Quota Bar ------------------------------ */

.quota-bar-container {
  height: 3px;
  background-color: var(--lib-border);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 2px;
}

.quota-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease, background-color 0.3s ease;
  background-color: #28a745;
}

.quota-bar-fill.warn    { background-color: #ffc107; }
.quota-bar-fill.danger  { background-color: #dc3545; }

/* --- Responsive: narrow viewport -------------------- */

@media (max-width: 768px) {
  #library-sidebar {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 1000;
    height: 100vh;
    transform: translateX(0);
    transition: transform 0.25s ease;
  }

  #library-sidebar.mobile-hidden {
    transform: translateX(-100%);
  }

  .split-host {
    flex-direction: column;
  }
}
```

---

## 22. Complete HTML Markup for Modals

Bootstrap 4 modal JS is **not** currently loaded in `index.html`. The `libraryUI.js` implementation uses plain JS to show/hide modals by toggling a `.modal-open` class and the `display` style, without depending on Bootstrap JS. All modal HTML goes inside `<body>` before the closing `</body>` tag.

### 22.1 Modal: Save As / New Workflow

```html
<!-- Save As Modal -->
<div id="modal-save-as" class="modal" tabindex="-1" role="dialog" aria-labelledby="modal-save-as-title" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered" role="document">
    <div class="modal-content theme">
      <div class="modal-header">
        <h5 class="modal-title" id="modal-save-as-title">Save Workflow As</h5>
        <button type="button" class="close modal-close-btn" data-modal="modal-save-as" aria-label="Close">
          <span aria-hidden="true">&times;</span>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label for="save-as-name">Name <span class="text-danger">*</span></label>
          <input
            type="text"
            class="form-control"
            id="save-as-name"
            placeholder="e.g. Customer Onboarding Flow"
            maxlength="100"
            autocomplete="off"
          />
          <small class="form-text text-muted">Max 100 characters.</small>
          <div class="invalid-feedback" id="save-as-name-error"></div>
        </div>
        <div class="form-group">
          <label for="save-as-description">Description <span class="text-muted">(optional)</span></label>
          <textarea
            class="form-control"
            id="save-as-description"
            rows="2"
            maxlength="300"
            placeholder="Short description of what this workflow does"
          ></textarea>
          <small class="form-text text-muted"><span id="save-as-desc-count">0</span>/300</small>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary modal-close-btn" data-modal="modal-save-as">Cancel</button>
        <button type="button" class="btn btn-primary" id="save-as-confirm-btn">Save</button>
      </div>
    </div>
  </div>
</div>
```

### 22.2 Modal: Delete Confirmation

```html
<!-- Delete Confirmation Modal -->
<div id="modal-confirm-delete" class="modal" tabindex="-1" role="dialog" aria-labelledby="modal-delete-title" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered modal-sm" role="document">
    <div class="modal-content theme">
      <div class="modal-header">
        <h5 class="modal-title" id="modal-delete-title">Delete Workflow</h5>
        <button type="button" class="close modal-close-btn" data-modal="modal-confirm-delete" aria-label="Close">
          <span aria-hidden="true">&times;</span>
        </button>
      </div>
      <div class="modal-body">
        <p>
          Are you sure you want to delete
          <strong id="modal-delete-workflow-name"></strong>?
        </p>
        <p class="text-danger mb-0"><small>This action cannot be undone.</small></p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary modal-close-btn" data-modal="modal-confirm-delete">Cancel</button>
        <button type="button" class="btn btn-danger" id="delete-confirm-btn">Delete</button>
      </div>
    </div>
  </div>
</div>
```

### 22.3 Modal: Rename Workflow

```html
<!-- Rename Modal -->
<div id="modal-rename" class="modal" tabindex="-1" role="dialog" aria-labelledby="modal-rename-title" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered" role="document">
    <div class="modal-content theme">
      <div class="modal-header">
        <h5 class="modal-title" id="modal-rename-title">Rename Workflow</h5>
        <button type="button" class="close modal-close-btn" data-modal="modal-rename" aria-label="Close">
          <span aria-hidden="true">&times;</span>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label for="rename-name">New Name <span class="text-danger">*</span></label>
          <input
            type="text"
            class="form-control"
            id="rename-name"
            maxlength="100"
            autocomplete="off"
          />
          <div class="invalid-feedback" id="rename-name-error"></div>
        </div>
        <div class="form-group mb-0">
          <label for="rename-description">Description <span class="text-muted">(optional)</span></label>
          <textarea
            class="form-control"
            id="rename-description"
            rows="2"
            maxlength="300"
          ></textarea>
        </div>
        <!-- Hidden: stores the id being renamed -->
        <input type="hidden" id="rename-target-id" />
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary modal-close-btn" data-modal="modal-rename">Cancel</button>
        <button type="button" class="btn btn-primary" id="rename-confirm-btn">Rename</button>
      </div>
    </div>
  </div>
</div>
```

### 22.4 Modal: Import Workflow

```html
<!-- Import Modal -->
<div id="modal-import" class="modal" tabindex="-1" role="dialog" aria-labelledby="modal-import-title" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered" role="document">
    <div class="modal-content theme">
      <div class="modal-header">
        <h5 class="modal-title" id="modal-import-title">Import Workflow</h5>
        <button type="button" class="close modal-close-btn" data-modal="modal-import" aria-label="Close">
          <span aria-hidden="true">&times;</span>
        </button>
      </div>
      <div class="modal-body">
        <!-- Drop zone -->
        <div id="import-drop-zone" class="import-drop-zone">
          <p class="mb-2">Drag &amp; drop a <code>.json</code> or <code>.yaml</code> file here</p>
          <label for="import-file-input" class="btn btn-outline-primary btn-sm">Browse files</label>
          <input type="file" id="import-file-input" accept=".json,.yaml,.yml" style="display:none;" />
        </div>
        <p class="text-center text-muted my-2" style="font-size:12px;">— or paste JSON / YAML below —</p>
        <!-- Paste area -->
        <textarea
          class="form-control"
          id="import-paste-area"
          rows="6"
          placeholder='{ "id": "my-workflow", "name": "...", ... }'
          style="font-family: monospace; font-size: 12px;"
        ></textarea>
        <!-- Error display -->
        <div id="import-error" class="alert alert-danger mt-2 mb-0" style="display:none; font-size:12px;"></div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary modal-close-btn" data-modal="modal-import">Cancel</button>
        <button type="button" class="btn btn-primary" id="import-confirm-btn">Import</button>
      </div>
    </div>
  </div>
</div>

<!-- Shared modal backdrop -->
<div id="modal-backdrop" class="modal-backdrop fade" style="display:none;"></div>

<!-- Toast container (outside all modals) -->
<div id="toast-container" aria-live="polite" aria-atomic="true"></div>
```

### 22.5 Inline HTML Additions to `index.html`

The following HTML is added **inside `<body>`**, before the existing split-panel `<div>`:

```html
<!-- Unsaved Changes Banner -->
<div id="unsaved-banner" role="alert">
  <span>&#9888; You have unsaved changes.</span>
  <button class="btn btn-sm btn-warning" id="unsaved-save-btn">Save Now</button>
  <button class="btn btn-sm btn-outline-secondary" id="unsaved-discard-btn">Discard &amp; Load</button>
  <button class="btn btn-sm btn-link" id="unsaved-cancel-btn">Cancel</button>
</div>

<!-- Quota Warning Banner (hidden until needed) -->
<div id="quota-banner" class="alert alert-warning mb-0" style="display:none; border-radius:0; font-size:12px;">
  &#9888; Storage is <span id="quota-percent"></span>% full.
  <a href="#" id="quota-manage-link">Manage workflows</a> to free space.
</div>

<!-- App Container wraps sidebar + split panels -->
<div class="app-container">
  <!-- Library Sidebar (full HTML shown in §9.2) -->
  <div id="library-sidebar" class="library-sidebar theme"> ... </div>

  <!-- Existing split panels stay inside split-host -->
  <div class="split-host">
    <div class="split theme" style="flex:1;">
      <!-- editor-col and diagram-col unchanged -->
    </div>
  </div>
</div>
```

### 22.6 CSS for Modal Display (No Bootstrap JS)

```css
/* Plain-JS modal support — no Bootstrap JS required */

.modal {
  display: none;
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  z-index: 1050;
  overflow-x: hidden;
  overflow-y: auto;
  outline: 0;
}

.modal.show {
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-backdrop {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background-color: rgba(0,0,0,0.5);
  z-index: 1040;
}

.modal-backdrop.show {
  display: block !important;
}

/* Import drop zone */
.import-drop-zone {
  border: 2px dashed var(--lib-border);
  border-radius: 6px;
  padding: 20px;
  text-align: center;
  font-size: 13px;
  color: var(--lib-meta-text);
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.import-drop-zone.drag-over {
  border-color: #448cfb;
  background-color: var(--lib-active-bg);
}
```

---

## 23. libraryUI.js — Internal Function Design

`libraryUI.js` exports a single global `LibraryUI` object. It reads from `WorkflowLibrary` and writes back via user interactions.

### 23.1 Module Structure

```javascript
'use strict';

const LibraryUI = (() => {

  // ---- Private state ----
  let _pendingDeleteId = null;  // id waiting for delete confirmation
  let _pendingLoadId   = null;  // id waiting for unsaved-changes resolution
  let _toastTimers     = [];    // for clearing auto-dismiss timers

  // ---- Init ----

  function init() {
    _applyStorageProviderBadge();
    _renderList();
    _bindSidebarEvents();
    _bindToolbarEvents();
    _bindModalEvents();
    _bindKeyboardShortcuts();
    _updateStorageInfo();
    _syncActiveWorkflowName();
  }

  // ---- List rendering ----

  function renderList(entries) { /* see §23.2 */ }
  function _renderItem(entry, isActive) { /* see §23.3 */ }

  // ---- Modal open/close ----

  function openModal(id) {
    document.getElementById(id).classList.add('show');
    const backdrop = document.getElementById('modal-backdrop');
    backdrop.style.display = 'block';
    setTimeout(() => backdrop.classList.add('show'), 10);
  }

  function closeModal(id) {
    document.getElementById(id).classList.remove('show');
    const backdrop = document.getElementById('modal-backdrop');
    backdrop.classList.remove('show');
    setTimeout(() => { backdrop.style.display = 'none'; }, 200);
  }

  // ---- Toast ----

  function showToast(message, type = 'info', duration = 3000) { /* see §23.4 */ }

  // ---- Auto-save status ----

  function showAutosaveStatus(state, detail) { /* see §23.5 */ }

  // ---- Storage info ----

  function updateStorageInfo() { /* see §23.6 */ }

  // ---- Expose ----
  return {
    init,
    renderList,
    showToast,
    showAutosaveStatus,
    updateStorageInfo,
  };

})();
```

### 23.2 `renderList(entries)`

```javascript
function renderList(entries) {
  const list = document.getElementById('lib-workflow-list');
  list.innerHTML = '';

  if (!entries || entries.length === 0) {
    list.innerHTML = `
      <li class="library-empty-state">
        <span class="library-empty-state-icon">&#128196;</span>
        <span>No workflows saved yet.</span>
        <span>Click <strong>New</strong> to create one.</span>
      </li>`;
    return;
  }

  const activeId = WorkflowLibrary.getActiveId();

  entries.forEach(entry => {
    const li = _renderItem(entry, entry.id === activeId);
    list.appendChild(li);
  });
}
```

### 23.3 `_renderItem(entry, isActive)`

```javascript
function _renderItem(entry, isActive) {
  const li = document.createElement('li');
  li.className = 'workflow-item' + (isActive ? ' active' : '');
  li.dataset.id = entry.id;
  li.title = entry.description || entry.name;

  li.innerHTML = `
    <div class="workflow-item-main">
      <span class="workflow-item-name">${_escapeHtml(entry.name)}</span>
      <span class="workflow-item-meta">${entry.stateCount} states · ${entry.specVersion || '—'}</span>
      <span class="workflow-item-date">${relativeTime(entry.modifiedAt)}</span>
    </div>
    <div class="workflow-item-actions">
      <button class="btn-icon lib-load-btn"      title="Load workflow"  data-id="${entry.id}">&#8659;</button>
      <button class="btn-icon lib-rename-btn"    title="Rename"         data-id="${entry.id}">&#9998;</button>
      <button class="btn-icon lib-duplicate-btn" title="Duplicate"      data-id="${entry.id}">&#10697;</button>
      <button class="btn-icon lib-export-btn"    title="Export JSON"    data-id="${entry.id}">&#8615;</button>
      <button class="btn-icon lib-delete-btn danger" title="Delete"     data-id="${entry.id}">&#128465;</button>
    </div>`;

  return li;
}
```

### 23.4 `showToast(message, type, duration)`

```javascript
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${_escapeHtml(message)}</span>
    <button class="toast-dismiss" aria-label="Dismiss">&times;</button>`;

  toast.querySelector('.toast-dismiss').addEventListener('click', () => _removeToast(toast));
  container.appendChild(toast);

  if (duration > 0) {
    const timer = setTimeout(() => _removeToast(toast), duration);
    _toastTimers.push(timer);
  }
}

function _removeToast(toast) {
  toast.style.opacity = '0';
  toast.style.transition = 'opacity 0.2s';
  setTimeout(() => toast.remove(), 250);
}
```

### 23.5 `showAutosaveStatus(state, detail)`

```javascript
function showAutosaveStatus(state, detail) {
  const el = document.getElementById('autosave-status');
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
      // Fade out after 3 s
      setTimeout(() => { el.style.opacity = '0'; }, 3000);
      break;
    case 'error':
      el.textContent = `Save failed${detail ? ': ' + detail : ''}`;
      el.classList.add('status-error');
      break;
    default:
      el.textContent = '';
  }
}
```

### 23.6 `updateStorageInfo()`

```javascript
function updateStorageInfo() {
  const usage = WorkflowLibrary.getStorageUsage();
  const count = WorkflowLibrary.listWorkflows().length;
  const kb = (usage.used / 1024).toFixed(1);

  // Footer text
  const info = document.getElementById('lib-storage-info');
  if (info) info.textContent = `${count} workflow${count !== 1 ? 's' : ''} \u00B7 ${kb} KB used`;

  // Quota bar
  if (usage.quota) {
    const pct = Math.round((usage.used / usage.quota) * 100);
    const fill = document.querySelector('.quota-bar-fill');
    if (fill) {
      fill.style.width = `${Math.min(pct, 100)}%`;
      fill.className = 'quota-bar-fill' +
        (pct >= 95 ? ' danger' : pct >= 80 ? ' warn' : '');
    }

    // Show quota banner at thresholds
    const banner = document.getElementById('quota-banner');
    if (banner) {
      if (pct >= 80) {
        banner.style.display = 'block';
        document.getElementById('quota-percent').textContent = pct;
      } else {
        banner.style.display = 'none';
      }
    }
  }
}
```

### 23.7 Event Binding: `_bindSidebarEvents()`

```javascript
function _bindSidebarEvents() {
  // Collapse/expand toggle
  document.getElementById('sidebar-collapse-btn').addEventListener('click', () => {
    const sidebar = document.getElementById('library-sidebar');
    const collapsed = sidebar.classList.toggle('collapsed');
    Settings.save({ sidebar: { collapsed } });
    // Refresh Monaco layout after transition
    setTimeout(() => editor && editor.layout(), 220);
  });

  // New workflow
  document.getElementById('lib-new-btn').addEventListener('click', () => {
    _guardUnsaved(null, () => _doNewWorkflow());
  });

  // Import
  document.getElementById('lib-import-btn').addEventListener('click', () => {
    _resetImportModal();
    openModal('modal-import');
  });

  // Delegated clicks on list items
  document.getElementById('lib-workflow-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-id]');
    if (!btn) return;
    const id = btn.dataset.id;

    if (btn.classList.contains('lib-load-btn')) {
      _guardUnsaved(id, () => _doLoad(id));
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

  // Sort selector
  document.getElementById('lib-sort-select').addEventListener('change', (e) => {
    Settings.save({ sidebar: { sortBy: e.target.value } });
    _refreshList();
  });

  // Search input
  document.getElementById('lib-search-input').addEventListener('input', (e) => {
    _refreshList(e.target.value);
  });

  document.getElementById('lib-search-clear').addEventListener('click', () => {
    document.getElementById('lib-search-input').value = '';
    _refreshList('');
  });
}
```

### 23.8 Event Binding: `_bindModalEvents()`

All `.modal-close-btn` elements with `data-modal` attribute close the named modal:

```javascript
function _bindModalEvents() {
  // Universal close buttons
  document.querySelectorAll('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.modal));
  });

  // Close on backdrop click
  document.getElementById('modal-backdrop').addEventListener('click', () => {
    document.querySelectorAll('.modal.show').forEach(m => closeModal(m.id));
  });

  // Save As confirm
  document.getElementById('save-as-confirm-btn').addEventListener('click', _onSaveAsConfirm);
  document.getElementById('save-as-description').addEventListener('input', e => {
    document.getElementById('save-as-desc-count').textContent = e.target.value.length;
  });

  // Delete confirm
  document.getElementById('delete-confirm-btn').addEventListener('click', () => {
    if (!_pendingDeleteId) return;
    const result = WorkflowLibrary.deleteWorkflow(_pendingDeleteId);
    if (result.ok) {
      showToast('Workflow deleted.', 'info', 2000);
      if (WorkflowLibrary.getActiveId() === _pendingDeleteId) {
        WorkflowLibrary.setActiveId(null);
        _syncActiveWorkflowName();
        monaco.editor.getModels()[0].setValue(
          JSON.stringify(customerApplication, null, 2)
        );
      }
      _refreshList();
      updateStorageInfo();
    } else {
      showToast(`Delete failed: ${result.error}`, 'error');
    }
    _pendingDeleteId = null;
    closeModal('modal-confirm-delete');
  });

  // Rename confirm
  document.getElementById('rename-confirm-btn').addEventListener('click', _onRenameConfirm);

  // Import confirm
  document.getElementById('import-confirm-btn').addEventListener('click', _onImportConfirm);

  // Import file picker
  document.getElementById('import-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      document.getElementById('import-paste-area').value = ev.target.result;
    };
    reader.readAsText(file);
  });

  // Import drop zone
  const dropZone = document.getElementById('import-drop-zone');
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      document.getElementById('import-paste-area').value = ev.target.result;
    };
    reader.readAsText(file);
  });
}
```

### 23.9 Keyboard Shortcuts: `_bindKeyboardShortcuts()`

```javascript
function _bindKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    // Ctrl/Cmd + S → Save active workflow
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 's') {
      e.preventDefault();
      const activeId = WorkflowLibrary.getActiveId();
      if (activeId) {
        _doSave(activeId);
      } else {
        openModal('modal-save-as');
        setTimeout(() => document.getElementById('save-as-name').focus(), 100);
      }
    }

    // Ctrl/Cmd + Shift + S → Save As
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 's') {
      e.preventDefault();
      openModal('modal-save-as');
      setTimeout(() => document.getElementById('save-as-name').focus(), 100);
    }

    // Escape → close topmost modal
    if (e.key === 'Escape') {
      const openModal = document.querySelector('.modal.show');
      if (openModal) closeModal(openModal.id);
    }
  });
}
```

---

## 24. workflowLibrary.js — Internal Structure & Init Sequence

### 24.1 File Layout

```javascript
/**
 * workflowLibrary.js
 * Workflow Library storage API and AutoSave.
 * Exposes globals: WorkflowLibrary, AutoSave, Settings
 */

'use strict';

// ── 1. Storage provider ─────────────────────────────────────────────
const LocalStorageProvider  = { ... };  // §19.3
const SessionStorageProvider = { ... }; // §19.4
const InMemoryProvider      = { ... };  // §19.5

let _provider = null;

function selectStorageProvider() { ... }  // §19.6
function getProvider() { ... }

// ── 2. Utilities ────────────────────────────────────────────────────
function generateUUID() { ... }           // §7.4
function crc32(str) { ... }              // §8.3
function isStorageAvailable() { ... }    // §14.2
function relativeTime(isoStr) { ... }    // Appendix A
function _escapeHtml(str) {              // XSS-safe HTML insertion
  return str.replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}
function deepMerge(target, source) { ... }

// ── 3. Index helpers ────────────────────────────────────────────────
function _readIndex() { ... }
function _writeIndex(entries) { ... }
function _updateIndexEntry(id, patch) { ... }
function _removeFromIndex(id) { ... }

// ── 4. Record helpers ───────────────────────────────────────────────
function _readRecord(id) { ... }
function _writeRecord(record) { ... }
function _buildRecord(id, content) { ... }
function _extractMeta(content) { ... }  // parses JSON, returns { name, specVersion, stateCount }

// ── 5. Settings ─────────────────────────────────────────────────────
const Settings = { ... };               // §20.3

// ── 6. WorkflowLibrary public API ──────────────────────────────────
const WorkflowLibrary = {
  init()                  { ... },      // §24.2
  listWorkflows()         { ... },
  getIndexEntry(id)       { ... },
  createWorkflow(...)     { ... },
  saveWorkflow(id, ...)   { ... },
  loadWorkflow(id)        { ... },
  renameWorkflow(...)     { ... },
  duplicateWorkflow(...)  { ... },
  deleteWorkflow(id)      { ... },
  searchWorkflows(query)  { ... },
  filterWorkflows(opts)   { ... },
  setActiveId(id)         { ... },
  getActiveId()           { ... },
  exportWorkflow(id)      { ... },
  importWorkflow(...)     { ... },
  exportLibrary()         { ... },
  importLibrary(json)     { ... },
  getStorageUsage()       { ... },
  repairLibrary()         { ... },
  clearLibrary()          { ... },
  migrateLegacyWorkflow() { ... },
};

// ── 7. AutoSave ─────────────────────────────────────────────────────
const AutoSave = { ... };               // §10.2

// ── 8. Expose globals ───────────────────────────────────────────────
window.WorkflowLibrary = WorkflowLibrary;
window.AutoSave        = AutoSave;
window.Settings        = Settings;
window.relativeTime    = relativeTime;
```

### 24.2 `WorkflowLibrary.init()` — Startup Sequence

```javascript
init() {
  // 1. Select storage provider
  _provider = selectStorageProvider();

  // 2. Check schema version and run migrations
  migrateIfNeeded();

  // 3. Migrate legacy lastSWFJson if first run
  const { migrated } = this.migrateLegacyWorkflow();

  // 4. Repair any inconsistencies
  this.repairLibrary();

  // 5. Restore last active workflow into editor
  const activeId = this.getActiveId();
  if (activeId) {
    const result = this.loadWorkflow(activeId);
    if (result.ok) {
      monaco.editor.getModels()[0].setValue(result.content);
    } else {
      // Corrupted or missing — clear active
      this.setActiveId(null);
      console.warn('[WorkflowLibrary] Could not restore active workflow:', result.error);
    }
  }

  return { provider: _provider.name, migrated };
},
```

### 24.3 `_buildRecord(id, content)` — Internal Record Factory

```javascript
function _buildRecord(id, content) {
  const now = new Date().toISOString();
  const checksum = crc32(content);
  const meta = _extractMeta(content);

  const record = {
    id,
    schemaVersion: '1',
    checksum,
    content,
    contentEncoding: 'none',
    createdAt: now,
    modifiedAt: now,
  };

  const indexEntry = {
    id,
    name: meta.name,
    description: '',
    createdAt: now,
    modifiedAt: now,
    specVersion: meta.specVersion || '0.7',
    stateCount: meta.stateCount || 0,
    tags: [],
    sizeBytes: content.length * 2,
  };

  return { record, indexEntry };
}
```

### 24.4 `_extractMeta(content)` — Metadata Extraction

```javascript
function _extractMeta(content) {
  try {
    const json = JSON.parse(content);
    return {
      name: json.name || json.id || 'Unnamed Workflow',
      specVersion: json.specVersion,
      stateCount: Array.isArray(json.states) ? json.states.length : 0,
    };
  } catch (_) {
    return { name: 'Unnamed Workflow', specVersion: undefined, stateCount: 0 };
  }
}
```

### 24.5 `migrateIfNeeded()` — Schema Version Migration

```javascript
function migrateIfNeeded() {
  const stored = parseInt(getProvider().getItem('swf_schema_version') || '0', 10);
  const current = 1;

  if (stored === current) return;

  if (stored < 1) {
    // v0 → v1: no index existed; migrateLegacyWorkflow() handles the content migration
    // No structural changes needed for the index format itself
  }

  getProvider().setItem('swf_schema_version', String(current));
}
```

---

## 25. Unit Test Code Examples

Test file: `src/js/workflowLibrary.test.js`. Uses a Jest/Jasmine-compatible test harness. A mock localStorage is injected before each test.

### 25.1 Test Harness Setup

```javascript
// Mock localStorage
function createMockStorage() {
  const store = {};
  return {
    getItem:    (k) => store[k] ?? null,
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear:      () => { for (const k in store) delete store[k]; },
    keys:       () => Object.keys(store),
    // Simulate quota exceeded
    simulateQuota: () => {
      store.__quota = true;
    },
  };
}

let mockStorage;

beforeEach(() => {
  mockStorage = createMockStorage();
  // Inject into WorkflowLibrary internals
  // (In actual implementation, the provider is injectable for testing)
  WorkflowLibrary._setProvider(mockStorage);
  WorkflowLibrary.clearLibrary();
});
```

### 25.2 `createWorkflow` Tests

```javascript
describe('createWorkflow', () => {
  const validJson = JSON.stringify({
    id: 'test-wf', name: 'Test Workflow',
    specVersion: '0.7', states: [{ name: 'S1', type: 'operation', actions: [], end: true }],
  });

  it('creates a record and index entry', () => {
    const result = WorkflowLibrary.createWorkflow('My Flow', validJson);
    expect(result.ok).toBe(true);
    expect(typeof result.id).toBe('string');
    expect(result.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );

    const list = WorkflowLibrary.listWorkflows();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('My Flow');
  });

  it('returns error when name is empty', () => {
    const result = WorkflowLibrary.createWorkflow('', validJson);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('NAME_TOO_LONG');  // empty also fails validation
  });

  it('returns error when name exceeds 100 chars', () => {
    const result = WorkflowLibrary.createWorkflow('x'.repeat(101), validJson);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('NAME_TOO_LONG');
  });

  it('stores a checksum in the record', () => {
    const result = WorkflowLibrary.createWorkflow('My Flow', validJson);
    const raw = mockStorage.getItem(`swf_wf_${result.id}`);
    const record = JSON.parse(raw);
    expect(typeof record.checksum).toBe('string');
    expect(record.checksum.length).toBe(8);  // CRC32 hex
  });
});
```

### 25.3 `loadWorkflow` Tests

```javascript
describe('loadWorkflow', () => {
  it('returns content for a valid workflow', () => {
    const json = JSON.stringify({ id: 'w', name: 'W', specVersion: '0.7', states: [] });
    const { id } = WorkflowLibrary.createWorkflow('W', json);

    const result = WorkflowLibrary.loadWorkflow(id);
    expect(result.ok).toBe(true);
    expect(result.content).toBe(json);
  });

  it('returns RECORD_NOT_FOUND for unknown id', () => {
    const result = WorkflowLibrary.loadWorkflow('nonexistent-uuid');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('RECORD_NOT_FOUND');
  });

  it('returns CHECKSUM_MISMATCH when record is corrupted', () => {
    const json = JSON.stringify({ id: 'w', name: 'W', specVersion: '0.7', states: [] });
    const { id } = WorkflowLibrary.createWorkflow('W', json);

    // Corrupt the stored record
    const key = `swf_wf_${id}`;
    const record = JSON.parse(mockStorage.getItem(key));
    record.content = '{ "id": "tampered" }';
    mockStorage.setItem(key, JSON.stringify(record));

    const result = WorkflowLibrary.loadWorkflow(id);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('CHECKSUM_MISMATCH');
  });

  it('returns INVALID_JSON when stored record is malformed', () => {
    const json = JSON.stringify({ id: 'w', name: 'W', specVersion: '0.7', states: [] });
    const { id } = WorkflowLibrary.createWorkflow('W', json);

    // Corrupt the record envelope itself
    mockStorage.setItem(`swf_wf_${id}`, 'not-valid-json!!');

    const result = WorkflowLibrary.loadWorkflow(id);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('INVALID_JSON');
  });
});
```

### 25.4 `deleteWorkflow` Tests

```javascript
describe('deleteWorkflow', () => {
  it('removes record key and index entry', () => {
    const json = JSON.stringify({ id: 'w', name: 'W', specVersion: '0.7', states: [] });
    const { id } = WorkflowLibrary.createWorkflow('W', json);

    WorkflowLibrary.deleteWorkflow(id);

    expect(WorkflowLibrary.listWorkflows().length).toBe(0);
    expect(mockStorage.getItem(`swf_wf_${id}`)).toBeNull();
  });

  it('returns error for unknown id', () => {
    const result = WorkflowLibrary.deleteWorkflow('no-such-id');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('RECORD_NOT_FOUND');
  });
});
```

### 25.5 `searchWorkflows` Tests

```javascript
describe('searchWorkflows', () => {
  beforeEach(() => {
    const mk = (name, desc) => WorkflowLibrary.createWorkflow(
      name, JSON.stringify({ id:'x', name, specVersion:'0.7', states:[] }), desc
    );
    mk('Order Processing', 'Handles purchase orders');
    mk('Visa Approval',    'International visa workflow');
    mk('Job Monitor',      'Monitors background jobs');
  });

  it('returns all workflows on empty query', () => {
    expect(WorkflowLibrary.searchWorkflows('').length).toBe(3);
  });

  it('matches on name (case-insensitive)', () => {
    const results = WorkflowLibrary.searchWorkflows('visa');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Visa Approval');
  });

  it('matches on description', () => {
    const results = WorkflowLibrary.searchWorkflows('background');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Job Monitor');
  });

  it('returns empty array when no match', () => {
    expect(WorkflowLibrary.searchWorkflows('xyzzy').length).toBe(0);
  });
});
```

### 25.6 `migrateLegacyWorkflow` Tests

```javascript
describe('migrateLegacyWorkflow', () => {
  it('imports lastSWFJson into the library on first run', () => {
    const legacy = JSON.stringify({
      id: 'legacy', name: 'Legacy Workflow', specVersion: '0.7', states: []
    });
    mockStorage.setItem('lastSWFJson', legacy);

    const { migrated } = WorkflowLibrary.migrateLegacyWorkflow();
    expect(migrated).toBe(true);

    const list = WorkflowLibrary.listWorkflows();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('Legacy Workflow');
  });

  it('skips migration when library index already exists', () => {
    const json = JSON.stringify({ id:'w', name:'W', specVersion:'0.7', states:[] });
    WorkflowLibrary.createWorkflow('W', json);

    // Put something in lastSWFJson too
    mockStorage.setItem('lastSWFJson', JSON.stringify({ id:'old', name:'Old', specVersion:'0.7', states:[] }));

    const { migrated } = WorkflowLibrary.migrateLegacyWorkflow();
    expect(migrated).toBe(false);
    // Should still have only 1 workflow
    expect(WorkflowLibrary.listWorkflows().length).toBe(1);
  });
});
```

### 25.7 `crc32` Tests

```javascript
describe('crc32', () => {
  it('returns a fixed 8-character hex string', () => {
    const result = crc32('hello world');
    expect(result).toBe('0d4a1185');  // known CRC32 of "hello world"
  });

  it('returns different values for different inputs', () => {
    expect(crc32('abc')).not.toBe(crc32('abd'));
  });

  it('is deterministic', () => {
    const s = 'test-string-123';
    expect(crc32(s)).toBe(crc32(s));
  });

  it('handles empty string', () => {
    expect(crc32('')).toBe('00000000');
  });
});
```

### 25.8 Quota Exceeded Tests

```javascript
describe('quota handling', () => {
  it('returns QUOTA_EXCEEDED when storage is full', () => {
    // Replace setItem with a throwing mock
    const originalSetItem = mockStorage.setItem;
    mockStorage.setItem = () => {
      const e = new DOMException('QuotaExceededError');
      Object.defineProperty(e, 'name', { value: 'QuotaExceededError' });
      throw e;
    };

    const json = JSON.stringify({ id:'w', name:'W', specVersion:'0.7', states:[] });
    const result = WorkflowLibrary.createWorkflow('W', json);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('QUOTA_EXCEEDED');

    mockStorage.setItem = originalSetItem;
  });
});
```

---

## 26. Integration Test Code Examples

Integration tests verify the full browser-level workflow lifecycle. Recommended runner: **Playwright** with a local dev server serving `src/`.

### 26.1 Test Setup

```javascript
// integration.setup.js
const { chromium } = require('playwright');

let browser, page;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
});

beforeEach(async () => {
  page = await browser.newPage();
  // Clear all localStorage before each test
  await page.addInitScript(() => localStorage.clear());
  await page.goto('http://localhost:5500/src/index.html');
  // Wait for Monaco and library to initialize
  await page.waitForFunction(() => typeof WorkflowLibrary !== 'undefined');
  await page.waitForFunction(() => typeof monaco !== 'undefined');
});

afterEach(async () => {
  await page.close();
});
```

### 26.2 Full Create / Load / Edit / Save Lifecycle

```javascript
test('full workflow lifecycle: create → load → edit → save → reload', async () => {
  // Create workflow via Save As
  await page.click('#tb-save-btn');
  await page.fill('#save-as-name', 'My Integration Test Flow');
  await page.click('#save-as-confirm-btn');

  // Verify it appears in the list
  const items = await page.$$('.workflow-item');
  expect(items.length).toBe(1);
  const name = await items[0].$eval('.workflow-item-name', el => el.textContent);
  expect(name).toBe('My Integration Test Flow');

  // Edit the editor content
  const newJson = JSON.stringify({
    id: 'edited', name: 'Edited Flow', specVersion: '0.7', states: []
  }, null, 2);

  await page.evaluate((json) => {
    monaco.editor.getModels()[0].setValue(json);
  }, newJson);

  // Save via Ctrl+S
  await page.keyboard.press('Control+s');
  await page.waitForSelector('.status-saved');

  // Reload the page and verify the workflow is restored
  await page.reload();
  await page.waitForFunction(() => typeof WorkflowLibrary !== 'undefined');

  const editorValue = await page.evaluate(() =>
    monaco.editor.getModels()[0].getValue()
  );
  expect(JSON.parse(editorValue).name).toBe('Edited Flow');
});
```

### 26.3 Multiple Workflows + Search

```javascript
test('multiple workflows and search', async () => {
  // Create three workflows with distinct names
  const names = ['Alpha Flow', 'Beta Process', 'Gamma Pipeline'];
  for (const name of names) {
    await page.evaluate(async (n) => {
      const json = JSON.stringify({ id: n, name: n, specVersion: '0.7', states: [] });
      WorkflowLibrary.createWorkflow(n, json);
    }, name);
  }

  // Refresh the UI list
  await page.evaluate(() => LibraryUI.renderList(WorkflowLibrary.listWorkflows()));

  // All three appear
  let items = await page.$$('.workflow-item');
  expect(items.length).toBe(3);

  // Search for "gamma"
  await page.fill('#lib-search-input', 'gamma');
  items = await page.$$('.workflow-item');
  expect(items.length).toBe(1);

  const visibleName = await items[0].$eval('.workflow-item-name', el => el.textContent.trim());
  expect(visibleName).toBe('Gamma Pipeline');

  // Clear search
  await page.click('#lib-search-clear');
  items = await page.$$('.workflow-item');
  expect(items.length).toBe(3);
});
```

### 26.4 Export → Delete → Import Roundtrip

```javascript
test('export → delete → import restores workflow', async () => {
  // Seed a workflow
  const json = JSON.stringify({
    id: 'roundtrip', name: 'Roundtrip Workflow',
    specVersion: '0.7', states: [{ name: 'S1', type: 'operation', actions: [], end: true }]
  }, null, 2);

  const { id } = await page.evaluate((j) => WorkflowLibrary.createWorkflow('Roundtrip Workflow', j), json);

  // Export to get the bundle JSON
  const exportResult = await page.evaluate((i) => WorkflowLibrary.exportWorkflow(i), id);
  expect(exportResult.ok).toBe(true);

  const bundleJson = exportResult.json;

  // Delete the workflow
  await page.evaluate((i) => WorkflowLibrary.deleteWorkflow(i), id);
  expect(await page.evaluate(() => WorkflowLibrary.listWorkflows().length)).toBe(0);

  // Import the bundle
  const importResult = await page.evaluate((b) => WorkflowLibrary.importWorkflow(b), bundleJson);
  expect(importResult.ok).toBe(true);

  // Verify restored
  const list = await page.evaluate(() => WorkflowLibrary.listWorkflows());
  expect(list.length).toBe(1);
  expect(list[0].name).toBe('Roundtrip Workflow');
});
```

### 26.5 Auto-Save Integration

```javascript
test('auto-save fires after interval with content changes', async () => {
  // Seed and load a workflow
  const json = JSON.stringify({ id: 'autosave-test', name: 'AS Test', specVersion: '0.7', states: [] });
  const { id } = await page.evaluate((j) => WorkflowLibrary.createWorkflow('AS Test', j), json);
  await page.evaluate((i) => WorkflowLibrary.setActiveId(i), id);

  // Set a very short auto-save interval for testing (2 seconds)
  await page.evaluate(() => AutoSave.setInterval(2000));
  await page.evaluate(() => AutoSave.start());

  // Edit the editor
  const edited = JSON.stringify({ id: 'autosave-test', name: 'Updated Name', specVersion: '0.7', states: [] });
  await page.evaluate((j) => monaco.editor.getModels()[0].setValue(j), edited);

  // Wait for auto-save to fire
  await page.waitForTimeout(2500);

  // Verify content was saved
  const loadResult = await page.evaluate((i) => WorkflowLibrary.loadWorkflow(i), id);
  expect(loadResult.ok).toBe(true);
  expect(JSON.parse(loadResult.content).name).toBe('Updated Name');
});
```

### 26.6 Legacy Migration on First Load

```javascript
test('migrates lastSWFJson to library on first page load', async () => {
  // Pre-seed lastSWFJson before page load
  const legacyJson = JSON.stringify({
    id: 'legacy-workflow', name: 'My Legacy Workflow',
    specVersion: '0.7', states: []
  });

  await page.addInitScript((j) => {
    localStorage.setItem('lastSWFJson', j);
  }, legacyJson);

  await page.reload();
  await page.waitForFunction(() => typeof WorkflowLibrary !== 'undefined');

  const list = await page.evaluate(() => WorkflowLibrary.listWorkflows());
  expect(list.length).toBe(1);
  expect(list[0].name).toBe('My Legacy Workflow');

  // Verify it appears in the sidebar
  const items = await page.$$('.workflow-item');
  expect(items.length).toBe(1);
});
```

### 26.7 Unsaved Changes Guard

```javascript
test('unsaved changes guard prevents accidental content loss', async () => {
  // Create and load two workflows
  const jsonA = JSON.stringify({ id: 'a', name: 'Flow A', specVersion: '0.7', states: [] });
  const jsonB = JSON.stringify({ id: 'b', name: 'Flow B', specVersion: '0.7', states: [] });

  const { id: idA } = await page.evaluate((j) => WorkflowLibrary.createWorkflow('Flow A', j), jsonA);
  const { id: idB } = await page.evaluate((j) => WorkflowLibrary.createWorkflow('Flow B', j), jsonB);

  // Load Flow A
  await page.evaluate((i) => WorkflowLibrary.setActiveId(i), idA);
  await page.evaluate((j) => monaco.editor.getModels()[0].setValue(j), jsonA);

  // Make unsaved changes
  const dirty = JSON.stringify({ id: 'a', name: 'Flow A EDITED', specVersion: '0.7', states: [] });
  await page.evaluate((j) => monaco.editor.getModels()[0].setValue(j), dirty);

  // Click Load on Flow B — banner should appear
  await page.evaluate((i) => LibraryUI._guardUnsaved(i, () => {}), idB);
  const banner = await page.$('#unsaved-banner.visible');
  expect(banner).not.toBeNull();

  // Click "Discard & Load" — Flow B should load
  await page.click('#unsaved-discard-btn');
  await page.waitForFunction((id) => WorkflowLibrary.getActiveId() === id, idB);

  const editorValue = await page.evaluate(() => monaco.editor.getModels()[0].getValue());
  expect(JSON.parse(editorValue).name).toBe('Flow B');
});
```

---

## 27. User-Facing Error Messages Reference

All error messages rendered in the UI are defined here in one place for easy localization and consistency.

### 27.1 Error Code → Message Mapping

```javascript
const ERROR_MESSAGES = {
  QUOTA_EXCEEDED:
    'Storage is full. Please delete unused workflows or export them to free space.',

  CHECKSUM_MISMATCH:
    'The workflow "{name}" may be corrupted (checksum failed). ' +
    'The raw content has been loaded — please verify and re-save.',

  INVALID_JSON:
    'The stored record for "{name}" contains invalid data and cannot be loaded.',

  INVALID_SWF:
    'The workflow content does not conform to the Serverless Workflow specification. ' +
    'The editor will still display the content.',

  RECORD_NOT_FOUND:
    'Workflow not found. It may have been deleted from another browser tab.',

  INDEX_NOT_FOUND:
    'The workflow library index is missing or unreadable. ' +
    'Attempting to repair from stored records.',

  DUPLICATE_NAME:
    'A workflow named "{name}" already exists. Please choose a different name.',

  NAME_TOO_LONG:
    'Workflow name must be between 1 and 100 characters.',

  DESCRIPTION_TOO_LONG:
    'Description must be 300 characters or fewer.',

  IMPORT_FORMAT_UNKNOWN:
    'The file could not be recognized as a valid Serverless Workflow definition or library bundle.',

  STORAGE_UNAVAILABLE:
    'Browser storage is unavailable (private browsing or blocked). ' +
    'Your work will not be saved after closing the tab.',
};

/**
 * Interpolate {placeholders} in an error message.
 * @param {string} code  - Error code from ERROR_MESSAGES
 * @param {Object} vars  - e.g. { name: "My Workflow" }
 * @returns {string}
 */
function getErrorMessage(code, vars = {}) {
  let msg = ERROR_MESSAGES[code] || `An unexpected error occurred (${code}).`;
  Object.entries(vars).forEach(([k, v]) => {
    msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  });
  return msg;
}
```

### 27.2 Toast Duration by Severity

| Error Code | Toast Type | Duration |
|---|---|---|
| `QUOTA_EXCEEDED` | error | persistent |
| `CHECKSUM_MISMATCH` | warning | persistent |
| `INVALID_JSON` | error | persistent |
| `INVALID_SWF` | warning | 8000 ms |
| `RECORD_NOT_FOUND` | error | 5000 ms |
| `INDEX_NOT_FOUND` | warning | 5000 ms |
| `DUPLICATE_NAME` | warning | 4000 ms |
| `NAME_TOO_LONG` | warning | 3000 ms |
| `DESCRIPTION_TOO_LONG` | warning | 3000 ms |
| `IMPORT_FORMAT_UNKNOWN` | error | 5000 ms |
| `STORAGE_UNAVAILABLE` | error | persistent |

### 27.3 Success Messages

| Action | Toast Message | Duration |
|---|---|---|
| Create workflow | "Workflow '{name}' saved." | 2000 ms |
| Save workflow | "Saved." | 2000 ms |
| Rename workflow | "Workflow renamed to '{name}'." | 2000 ms |
| Duplicate workflow | "Workflow duplicated as '{name}'." | 2000 ms |
| Delete workflow | "Workflow deleted." | 2000 ms |
| Export workflow | "'{name}.swf.json' downloaded." | 2000 ms |
| Import workflow | "'{name}' imported successfully." | 3000 ms |
| Import library bundle | "{n} workflow(s) imported, {s} skipped." | 4000 ms |
| Legacy migration | "Your previous workflow was saved as '{name}'." | 5000 ms |

---

## Appendix D — Keyboard Shortcut Reference

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + Enter` | Generate workflow diagram (existing) |
| `Ctrl/Cmd + S` | Save active workflow (new) |
| `Ctrl/Cmd + Shift + S` | Save As (new) |
| `Escape` | Close open modal (new) |

---

## Appendix E — `index.html` Script Load Order (Final)

The final load order for all scripts, accounting for the new files:

```html
<!-- 1. Workflow SDK (must be first — other scripts depend on serverWorkflowSdk) -->
<script src="./js/serverlessWorkflowSdk.umd.js"></script>

<!-- 2. Monaco loader -->
<script>var require = { paths: { vs: 'min/vs' } };</script>
<script src="js/loader.js"></script>
<script src="js/editor.main.nls.js"></script>
<script src="js/editor.main.js"></script>

<!-- 3. Application scripts -->
<script src="js/examples.js"></script>       <!-- example workflows & examplesMap -->
<script src="js/sweditor.js"></script>       <!-- core editor globals & functions -->
<script src="js/workflowLibrary.js"></script><!-- WorkflowLibrary, AutoSave, Settings -->
<script src="js/libraryUI.js"></script>      <!-- LibraryUI -->

<!-- 4. Monaco model initialization (inline — must run after all globals are defined) -->
<script>
  var modelUri = monaco.Uri.parse("https://raw.githubusercontent.com/.../workflow.json");
  const lastSWFJson = localStorage.getItem(LOCAL_STORAGE_SWF_JSON);
  var model = lastSWFJson
    ? monaco.editor.createModel(lastSWFJson, "json", modelUri)
    : monaco.editor.createModel(JSON.stringify(customerApplication, null, 2), "json", modelUri);

  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({ /* unchanged */ });

  mountEditor();
</script>

<!-- 5. jQuery (used only by wrscript.js — keep at bottom) -->
<script src="https://code.jquery.com/jquery-3.3.1.js"></script>
<script src="js/wrscript.js"></script>
<script src="js/jquery-form-serializer.js"></script>
```

**Note:** `LibraryUI.init()` is called inside the `DOMContentLoaded` handler in `libraryUI.js`, after `WorkflowLibrary.init()` returns. This guarantees the Monaco editor instance exists before the sidebar attempts to render the active workflow name.

---

## Appendix F — Data Flow Diagram (Complete System)

```
┌────────────────────────────────────────────────────────────────────────┐
│  Browser                                                                │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  DOMContentLoaded                                                 │  │
│  │    1. WorkflowLibrary.init()                                      │  │
│  │         ├─ selectStorageProvider() → _provider                   │  │
│  │         ├─ migrateIfNeeded()                                      │  │
│  │         ├─ migrateLegacyWorkflow()  ← reads "lastSWFJson"        │  │
│  │         ├─ repairLibrary()                                        │  │
│  │         └─ loadWorkflow(activeId) → monaco.model.setValue()      │  │
│  │    2. LibraryUI.init()                                            │  │
│  │         ├─ renderList()                                           │  │
│  │         ├─ bind all event handlers                               │  │
│  │         └─ updateStorageInfo()                                    │  │
│  │    3. AutoSave.start()                                            │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────┐   edit    ┌──────────────────────────────────┐    │
│  │  Library        │ ────────▶ │  Monaco Editor (model)           │    │
│  │  Sidebar        │           │                                  │    │
│  │                 │   load    │  onDidChangeContent:             │    │
│  │  [workflow 1] ──┼──────────▶│    saveToLocalStorage()          │    │
│  │  [workflow 2]   │           │    AutoSave.markDirty()          │    │
│  │                 │           └──────────────┬───────────────────┘    │
│  │  [Save]   ──────┼────────────────┐         │ Ctrl+Enter / button    │
│  │  [New]    ──────┼──────┐         │         ▼                        │
│  │  [Import] ──────┼──┐   │         │  generateDiagram()               │
│  └─────────────────┘  │   │         │    SDK.fromSource()               │
│                        │   │         │    MermaidDiagram.sourceCode()   │
│                        │   │         │    mermaid.render()              │
│                        ▼   ▼         ▼         │                        │
│  ┌─────────────────────────────────────────┐   │                        │
│  │  WorkflowLibrary API                    │   │ SVG                    │
│  │                                         │   ▼                        │
│  │  createWorkflow / saveWorkflow          │  ┌──────────────────────┐  │
│  │  loadWorkflow / deleteWorkflow          │  │  .workflowdiagram    │  │
│  │  importWorkflow / exportWorkflow        │  │  (Mermaid SVG)       │  │
│  │  searchWorkflows / repairLibrary        │  └──────────────────────┘  │
│  └───────────────────────┬─────────────────┘                            │
│                           │ get/set                                      │
│  ┌────────────────────────▼────────────────────────────────────────┐    │
│  │  localStorage (via _provider)                                    │    │
│  │                                                                  │    │
│  │  swf_library_index  →  WorkflowIndexEntry[]                     │    │
│  │  swf_wf_{uuid}      →  WorkflowRecord  (× N)                   │    │
│  │  swf_active_id      →  string | null                            │    │
│  │  swf_settings       →  Settings object                          │    │
│  │  swf_schema_version →  "1"                                      │    │
│  │  lastSWFJson        →  string  (mirrored for backward compat)   │    │
│  │  split-sizes        →  [number, number]                         │    │
│  │  theme              →  "dark" | "light"                         │    │
│  └──────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```
