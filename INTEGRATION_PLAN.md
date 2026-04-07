# Integration Plan: ted-open-data-explorer → ted-open-data

> **Status**: Plan, awaiting execution.
> **Branch**: `feature/integrate-explorer` (off `develop`)
> **Strategy**: One big PR after the plan is fully executed and verified.

This document is the authoritative blueprint for absorbing the standalone
**ted-open-data-explorer** application into **ted-open-data**, producing a
single unified app that replaces both. It is written to be self-contained
so any future Claude Code session (or human contributor) can pick it up
without prior context.

---

## 1. Why this exists

Today there are two separate web apps backed by the same TED Open Data
SPARQL endpoint:

- **ted-open-data** (`/home/rousoio/Code/TEDSWS/ted-open-data`,
  deployed at `data.ted.europa.eu`) — a SPARQL playground for *set-level*
  thinking. Users write SPARQL queries against the whole dataset and get
  tabular results. Has a curated query library, a CodeMirror 6 editor
  with ePO autocomplete, and a results display.
- **ted-open-data-explorer** (`/home/rousoio/Code/TEDSWS/ted-open-data-explorer`,
  PR #24 currently open against its own `develop`) — a notice browser for
  *instance-level* thinking. Users type a publication number (or pick a
  random notice) and see the full RDF graph for that one notice rendered
  as a navigable tree, Turtle source, or backlinks view. Has a procedure
  timeline, breadcrumb navigation, and shareable URLs.

The two apps serve **complementary mental modes**: ted-open-data answers
"show me things matching a pattern" (sets), explorer answers "show me
this one specific thing" (instances). Today these flows are disconnected
— if you find a notice in a SPARQL result on ted-open-data, you can't
click to read it; you have to copy the pub number into a separate browser
tab running explorer. The merger closes that gap and makes the two flows
parts of one product.

The **goal** is full absorption: explorer's code physically moves into
ted-open-data and becomes part of it. After this work ships, the
standalone explorer repository will be archived (decommission plan to be
written post-merge). There is no intent to keep both apps alive.

## 2. What we know about the two codebases

Both apps are remarkably similar in architecture, which is why full
absorption is realistic:

| Axis | ted-open-data | explorer |
|---|---|---|
| Framework | Vanilla JS, no framework | Vanilla JS, no framework |
| CSS | Bootstrap 5.3.8 | Bootstrap 5.3.8 (exact version match) |
| Code editor | CodeMirror 6 (ePO autocomplete + sparql linting) | CodeMirror 6 (sparql + turtle, no autocomplete) |
| Build | esbuild for CM6 bundle only | esbuild for CM6 bundle only |
| Routing | Bootstrap tabs, no router | Bootstrap tabs, no router |
| Endpoint | `https://publications.europa.eu/webapi/rdf/sparql` | same (via dev CORS proxy in both repos) |
| Tests | None | 123 tests (`node:test`) |
| RDF stack | None — fetch + parse JSON SPARQL results only | N3 (Turtle parser, ~40KB), used for tree/turtle/backlinks rendering |
| sparqljs | `^3.7.4` (already imported in `QueryEditor.js` for minify + syntax check) | `^3.7.4` |
| Deploy | GitHub Pages (`data.ted.europa.eu`) | GitHub Pages |
| URL state | None — "Copy URL" button builds a direct SPARQL endpoint URL | `?facet=<json>` for shareable views |

### "Apparent" naming overlaps that aren't real collisions

Two element names appear in both codebases but are **not real
collisions** in the merged-app context — the two apps never coexist in
the same DOM, so there's only ever one progress bar and one query
timer in the merged app: ted-open-data's. Explorer's equivalents are
**dead code** in the merged-app context, removed naturally during
Stage 7 (unify SPARQL execution path) and Stage 13 (cleanup).

Specifically:
- `.progress-bar` (CSS class) — ted-open-data uses it in the query-timing footer
  (`index.html:389`, `QueryEditor.js:221`). Explorer has its own equivalent that
  is replaced by the ted-open-data one during Stage 7.
- `#query-timer` (element ID) — same story (`index.html:390`, `QueryEditor.js:223`).

No new collisions exist. Explorer's `#data-card`, `#search-input`,
`#share-btn`, `#data-share-btn`, `#app-tab-explorer`, `#data-not-found`
do **not** appear in ted-open-data and slot in cleanly.

### Already in both repos (no migration needed)

- Bootstrap 5.3.8 (loaded from CDN in both)
- CodeMirror 6 (self-bundled via esbuild in both)
- sparqljs 3.7.4
- esbuild devDependency
- Express CORS proxy for local dev

### Net new dependencies brought in by explorer

- **N3** (~40KB) — Turtle parser, essential for tree/turtle/backlinks rendering
- **Zod** — runtime validation of `?facet=` URL params (small)
- Possibly: any other small explorer-specific helpers

## 3. Locked product decisions (from Phase 2)

These decisions were settled during planning conversations and should not
be re-litigated during execution. If a future session is tempted to
revisit any of these, the answer is "they were considered, this is the
chosen path, ship it first, iterate later".

### 3.1 Tab structure

Final nav order in the merged app:

```
Home → Search → Query Library → Query Editor → Query Results → Explore → Help
```

> **Note**: tab labels above are **working titles**. Final wording is
> reviewed in Stage 14a at the very end of execution. The element IDs
> (`app-tab-search`, `app-tab-explorer`, etc.) stay stable regardless of
> how the labels are revised — nothing in the architecture or stages
> below depends on the wording.

Six tabs (Help is right-aligned via `ms-auto`). Both result tabs
(**Query Results** and **Explore**) are **hidden on cold load** — they
only appear after a query has produced data. This mirrors the cold-load
behaviour we shipped for the Explore tab in
ted-open-data-explorer PR #24.

The structure has parallel input/output lanes:

| Lane | Input tab | Output tab |
|---|---|---|
| **Instance lane** ("show me this one thing") | Search | Explore |
| **Set lane** ("show me things matching a pattern") | Query Editor | Query Results |
| **Curated entry** (feeds either lane) | Query Library | — |

Each tab has exactly one job. Search is for typing pub numbers, Editor
is for typing SPARQL — symmetrical inputs. Results renders tables,
Explore renders RDF graphs — symmetrical outputs.

### 3.2 SPARQL editor: there is only one

Drop explorer's SPARQL editor entirely. The merged app has **one**
CodeMirror 6 instance — ted-open-data's existing one with ePO autocomplete
and SPARQL syntax linting. This is the only editor surface for query
input across the whole app.

The Search tab does not have its own editor. When the user types a pub
number on Search and clicks Search, the app **generates a canned
CONSTRUCT** for that notice, **drops it into the Query Editor tab's
editor (replacing whatever was there)**, and runs it through the same
execution pipeline as a hand-written query.

Explorer's `SparqlPanel.js` and the `panel-sparql` HTML are dead code in
the merged app and get deleted.

### 3.3 Auto-routing by query type

After every successful query execution, the app routes the user to the
appropriate result tab based on the query's type. Detection uses sparqljs
(already imported in `QueryEditor.js`):

```js
const parsed = parser.parse(query);
switch (parsed.queryType) {
  case 'SELECT':    showQueryResultsTab(); renderTabular(results); break;
  case 'CONSTRUCT':
  case 'DESCRIBE':  showExploreTab();      renderRdfGraph(results); break;
  case 'ASK':       showAskPopup(results); break; // deferred — see §6
}
```

The result tab not chosen is **hidden** (we don't keep stale results
visible from a previous run of a different type). "Last result wins" is
the explicit policy. Query result history is out of scope for the first
integration.

### 3.4 Format dropdown becomes query-type-aware

ted-open-data's existing Results Format dropdown (HTML / JSON / CSV /
TSV / Spreadsheet / XML / Turtle / RDF/XML / N-Triples / Javascript) is
currently shown unconditionally and mixes formats appropriate for SELECT
(JSON, CSV, …) with those for CONSTRUCT/DESCRIBE (Turtle, RDF/XML, …).
This is technically inconsistent — picking "JSON" with a CONSTRUCT does
not work as users would expect.

In the merged app:

- **For SELECT queries**: dropdown is visible, restricted to SELECT/ASK
  formats (HTML, JSON, CSV, TSV, Spreadsheet, XML, Javascript). HTML
  remains the default.
- **For CONSTRUCT/DESCRIBE queries**: dropdown is hidden entirely. The
  Explore tab does its own rendering and the user does not need a
  format choice for *viewing*.
- **For exporting CONSTRUCT/DESCRIBE results**: a separate "Download as
  ▾" menu lives on the Explore tab itself, with the three RDF formats
  (Turtle / RDF/XML / N-Triples).
- **Re-evaluation trigger**: piggyback on the existing syntax-check
  `parser.parse()` that runs as the user types. When the parsed query's
  type changes, update the dropdown's visibility and contents.

### 3.5 Shareable URLs

**Adopt explorer's `?facet=` URL mechanism unchanged.** Copy
`initFromUrlParams` and `getShareableUrl` from explorer's
`ExplorerController.js` into the merged app's controller as-is. No new
URL grammar.

The grammar (already shipped, tested, validated with Zod):

```
?facet={"type":"notice-number","value":"00172531-2026"}     // shorter when URL-encoded
?facet={"type":"named-node","term":{"value":"http://..."}}
?facet={"type":"query","query":"CONSTRUCT { ... } WHERE { ... }"}
```

About 100 chars for a notice URL after URL encoding (we shipped the
stripping work in PR #24 — unnecessary enrichment fields are no longer
serialised).

**Load-from-URL path in the merged app** becomes:

1. Parse `?facet=` JSON, validate with Zod
2. Convert facet → SPARQL query string (notice → canned CONSTRUCT,
   named-node → canned DESCRIBE/CONSTRUCT around URI, query → use as-is)
3. Drop the query into the SPARQL editor (replacing whatever was there)
4. Run the query
5. sparqljs detects type → auto-route to Explore tab
6. On fresh navigation (not reload), auto-switch to the Explore tab —
   already implemented in explorer's `SearchPanel.init` via
   `performance.getEntriesByType('navigation')[0]?.type !== 'reload'`

**Share button placement** stays exactly where we put it in
ted-open-data-explorer PR #24: next to the data card title on the Explore
tab. Hover style is the circular outline-secondary button.

**Query Results tab does NOT get a share button.** SELECT-result sharing
is out of scope for the first integration. ted-open-data's pre-existing
"Copy URL" button on the Query Editor (which builds a direct SPARQL
endpoint URL for tools like Excel/Power BI) stays as-is.

### 3.6 Home tab gets one new CTA bullet

ted-open-data's Home tab today has two call-to-action buttons:
"Try our query library" and "Write your own query". Add a third:

> "or **select an existing notice to see what is inside**"

That's the only change to the Home tab. The marketing copy, the inline
SPARQL editor on the Home tab, the layout, and everything else stay
exactly as they are.

### 3.7 Aesthetic approach

**Fork A — conservative integration.** Explorer adopts ted-open-data's
restrained visual chrome:

- Strip explorer's extra colour variants (warning orange, info blue,
  danger red) down to greys plus the one TED green
- Loosen explorer's dense layout to match ted-open-data's generous
  spacing
- Demote explorer's feature-rich chrome (tree/turtle/backlinks toggle,
  breadcrumbs, data card share button) to quieter visual treatment —
  thinner borders, more white space, less contrast
- Keep ted-open-data's typography, colours, header border, footer

**No aesthetic refresh** of ted-open-data is in scope. Typography,
colours, layout stay as they are. Aesthetic conversation is reserved for
post-merge.

### 3.8 PR strategy

**One big PR** off `feature/integrate-explorer` branch. Reviewable as a
single unit. The plan in this document is the execution sequence for
*the implementer's* discipline (each step leaves the app working), not
for separate review milestones.

### 3.9 Decommission plan

Deferred. The standalone `ted-open-data-explorer` repository stays
alive, untouched, until the merged app ships and is verified in
production. Decommission plan is written post-merge.

## 4. What is explicitly out of scope

These were considered during planning and consciously deferred. A future
session that wants to add any of these should propose it as a separate
follow-up rather than expanding the integration PR:

- **Click-through from a SELECT-result row to the Explore tab.** When a
  SELECT returns notice URIs, those rows are not yet clickable in the
  first integration. Manual copy-paste into the Search tab works.
- **Sharing of SELECT results via the merged-app share mechanism.** No
  share button on Query Results. ted-open-data's existing endpoint-URL
  button stays.
- **Pretty URL grammar** (`?notice=00172531-2026`, `?uri=...`). The
  current `?facet=<json>` is good enough; prettifying is a polish item.
- **ASK query handling.** Will be a popup eventually. Until then, ASK
  queries go through the SELECT path (HTML format, Query Results tab)
  and the user sees a one-row "true/false" table. Acceptable interim.
- **Query result history / "previous results"** ("last result wins").
- **View-mode-in-URL** (sharing a Tree vs Turtle vs Backlinks preference).
- **Query-editor draft sharing** (sharing a query the user typed but
  hasn't run).
- **Aesthetic refresh of the merged app** (separate post-merge effort).
- **Tests for most pre-existing ted-open-data code.** We bring
  explorer's test suite in and we add a narrow set of characterisation
  tests for `QueryEditor.js` (Stage 1.5), because that file is the
  single most refactored file in the integration. We do **not**
  retroactively write tests for the other legacy vanilla-JS files
  (`QueryLibrary.js`, `QueryResults.js`, `HomeTab.js`) — they are
  touched lightly or not at all, and the Stage 14 manual QA pass
  suffices.

## 5. Target architecture after the merge

### 5.1 File layout in ted-open-data

```
ted-open-data/
├── index.html                    [MODIFIED: 6 tabs, new shell, new HTML for Search + Explore]
├── package.json                  [MODIFIED: + n3, + zod, + test script]
├── INTEGRATION_PLAN.md           [this file — kept until merge ships, then deleted]
├── scripts/
│   └── build-codemirror.js       [MODIFIED: extra entry points if needed]
├── src/
│   ├── assets/
│   │   ├── style.css             [MODIFIED: + explorer styles, scoped + restrained per Fork A]
│   │   └── ted-logo.png          [unchanged]
│   ├── js/
│   │   ├── script.js             [MODIFIED: bootstraps the new app surface]
│   │   ├── HomeTab.js            [MODIFIED: + 3rd CTA bullet]
│   │   ├── QueryEditor.js        [MODIFIED: format dropdown becomes query-type-aware; sparqljs queryType drives auto-routing]
│   │   ├── QueryLibrary.js       [unchanged]
│   │   ├── QueryResults.js       [MODIFIED: hideable on cold load; shows only when SELECT/ASK results exist]
│   │   ├── cors-proxy.js         [unchanged]
│   │   │
│   │   ├── ExplorerController.js [NEW — copied from explorer, the model layer for instance views]
│   │   ├── SearchPanel.js        [NEW — copied from explorer, simplified (no SPARQL panel, no panel-sparql wiring)]
│   │   ├── DataView.js           [NEW — copied from explorer, the Explore tab rendering surface]
│   │   ├── NoticeView.js         [NEW — copied from explorer, the procedure timeline + notice render flow]
│   │   ├── BacklinksView.js      [NEW — copied from explorer]
│   │   ├── TreeRenderer.js       [NEW — copied from explorer, pure RDF tree rendering helpers]
│   │   ├── facets.js             [NEW — copied from explorer, the facet schema + creators]
│   │   ├── clipboardCopy.js      [NEW — copied from explorer, shared share-button helper]
│   │   ├── cm-theme.js           [NEW — copied from explorer, eclipse-inspired CM theme — if not already present]
│   │   └── services/
│   │       ├── sparqlService.js  [NEW — copied from explorer, the worker-based SPARQL execution]
│   │       ├── tedAPI.js         [NEW — copied from explorer, procedure timeline data fetching]
│   │       └── randomNotice.js   [NEW — copied from explorer, lucky-link backend]
│   └── vendor/
│       ├── codemirror-entry.js   [MODIFIED: + Turtle language for the Explore tab Turtle view]
│       └── codemirror-bundle.js  [REGENERATED via npm run build:codemirror]
└── test/
    ├── controller.test.js        [NEW — copied from explorer]
    ├── treeRenderer.test.js      [NEW — copied from explorer]
    ├── sparqlService.test.js     [NEW — copied from explorer]
    └── randomNotice.test.js      [NEW — copied from explorer]
```

**Files deleted from explorer that do NOT come over:**

- `index.html` — replaced by ted-open-data's
- `SparqlPanel.js` — there is only one editor (Decision §3.2)
- Anything wrapping the SPARQL editor — replaced by ted-open-data's
  `QueryEditor.js`
- Explorer's `style.css` — merged into ted-open-data's

### 5.2 Component ownership in the merged app

| Component | Owner | Lives in |
|---|---|---|
| Top-level tab nav + tab visibility logic | new `script.js` orchestration | `src/js/script.js` |
| SPARQL editor (the only one) | `QueryEditor.js` (ted-open-data's) | unchanged |
| Query type detection + auto-routing | `QueryEditor.js` after Run | extended |
| Query Library accordion | `QueryLibrary.js` (ted-open-data's) | unchanged |
| Query Results tabular rendering | `QueryResults.js` (ted-open-data's) | extended only for hide-on-cold-load |
| Search tab (notice input, lucky link, history dropdown) | `SearchPanel.js` (from explorer) | new |
| Explore tab rendering surface (tree, turtle, backlinks, breadcrumb, data card title) | `DataView.js` (from explorer) | new |
| Notice procedure timeline + enrichment | `NoticeView.js` (from explorer) | new |
| Backlinks view | `BacklinksView.js` (from explorer) | new |
| Pure tree rendering helpers | `TreeRenderer.js` (from explorer) | new |
| Facet schema, validation, URL serialisation | `ExplorerController.js` + `facets.js` (from explorer) | new |
| Worker-based SPARQL execution | `sparqlService.js` (from explorer) | new |
| TED API enrichment | `tedAPI.js` (from explorer) | new |
| Random notice picker | `randomNotice.js` (from explorer) | new |

### 5.3 Data flow on a notice search

```
User types "00172531-2026" on Search tab and clicks Search
  └─> SearchPanel._search()
      └─> generates canned CONSTRUCT for the notice
      └─> drops the CONSTRUCT into QueryEditor.editorView (replacing whatever was there)
      └─> calls QueryEditor.runQuery()
          └─> parser.parse(query) → queryType === 'CONSTRUCT'
          └─> sparqlService.execute(query)
              └─> worker fetches Turtle from endpoint
              └─> N3 parses Turtle → quads
          └─> ExplorerController.setResults(quads)
              └─> emits 'results-changed'
              └─> emits 'facet-changed'
                  └─> DataView._onFacetChanged: shows Explore tab, renders breadcrumb
                  └─> DataView._onResultsChanged: renders tree
          └─> auto-switch to Explore tab
```

### 5.4 Data flow on a custom CONSTRUCT typed in the editor

```
User writes CONSTRUCT in Query Editor and clicks Run Query
  └─> QueryEditor.runQuery()
      └─> parser.parse(query) → queryType === 'CONSTRUCT'
      └─> sparqlService.execute(query)
          └─> ... same as above ...
      └─> auto-switch to Explore tab (no facet, just raw quads)
          └─> DataView renders the result as a tree with ad-hoc roots
```

### 5.5 Data flow on a SELECT

```
User writes SELECT in Query Editor and clicks Run Query
  └─> QueryEditor.runQuery()
      └─> parser.parse(query) → queryType === 'SELECT'
      └─> Use the existing ted-open-data execution path (fetch with format from dropdown)
      └─> QueryResults.render(jsonResults)
      └─> auto-switch to Query Results tab
```

### 5.6 Data flow on a `?facet=` URL load

```
Page loads with ?facet=<json>
  └─> ExplorerController.initFromUrlParams() (copied from explorer)
      └─> parses + validates with Zod
      └─> facet → canned SPARQL query
      └─> drops query into QueryEditor.editorView
      └─> calls QueryEditor.runQuery()
      └─> ... same as above flows from here ...
      └─> if navigation type !== 'reload', auto-switch to Explore tab
```

## 6. Sequenced execution plan

The work is split into **stages**. Each stage has:

- **Goal** — the outcome we're driving toward
- **Files touched** — exact paths
- **Verification** — how to know the stage is done
- **Working-state checkpoint** — confirmation that the app still
  loads/runs after this stage

The order is chosen so that the merged app remains buildable and runnable
after every stage. This is critical: if we get interrupted mid-stage, the
codebase should not be in a "half-merged, nothing works" state.

**Commit cadence**: Stage 1.6 (Baseline commit) is the **only mandatory
commit** in this sequence. All other commits are at the implementer's
discretion: commit when a stage leaves the app in a meaningfully complete,
shippable-quality state, never when it's half-baked. Each stage's
"working-state checkpoint" is a *suggested* commit boundary, not a
required one.

### Stage 0 — Pre-flight

**Goal**: branch ready, plan committed, baseline verified.

**Files touched**: none (just verifying)

**Steps**:
1. Confirm we're on `feature/integrate-explorer` (already done at the
   time of writing this plan)
2. `npm install` and confirm ted-open-data builds and serves cleanly
   on its own (no regression from a stale `node_modules`)
3. Open `http://localhost:8080/` and confirm all 5 existing tabs work
4. Take a baseline screenshot of the current ted-open-data home/library/
   editor/results/help for visual diff later

**Verification**: ted-open-data runs on `localhost:8080` exactly as it
runs in production today.

**Working-state checkpoint**: nothing changed, baseline established.

---

### Stage 1 — Add new dependencies

**Goal**: bring in the npm dependencies explorer needs (N3, Zod) and any
small helpers, without yet adding any source files that use them.

**Files touched**:
- `package.json` — add `n3`, `zod` to dependencies; add `test` script
  pointing at `node --test test/*.test.js`
- `package-lock.json` — regenerated by `npm install`

**Steps**:
1. `npm install n3 zod`
2. Add `"test": "node --test test/*.test.js"` to scripts
3. Confirm `npm install` produces no peer-dep warnings

**Verification**: `npm test` runs (will pass with 0 tests since no test
files exist yet)

**Working-state checkpoint**: ted-open-data still runs unchanged. Only
deps changed.

---

### Stage 1.5 — Baseline characterisation tests for `QueryEditor.js`

**Goal**: pin down the current behaviour of `QueryEditor.js`'s key
public functions so the heavy refactoring in Stages 7, 8, and 10
cannot silently break ePO autocomplete, query minification, syntax
checking, or query-type detection. This is the single most refactored
file in the integration (touched by stages 7, 8, and 10), and it has
zero test coverage today.

**Files touched** (NEW):
- `test/queryEditor.test.js` — characterisation tests

**Tests to add** (~10–15 cases):

1. **`minifySparqlQuery` round-trip**: known input → known output for
   ~5 representative queries:
   - Simple `SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10`
   - SELECT with line + block comments interleaved
   - A small `CONSTRUCT { ... } WHERE { ... }`
   - A `DESCRIBE <uri>`
   - An `ASK { ... }`

   Each test asserts the exact output the current implementation
   produces (not what it "should" produce — characterisation tests pin
   down the *actual* current behaviour, even if that behaviour has
   quirks). If a quirk is wrong, that's a separate fix tracked
   outside this PR.

2. **`checkSparqlSyntax` valid/invalid handling**:
   - Valid SELECT → returns no error
   - Valid CONSTRUCT → returns no error
   - Syntax error in middle of query → returns error with reasonable
     line/column info
   - Empty string → behaviour pinned (whatever the current code
     does — likely either "no error" or a specific empty-query
     message)
   - Query with only whitespace → behaviour pinned

3. **sparqljs `parser.parse(q).queryType` detection** (the contract
   the auto-routing in Stages 7-8 will rely on):
   - SELECT → `'SELECT'`
   - CONSTRUCT → `'CONSTRUCT'`
   - DESCRIBE → `'DESCRIBE'`
   - ASK → `'ASK'`
   - Mixed-case SELECT (`Select`, `select`) → still `'SELECT'`
   - SELECT with leading PREFIX declarations → still `'SELECT'`

   These tests pin down the auto-routing contract *before* any code
   uses it — they cannot silently regress.

**Skipped (deliberate)**:
- `QueryLibrary.js`, `QueryResults.js`, `HomeTab.js` are touched
  lightly or not at all; the Stage 14 manual QA pass suffices.
- DOM-coupled methods of `QueryEditor.js` (the `onSubmit` flow, the
  CodeMirror instantiation) need a DOM shim and are out of scope for
  this characterisation pass — Stage 14 manual QA covers them.

**Verification**:
- `npm test` reports `# pass <baseline test count> / # fail 0`
- Each test has a single, narrow assertion clearly tied to a behaviour
  that should NOT change in any later stage

**Working-state checkpoint**: ted-open-data still runs unchanged. The
test suite has its first ~10–15 passing tests, all on
`QueryEditor.js`'s invariants. The test runner is verified to work in
the merged repo *before* explorer's 123 tests come over in Stage 4.

---

### Stage 1.6 — Baseline commit

**Goal**: lock in the pre-integration state as a recoverable
checkpoint. This is the **one mandatory commit** in the entire
sequence — everything before it is preparation; everything after is
the actual integration work.

**Files touched**: none modified — this stage *commits* what Stages 1
and 1.5 produced.

**Steps**:
1. Confirm working tree is clean except for:
   - `INTEGRATION_PLAN.md` (this file)
   - `package.json` (deps from Stage 1)
   - `package-lock.json` (regenerated by Stage 1's `npm install`)
   - `test/queryEditor.test.js` (baseline tests from Stage 1.5)
2. `npm test` — confirm Stage 1.5's tests still pass
3. Stage and commit those four files. Suggested commit message:

   ```
   chore: integration plan, deps, and baseline QueryEditor tests

   Adds the integration plan for absorbing ted-open-data-explorer,
   the n3 + zod dependencies the explorer code will need, and a
   characterisation test suite pinning down QueryEditor.js's current
   minify, syntax-check, and query-type-detection behaviour. This is
   the pre-integration checkpoint — explorer code lands in subsequent
   commits.
   ```

**Verification**:
- `git log --oneline develop..HEAD` shows exactly one commit
- That commit contains only the four files listed above
- `npm test` still passes
- ted-open-data still serves cleanly on `localhost:8080`

**Working-state checkpoint**: a clean, recoverable baseline. If Stages
2–15 go wrong, `git reset --hard` to this commit returns the branch to
"ted-open-data + deps + baseline tests, no explorer code yet."

**At this stage boundary, the implementer should stop and report to
the user before continuing to Stage 2.** This is the first natural
review point — the user can confirm the baseline is solid before any
explorer code lands in ted-open-data's tree.

---

### Stage 2 — Port explorer's pure-helper modules

**Goal**: bring in the modules that have **zero UI dependencies** —
they're pure functions or pure data structures. These can land without
wiring anything to the existing UI.

**Files touched** (all NEW unless noted):
- `src/js/namespaces.js` — RDF namespace prefix → URI map and
  `shortLabel` helper. Pure data + pure function. Imported by `facets.js`,
  `TermRenderer.js`, `services/labelService.js`.
- `src/js/facets.js` — facet schema + creators (Zod schemas, no DOM).
  Imports `namespaces.js`.
- `src/js/clipboardCopy.js` — clipboard copy helper (writeText + a
  document.execCommand fallback). DOM-using but only when called.
- `src/js/TermRenderer.js` — pure RDF term rendering helpers
  (renderTerm, renderSubjectBadge). DOM creation only when called.
  Imports `namespaces.js` and `services/labelService.js`.
- `src/js/TreeRenderer.js` — pure RDF tree rendering helpers. DOM
  creation only when called. Imports `namespaces.js` and `TermRenderer.js`.
- `src/js/sparqlWorker.js` — Web Worker that executes SPARQL queries
  off-thread and parses Turtle into quads. No imports of explorer
  modules; runs as a worker (loaded via `new URL('../sparqlWorker.js',
  import.meta.url)` from `services/sparqlService.js`).
- `src/js/services/sparqlService.js` — worker-based SPARQL execution.
  Note: this duplicates ted-open-data's existing fetch-based execution,
  by design — the two coexist temporarily until Stage 7 unifies them.
  Loads `sparqlWorker.js`.
- `src/js/services/tedAPI.js` — TED procedure-timeline API client.
  Imports `facets.js`. **IMPORTANT**: bring over the post-hotfix-2.0.1
  version that always uses the acceptance API. The pre-hotfix version
  had a host-based switch that broke production with CORS errors.
- `src/js/services/labelService.js` — async label resolution for RDF
  resources. Imports `namespaces.js` and `services/sparqlService.js`.
- `src/js/services/randomNotice.js` — lucky-link backend (random notice
  picker). Imports `services/sparqlService.js`.
- `src/js/cm-theme.js` — **DO NOT PORT**: ted-open-data already has a
  functionally equivalent Eclipse-like theme. Keep ted-open-data's
  existing version. Stage 12 (Aesthetic alignment) catches any subtle
  styling differences if they matter.

**Steps**:
1. Copy the files verbatim from
   `/home/rousoio/Code/TEDSWS/ted-open-data-explorer/src/js/`
2. Update import paths if explorer used relative imports that don't
   resolve in the new location (none expected — flat layout)
3. Confirm none of these files import anything from explorer-side
   modules that we haven't ported yet
4. Confirm none of these files reference DOM IDs that don't yet exist
   in ted-open-data's HTML

**Verification**: ted-open-data still loads `localhost:8080` and works
exactly as before. The new files exist on disk but nothing imports them
yet.

**Working-state checkpoint**: ted-open-data UI unchanged, new modules
sitting unused.

---

### Stage 3 — Port the explorer model layer

**Goal**: bring in `ExplorerController.js`, `NoticeView.js`,
`BacklinksView.js`, and `DataView.js` — the controller + view layer
that drives the Explore tab. Still no HTML changes; these load but
nothing wires them up.

**Files touched** (all NEW):
- `src/js/ExplorerController.js`
- `src/js/DataView.js`
- `src/js/NoticeView.js`
- `src/js/BacklinksView.js`
- `src/js/SearchPanel.js`

**Notes**:
- `SearchPanel.js` is copied **with the SPARQL panel removed** —
  Decision §3.2 means there's no longer a notice/SPARQL toggle, just
  the notice search input
- All modules retain their dependency-injection seams that the test
  suite uses

**Steps**:
1. Copy verbatim
2. In `SearchPanel.js`, delete the panel-sparql wiring, the SPARQL
   mode-toggle radios, and any code that references `panel-sparql` /
   `mode-sparql` element IDs
3. Run `node --check` on each new file to confirm they parse

**Verification**: ted-open-data still loads and works exactly as
before. No code paths reach the new files yet.

**Working-state checkpoint**: same as Stage 2 — files exist, unused.

---

### Stage 4 — Port test suite

**Goal**: bring in explorer's 123 tests so we have safety nets for the
ported code. Tests must run *before* we touch any wiring.

**Files touched** (all NEW):
- `test/controller.test.js`
- `test/treeRenderer.test.js`
- `test/sparqlService.test.js`
- `test/randomNotice.test.js`

**Steps**:
1. Copy verbatim from explorer's `test/`
2. Run `npm test`
3. Expect: all 123 tests pass (the modules under test were copied
   verbatim in Stages 2-3)

**Verification**: `npm test` reports `# pass 123 / # fail 0`.

**Working-state checkpoint**: ted-open-data UI still unchanged, but now
its test suite has 123 passing tests for the ported modules.

---

### Stage 5 — Add the Search tab and Explore tab HTML scaffolding

**Goal**: add the new tab buttons and tab panes to `index.html`,
hidden by default, with no JS wiring yet.

**Files touched**:
- `index.html` — add `<li>` for Search tab, `<li>` for Explore tab
  (with `style="display:none"` so it's hidden until a facet exists),
  add `<div class="tab-pane">` panels for both
- `src/assets/style.css` — add scoped styles for the new tab content,
  using Fork A restraint (greys + TED green only)

**Notes**:
- The Search tab `<li>` lives between Home and Query Library in the nav
  order
- The Explore tab `<li>` lives between Query Editor's pair (Query
  Editor + Query Results) and Help — i.e. position 6, before the right-
  aligned Help
- The Query Results `<li>` also gets a hide-on-cold-load `id` so the
  controller can toggle it
- The HTML for the Search tab pane is the trimmed version from
  explorer's `index.html` — notice search input, lucky link, history
  dropdown, no SPARQL mode toggle, no SPARQL panel
- The HTML for the Explore tab pane is the full data card from
  explorer's `index.html` — breadcrumb, view-mode toggle (tree/turtle/
  backlinks), data card title with share button, tree container, turtle
  container, backlinks container, not-found state, and the safety-net
  placeholder we just added in PR #24
- ID/class collisions (`.progress-bar`, `#query-timer`) are resolved by
  scoping the explorer-side selectors with a parent ID

**Verification**:
1. Open `localhost:8080`
2. Confirm only Home + Query Library + Query Editor + Help are visible
   on cold load — Search, Query Results, Explore are hidden
3. Manually `document.getElementById('app-tab-search').style.display =
   ''` in the console; the Search tab button appears, clicking it
   shows the empty Search panel

**Working-state checkpoint**: ted-open-data still runs. The new tabs
exist but are unwired. Manual DOM manipulation can reveal them; nothing
in the JS does it yet.

---

### Stage 6 — Wire the Search tab and Explore tab JS

**Goal**: instantiate `ExplorerController`, `SearchPanel`, `DataView`,
`NoticeView`, `BacklinksView` and let the user type a notice number on
the Search tab and see the result on the Explore tab.

**Files touched**:
- `src/js/script.js` — instantiate the new controllers, wire them to
  the new tab panes
- Possibly small adjustments to `SearchPanel.js` and `DataView.js` to
  use the merged-app element IDs (if they differ from explorer's)

**Notes**:
- This stage uses **explorer's `sparqlService.js`** to execute the
  CONSTRUCT (not ted-open-data's existing fetch path). The two
  execution paths coexist temporarily; Stage 7 will unify them.
- The Search tab does NOT yet route through the SPARQL editor. It runs
  the CONSTRUCT directly through `sparqlService` and renders into the
  Explore tab. This is a temporary intermediate state — Stage 8
  introduces the "drop CONSTRUCT into the editor" wiring.
- Why this intermediate state? Because making the Explore tab work
  end-to-end via the existing explorer code path is the simplest first
  validation. We then refactor to use the editor pipeline once the
  rendering surface is proven to work.

**Verification**:
1. Open `localhost:8080`
2. Click the Search tab (it should now show automatically? **no**, see
   §6 — both result tabs only show after a query, but the Search tab
   is an *input* tab, not a result tab. The Search tab should be
   visible from cold load. Adjust Stage 5's display rules accordingly.)
3. Type a publication number (e.g. `00172531-2026`) and click Search
4. Explore tab appears, becomes active, and shows the notice's RDF tree
5. Procedure timeline appears with sibling notices
6. Breadcrumb works
7. Tree/Turtle/Backlinks toggle works
8. Share button appears next to the data card title and copies a
   working URL

**Working-state checkpoint**: the merged app now has BOTH ted-open-data's
SPARQL playground AND a working notice browser, side by side, but the
two are not yet integrated — they use parallel execution paths.

---

### Stage 7 — Unify the SPARQL execution path

**Goal**: replace the two parallel execution paths
(ted-open-data's fetch-based + explorer's worker-based) with a **single
shared path** that handles both SELECT (returns JSON results) and
CONSTRUCT/DESCRIBE (returns Turtle, parsed by N3 into quads).

**Files touched**:
- `src/js/services/sparqlService.js` — extend to handle both result
  formats. Returns `{ kind: 'select', results }` for SELECT/ASK and
  `{ kind: 'graph', quads, rawTurtle }` for CONSTRUCT/DESCRIBE
- `src/js/QueryEditor.js` — refactor to call the unified service and
  pass results to either `QueryResults.render()` or to
  `ExplorerController.setResults()` depending on `kind`
- `src/js/QueryResults.js` — minor adjustments if needed for hide-on-
  cold-load

**Decision points to resolve at this stage**:
1. **Keep the worker?** Explorer uses a Web Worker for SPARQL execution
   so the UI thread stays responsive on big result sets. ted-open-data
   does it on the main thread. Keep the worker — it's strictly better.
2. **Format negotiation**: SELECT path uses the existing format
   dropdown's choice (HTML/JSON/CSV/...). CONSTRUCT/DESCRIBE path
   always requests Turtle internally, ignoring the dropdown (which is
   hidden anyway per §3.4).

**Verification**:
1. SELECT query in editor → click Run → Query Results tab appears,
   shows tabular data
2. CONSTRUCT query in editor → click Run → Explore tab appears, shows
   tree
3. Switching format dropdown for SELECT changes the result view
4. Switching format dropdown is hidden when query is CONSTRUCT
5. `npm test` still passes 123/123

**Working-state checkpoint**: one execution path, two result destinations,
both work.

---

### Stage 8 — Wire the Search tab to drop into the editor

**Goal**: when the user types a notice number on the Search tab and
clicks Search, the canned CONSTRUCT for that notice is **dropped into
the SPARQL editor (replacing whatever was there)** and run via the
unified pipeline. The result lands on Explore via auto-routing.

**Files touched**:
- `src/js/SearchPanel.js` — instead of calling `sparqlService` directly,
  generate the CONSTRUCT string and call a new method on `QueryEditor`
  like `loadAndRun(query)` that programmatically sets the editor
  content and triggers Run
- `src/js/QueryEditor.js` — expose `loadAndRun(query)` (or similar)
  as a public entry point

**Steps**:
1. Define the canned CONSTRUCT pattern. Suggested:
   ```sparql
   PREFIX epo: <http://data.europa.eu/a4g/ontology#>
   CONSTRUCT { ?s ?p ?o }
   WHERE {
     ?s ?p ?o .
     ?s epo:hasPublicationNumber "00172531-2026" .
   }
   ```
   (Verify with the team that this matches what explorer uses today.)
2. `SearchPanel._search()` builds the CONSTRUCT, calls
   `QueryEditor.loadAndRun(constructString)`
3. The editor's run path handles routing to Explore via §3.3

**Verification**:
1. Type a pub number on Search → click Search
2. Switch to Query Editor tab → see the canned CONSTRUCT in the editor
3. Switch back to Explore → see the rendered notice
4. Modify the CONSTRUCT in the editor and click Run → Explore tab
   updates with the modified result
5. `npm test` still passes 123/123

**Working-state checkpoint**: Search tab is now thin sugar over the
editor pipeline. The execution path is fully unified.

---

### Stage 9 — Wire shareable URLs

**Goal**: the merged app loads `?facet=<json>` URLs and produces them
when the share button is clicked.

**Files touched**:
- `src/js/script.js` — at startup, call
  `ExplorerController.initFromUrlParams()` and route the resulting
  facet through `QueryEditor.loadAndRun()` (same path Search uses)
- `src/js/ExplorerController.js` — already has the methods; small
  adjustment may be needed to use `QueryEditor.loadAndRun()` instead of
  the old direct execution

**Steps**:
1. On page load, parse `?facet=` (or `?facet=` translated from any
   legacy format)
2. Convert facet to SPARQL query string
3. Call `QueryEditor.loadAndRun(query)`
4. After Run, the auto-router takes the user to Explore (or Results
   for query-type facets that turn out to be SELECT)
5. Apply the existing fresh-navigation-vs-reload logic from
   `SearchPanel.init` so reload preserves the active tab and fresh
   share URLs auto-switch

**Verification**:
1. Click share on a loaded notice → copies a `?facet=...` URL
2. Open that URL in a new tab → notice loads, lands on Explore
3. Reload the page → stays on whichever tab was active
4. URL ≈ 100 chars for a notice (per the stripping work in PR #24)

**Working-state checkpoint**: full sharing flow works end-to-end.

---

### Stage 10 — Format dropdown becomes query-type-aware

**Goal**: the dropdown shows only SELECT formats when the query is a
SELECT, and is hidden entirely when the query is a CONSTRUCT/DESCRIBE.

**Files touched**:
- `src/js/QueryEditor.js` — extend the existing `checkSparqlSyntax`
  flow to also update the dropdown's visibility/contents based on
  `parsed.queryType`
- `index.html` — minor adjustment to give the dropdown a stable ID and
  separate the SELECT-only option list from the unused
  CONSTRUCT-format options (which move to the new download menu)
- `src/js/DataView.js` — add a "Download as ▾" button group on the
  Explore tab data card row, with Turtle / RDF/XML / N-Triples options

**Verification**:
1. Type a SELECT → dropdown shows HTML/JSON/CSV/...
2. Type a CONSTRUCT → dropdown disappears
3. Type a DESCRIBE → dropdown disappears
4. Type an ASK → dropdown shows HTML/JSON only (or stays as SELECT-
   compatible)
5. On Explore, "Download as Turtle" downloads the raw Turtle, etc.

**Working-state checkpoint**: dropdown polish complete.

---

### Stage 11 — Home tab third CTA

**Goal**: add the third call-to-action bullet to the Home tab.

**Files touched**:
- `src/js/HomeTab.js` (or wherever the Home tab content is rendered)
- `index.html` if the home tab is static HTML

**Steps**:
1. Add the bullet "or **select an existing notice to see what is
   inside**"
2. Make it a button or link that activates the Search tab
3. Style consistently with the existing two CTAs

**Verification**: Home tab shows three CTAs, third one switches to
Search tab when clicked.

**Working-state checkpoint**: Home tab has its third entry point.

---

### Stage 12 — Aesthetic alignment pass (Fork A)

**Goal**: visually align explorer's UI with ted-open-data's restrained
chrome.

**Files touched**:
- `src/assets/style.css` — adjust spacing, colours, borders for the
  Search and Explore tab content per Fork A guidance (Decision §3.7)

**Steps**:
1. Audit the Explore tab visually — note any colour variants beyond
   greys + TED green that need to be desaturated
2. Audit spacing — increase paddings/margins to match ted-open-data's
   generous layout
3. Audit borders — thinner borders on the data card, breadcrumb,
   timeline, view-mode toggle
4. Audit typography — should match Bootstrap defaults exactly (no
   custom font stack), same as ted-open-data
5. Audit the share button hover state — keep it consistent with the
   restrained register
6. Take comparison screenshots before/after and confirm with the
   reviewer

**Verification**: visual diff against ted-open-data's existing tabs.
Nothing on Explore should look "louder" than anything on Query Editor.

**Working-state checkpoint**: aesthetic cohesion achieved.

---

### Stage 13 — Cleanup and dead code removal

**Goal**: remove anything from the explorer port that the merged app no
longer needs.

**Files touched**: various

**Candidates for removal**:
- Any reference to a separate "SPARQL panel" or notice/SPARQL mode toggle
  in `SearchPanel.js`
- Explorer's index.html (already deleted in Stage 5; verify nothing else
  references it)
- Any `panel-sparql` / `mode-sparql` IDs in the new HTML
- Any duplicate utility functions that ted-open-data already had
- Comments referencing the standalone explorer that no longer apply
- The `INTEGRATION_PLAN.md` file itself, once the work is complete and
  merged

**Verification**: `npm test` still passes 123/123. App still runs
end-to-end. Bundle size hasn't grown more than necessary.

---

### Stage 14 — Final QA pass

**Goal**: end-to-end manual verification before opening the PR.

**Test cases**:
1. Cold load → only Home / Query Library / Query Editor / Help visible
   (Search visible too — Search is an input tab); Query Results and
   Explore hidden
2. Search tab → type pub number → Search → Explore appears, populated
3. Search tab → click "lucky" link → Explore appears with random notice
4. Query Editor → write SELECT → Run → Query Results appears, populated
5. Query Editor → write CONSTRUCT → Run → Explore appears, populated
6. Query Library → click a query → it loads in Query Editor → Run →
   appropriate result tab activates
7. Share button on Explore → copy URL → open in new tab → notice loads
8. Reload while on Explore → stays on Explore
9. Format dropdown visible only for SELECT in editor
10. Download as Turtle/RDF/XML/N-Triples works on Explore
11. Home tab shows three CTAs
12. Help tab unchanged
13. ePO autocomplete still works in Query Editor
14. `npm test` passes 123/123
15. Page loads under 2s on a clean cache (rough perf check)
16. No console errors in any flow

**Verification**: all test cases pass.

---

### Stage 14a — Tab-name finalisation

**Goal**: replace the working titles used throughout the integration
with their final user-facing labels.

**Files touched**:
- `index.html` — text content of the seven `<button>` elements inside
  the `<ul class="nav nav-tabs">` block
- Possibly `src/js/HomeTab.js` if any tab labels are referenced from
  the third-CTA copy added in Stage 11

**Notes**:
- Element IDs (`app-tab-search`, `app-tab-explorer`, …) stay stable;
  only the visible `<button>` text changes
- No JS logic depends on the labels — only on the IDs — so this stage
  is purely cosmetic and cannot break anything mechanical
- The final tab names are decided in conversation with the user at
  this point in execution; they were deliberately deferred during
  planning so the names could be chosen with the merged app actually
  running and visible

**Verification**:
- Manual visual inspection of the nav bar
- Confirm `npm test` still passes
- Confirm none of the Stage 14 manual QA cases break (they shouldn't —
  none of them depend on label text)

**Working-state checkpoint**: nav labels reflect the user's final
naming choice. Architecture is unchanged.

---

### Stage 15 — Open the PR

**Goal**: open one big PR from `feature/integrate-explorer` → `develop`
on `OP-TED/ted-open-data`.

**PR description**:
- Link to this `INTEGRATION_PLAN.md`
- Summary of what changed (the seven new tabs structure, the unified
  pipeline, sharing, format dropdown, Fork A aesthetic)
- Screenshots before/after for each tab
- Test results (123/123)
- Reviewer guidance: read the plan first, then walk the diff stage by
  stage

## 7. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Worker doesn't load in ted-open-data's static-file context | Low | Medium | Stage 6 verifies before unification; fall back to main-thread fetch if needed |
| Two parallel execution paths drift before Stage 7 unifies them | Medium | Low | Keep Stages 6-7 close together; do not commit a Stage 6 state for >1 day before Stage 7 |
| ePO autocomplete breaks when QueryEditor is refactored to drive both result destinations | Medium | High | Stage 7 must run the autocomplete smoke test as part of verification |
| Format dropdown logic has edge cases (e.g. queries that don't parse) | Medium | Low | Re-evaluate only on successful parse; on parse failure, leave dropdown in last-known state |
| ID/class collisions surface issues we didn't predict | Low | Medium | Stage 5 verification specifically tests `.progress-bar` and `#query-timer` paths |
| `feature/integrate-explorer` branch goes stale against `develop` | High over time | Medium | Rebase weekly; prefer merge over rebase if conflicts get large |
| `index.html` becomes unmanageable (too many tab-panes in one file) | Medium | Low | Acceptable for first integration; decomposing index.html is a separate concern post-merge |

## 8. Open questions to resolve before or during execution

1. **The exact CONSTRUCT pattern for notice lookup** — what does
   explorer use today? Verify it produces the same triples we expect on
   the merged app's Explore tab. Likely answer: same as the explorer's
   current `_buildConstructForNotice` (or equivalent function in
   `NoticeView.js`/`SearchPanel.js`/`ExplorerController.js`).
2. **Does ted-open-data's CodeMirror entry need to grow?** Explorer's
   bundle includes Turtle language support for the Turtle view mode.
   Confirm that ted-open-data's bundle doesn't already include it; if
   not, add a Turtle entry to `src/vendor/codemirror-entry.js` and
   regenerate `codemirror-bundle.js`.
3. **Worker file path** — `sparqlService.js` loads a Web Worker from a
   relative path. Confirm the path resolves in ted-open-data's static
   layout. May need a small adjustment.
4. **Test runner pinning** — explorer's test suite uses
   `node:test`. Confirm ted-open-data's CI (when added) supports the
   same Node version. No CI exists today, so this is a non-issue for
   the PR but worth flagging for post-merge.
5. **Whether the existing "Copy URL" button on Query Editor stays where
   it is** — it builds a direct SPARQL endpoint URL, different
   purpose from the merged-app share button. Decision: keep it as-is
   (Decision §3.5). Verify nothing in the layout collides with the new
   dropdown logic.
6. **Auto-router behaviour for empty/whitespace queries** — discovered
   while writing Stage 1.5 baseline tests: sparqljs's `Parser` does
   NOT throw on an empty string; it returns `{prefixes: {}}` with
   **no `queryType` field**. The auto-routing code in Stages 7-8 must
   therefore handle "parsed but `queryType === undefined`" as a no-op
   (don't route to any result tab, don't clear the previous result).
   Pinned in `test/queryEditor.test.js` as a regression guard.

## 9. References

- **PR #24** in `OP-TED/ted-open-data-explorer`: contains the most
  recent explorer work (cold-load placeholder, history dropdown
  hydration, timeline-click history exclusion, share button on data
  card title, URL stripping, fresh-navigation tab switching). All of
  this code transfers verbatim into the merged app.
- Standalone explorer source:
  `/home/rousoio/Code/TEDSWS/ted-open-data-explorer/`
- ted-open-data source: `/home/rousoio/Code/TEDSWS/ted-open-data/`
- Live ted-open-data: `https://data.ted.europa.eu/`
- TED documentation: `https://docs.ted.europa.eu/`

---

**End of plan.** Execution begins after this document is reviewed and
signed off.
