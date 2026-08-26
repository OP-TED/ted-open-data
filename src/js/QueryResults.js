/*
 * Copyright 2024 European Union
 *
 * Licensed under the EUPL, Version 1.2 or – as soon they will be approved by the European
 * Commission – subsequent versions of the EUPL (the "Licence"); You may not use this work except in
 * compliance with the Licence. You may obtain a copy of the Licence at:
 * https://joinup.ec.europa.eu/software/page/eupl
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the Licence
 * is distributed on an "AS IS" basis, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the Licence for the specific language governing permissions and limitations under
 * the Licence.
 */

import { copyToClipboard } from './utils/clipboardCopy.js';
import { triggerBlobDownload } from './utils/download.js';
import { classifyError } from './utils/errorMessages.js';
import { buildSparqlBody, buildSparqlUrl } from './sparqlRequest.js';
import { showToast } from './utils/toast.js';
import { ChartView } from './ChartView.js';

// Domains that host actual navigable web pages in TED query results.
// An allowlist is safer than a blocklist: it stays correct as new
// data namespaces are added to the triplestore without needing updates here.
// Only URIs whose hostname is in this set are rendered as clickable links.
const NAVIGABLE_DOMAINS = new Set([
  'ted.europa.eu',
]);

/**
 * Class representing the Query Results.
 * This class is responsible for displaying the results of SPARQL queries and handling related actions.
 */
export class QueryResults {
  /**
   * Create a Query Results instance.
   * @param {QueryEditor} queryEditor - The QueryEditor instance.
   * @param {string} originalSparqlEndpoint - The original SPARQL endpoint URL.
   */
  constructor(queryEditor, originalSparqlEndpoint) {
    this.queryEditor = queryEditor;
    this.originalSparqlEndpoint = originalSparqlEndpoint;
    this.resultsDiv = document.getElementById("results");
    this.copyUrlAlert = document.getElementById('copy-url-alert');
    this.queryResultsTab = new bootstrap.Tab(document.getElementById('query-results-tab'));
    this.chartView = new ChartView();

    this.initEventListeners();
  }

  /**
   * Initialize event listeners.
   * Wires the Connect dialog and every dropdown item in the
   * "Download as…" menu. Each download item carries a
   * data-download-format attribute with the MIME type to request.
   */
  initEventListeners() {
    // The Connect panel hangs off its button as a popover rather than taking
    // the screen: what it describes is the query whose results are on show
    // behind it. The markup lives in the page and is handed to Bootstrap as
    // the popover's content, so these listeners are wired once and survive
    // the panel being shown and hidden.
    // Held rather than looked up later: once the popover has been shown and
    // hidden, Bootstrap has detached its tip and the panel with it, so the
    // panel is no longer findable in the document.
    const panel = document.getElementById('connect-panel');
    this._connectPanel = panel;
    if (panel) {
      panel.querySelectorAll('[data-connect-copy]').forEach(button => {
        button.addEventListener('click', () => this.onConnectCopy(button.dataset.connectCopy));
      });
      document.getElementById('connect-button')
        ?.addEventListener('click', () => this.toggleConnectPanel());
    }

    // Download as… dropdown items
    document.querySelectorAll('#copy-url-alert [data-download-format]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        this.downloadAs(item.dataset.downloadFormat);
      });
    });
  }

  /**
   * Show or hide the slim results toolbar (the strip above the table
   * that holds the hint, the Connect your app button and the
   * Download as… menu). Centralised here so every lane that needs to
   * toggle it (displayJsonResults, displayTextResults, the SELECT
   * submit paths in QueryEditor) goes through one place.
   * @param {boolean} visible
   */
  setToolbarVisible(visible) {
    if (!this.copyUrlAlert) return;
    this.copyUrlAlert.classList.toggle('d-none', !visible);
    this.copyUrlAlert.classList.toggle('d-flex', visible);
  }

  /**
   * Display JSON results.
   * @param {Object} data - The JSON results data.
   */
  displayJsonResults(data) {
    this.resultsDiv.innerHTML = "";

    // ASK queries return { boolean: true/false } rather than
    // { results: { bindings: [...] } }. Render a single-cell table
    // showing the boolean so the result is visible and downloadable,
    // rather than falling through to "No results found".
    if (typeof data.boolean === 'boolean') {
      const table = document.createElement('table');
      table.className = 'table table-striped sparql monospace';
      const thead = table.createTHead();
      const headerRow = thead.insertRow();
      const th = document.createElement('th');
      th.textContent = 'ASK';
      headerRow.appendChild(th);
      const tbody = table.createTBody();
      const tr = tbody.insertRow();
      const td = tr.insertCell();
      td.textContent = String(data.boolean);
      this.resultsDiv.appendChild(table);
      this.setToolbarVisible(true);
      this.chartView.destroy();
      return;
    }

    if (data.results && data.results.bindings.length > 0) {
      const table = document.createElement("table");
      table.className = "table table-striped sparql monospace";

      const thead = table.createTHead();
      const headerRow = thead.insertRow();
      const headers = Object.keys(data.results.bindings[0]);
      headers.forEach((header) => {
        const th = document.createElement("th");
        th.textContent = header;
        headerRow.appendChild(th);
      });

      const tbody = table.createTBody();
      data.results.bindings.forEach((row, index) => {
        const tr = tbody.insertRow();
        tr.className = index % 2 === 1 ? 'even' : '';
        headers.forEach((header) => {
          const td = tr.insertCell();
          const binding = row[header];
          td.appendChild(this._renderCell(binding));
        });
      });

      this.resultsDiv.appendChild(table);
      this.setToolbarVisible(true);
      this.chartView.setData(data);
    } else {
      this.resultsDiv.textContent = "No results found.";
      this.setToolbarVisible(false);
      this.chartView.destroy();
    }
  }

  /**
   * Render a single SPARQL result binding as a DOM node.
   * URI bindings that look like navigable web URLs (http/https pointing
   * to a known web domain) are rendered as clickable links opening in a
   * new tab. Everything else is plain text.
   *
   * Security is provided entirely by _isWebUrl: it uses new URL() to parse
   * the value and checks the hostname against an allowlist of known
   * navigable domains. Any dangerous scheme (javascript:, data:, etc.)
   * either fails to parse or returns a hostname that isn't in the allowlist.
   *
   * @param {{ type: string, value: string }|undefined} binding
   * @returns {Node}
   */
  _renderCell(binding) {
    const value = binding?.value || '';
    if (binding?.type === 'uri' && QueryResults._isWebUrl(value)) {
      const a = document.createElement('a');
      a.href = value;
      a.textContent = value;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      return a;
    }
    return document.createTextNode(value);
  }

  /**
   * Returns true only for http/https URIs whose hostname is in the
   * NAVIGABLE_DOMAINS allowlist — i.e. URIs that point to real web pages
   * rather than ontology terms or RDF data resources.
   *
   * @param {string} value
   * @returns {boolean}
   */
  static _isWebUrl(value) {
    try {
      const { protocol, hostname } = new URL(value);
      if (protocol !== 'http:' && protocol !== 'https:') return false;
      return NAVIGABLE_DOMAINS.has(hostname);
    } catch {
      return false;
    }
  }

  /**
   * Build a ready-to-paste cURL command that reproduces a SPARQL POST
   * request. The body is a URL-encoded `application/x-www-form-urlencoded`
   * string (from `buildSparqlBody`); it is wrapped in single quotes for
   * the shell, so any literal single quote inside it (e.g. from a SPARQL
   * string literal like `FILTER(?name = 'John')`) is percent-encoded to
   * %27 first — otherwise it would prematurely close the shell's quoted
   * argument and corrupt or break the command.
   *
   * The Accept header states the format the body asks for. Sending one that
   * contradicts it is not merely untidy: the endpoint answers 406 Not
   * Acceptable and the command returns nothing at all.
   *
   * @param {string} endpoint - The SPARQL endpoint URL.
   * @param {string} body - The url-encoded POST body (from buildSparqlBody).
   * @param {string} format - The MIME type that body asks for.
   * @returns {string} - The full curl command, ready to paste into a terminal.
   */
  static _buildCurlCommand(endpoint, body, format) {
    const safeBody = body.replace(/'/g, '%27');
    return `curl -X POST '${endpoint}' \\\n`
      + `  -H 'Content-Type: application/x-www-form-urlencoded' \\\n`
      + `  -H 'Accept: ${format}' \\\n`
      + `  -d '${safeBody}'`;
  }

  /**
   * Display text results.
   * @param {string} content - The text content.
   * @param {string} type - The content type (e.g., 'xml', 'csv', 'text').
   */
  displayTextResults(content, type) {
    this.resultsDiv.innerHTML = "";

    const pre = document.createElement("pre");
    pre.className = "p-3 bg-white border rounded";
    pre.style.overflow = "auto";
    
    if (type === 'xml') {
      pre.innerHTML = content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    } else {
      pre.textContent = content;
    }

    this.resultsDiv.appendChild(pre);
    this.setToolbarVisible(true);
    this.chartView.destroy();
  }

  /**
   * The formats a SELECT query can be asked for from another application.
   *
   * The Download menu's list less "Spreadsheet", which is not a format: the
   * endpoint returns the same HTML page it returns for text/html, labelled
   * application/vnd.ms-excel so that a browser hands the file to Excel
   * instead of rendering it. That is a download convention, and it reads
   * sensibly on a Download menu. A link built from it returns markup, which
   * is not what anyone connecting an application is asking for.
   */
  static CONNECT_FORMATS = [
    { mime: 'application/sparql-results+json', label: 'JSON' },
    { mime: 'text/csv', label: 'CSV' },
    { mime: 'text/tab-separated-values', label: 'TSV' },
    { mime: 'application/sparql-results+xml', label: 'XML' },
  ];

  /**
   * Build a ready-to-paste PowerShell command.
   *
   * Not a cURL command in disguise: inside PowerShell, `curl` is an alias for
   * Invoke-WebRequest and takes different arguments, so a pasted cURL line
   * fails there with an error that says nothing useful. Invoke-RestMethod is
   * what a Windows user actually has, and it parses the response rather than
   * handing back text.
   *
   * A PowerShell single-quoted string escapes a quote by doubling it.
   *
   * @param {string} endpoint - The SPARQL endpoint URL.
   * @param {string} body - The url-encoded POST body (from buildSparqlBody).
   * @returns {string}
   */
  /**
   * Build a ready-to-paste wget command.
   *
   * Not redundant beside cURL: a minimal Debian ships wget and not curl, which
   * is the sort of machine a scheduled job runs on. `-O -` writes to the
   * screen rather than to a file, which is what wget would otherwise do.
   *
   * Single quotes in the body are percent-encoded for the same reason as in
   * the cURL command: they would close the shell's quoted argument.
   *
   * @param {string} endpoint - The SPARQL endpoint URL.
   * @param {string} body - The url-encoded POST body (from buildSparqlBody).
   * @returns {string}
   */
  static _buildWgetCommand(endpoint, body, format) {
    const safeBody = body.replace(/'/g, '%27');
    return `wget -qO - '${endpoint}' \\\n`
      + `  --header='Content-Type: application/x-www-form-urlencoded' \\\n`
      + `  --header='Accept: ${format}' \\\n`
      + `  --post-data='${safeBody}'`;
  }

  static _buildPowerShellCommand(endpoint, body, format) {
    const quoted = (value) => `'${String(value).replace(/'/g, "''")}'`;
    return `Invoke-RestMethod -Method Post -Uri ${quoted(endpoint)} \`
`
      + `  -ContentType 'application/x-www-form-urlencoded' \`
`
      + `  -Headers @{ Accept = ${quoted(format)} } \`
`
      + `  -Body ${quoted(body)}`;
  }

  /**
   * What one button of the Connect dialog puts on the clipboard.
   *
   * Built when the button is pressed rather than held: each button carries its
   * own format, and the query can change while the dialog is open.
   *
   * @param {string} key - link | curl | powershell | sparql
   * @param {string} format - A MIME type. Ignored for `sparql`, which is the
   *   query text and the same whatever the endpoint is asked to return.
   * @returns {string}
   */
  buildConnectSnippet(key, format) {
    const query = this.queryEditor.getQuery();
    if (key === 'sparql') return query;

    const minifiedQuery = this.queryEditor.minifySparqlQuery(query);
    if (key === 'link') {
      return buildSparqlUrl(this.originalSparqlEndpoint, minifiedQuery, format);
    }

    const body = buildSparqlBody(minifiedQuery, format);
    const build = {
      curl: QueryResults._buildCurlCommand,
      wget: QueryResults._buildWgetCommand,
      powershell: QueryResults._buildPowerShellCommand,
    }[key];
    return build ? build(this.originalSparqlEndpoint, body, format) : '';
  }

  /**
   * Fill the Connect dialog's format menus, and show what each button will
   * return.
   *
   * Every button that has a format carries its own, so a button states what
   * it produces rather than inheriting a choice made elsewhere in the dialog.
   * The menus are written once and then left alone, so a choice survives the
   * dialog being closed and opened again.
   */
  fillConnectDialog() {
    // Within the panel, not the document: while the popover is hidden the
    // panel is detached, and its contents are not reachable from either.
    const panel = this._connectPanel;
    if (!panel) return;

    // The link's split button: the format is a choice it carries, so that
    // copying stays one click for whoever already has the format they want.
    for (const menu of panel.querySelectorAll('[data-connect-format-menu]')) {
      const key = menu.dataset.connectFormatMenu;

      if (!menu.children.length) {
        // The same stem as the commands: "link to get JSON". The format is
        // what the link fetches, not what the link is.
        const header = document.createElement('li');
        header.innerHTML = '<h6 class="dropdown-header">Link to get</h6>';
        menu.appendChild(header);

        for (const { mime, label } of QueryResults.CONNECT_FORMATS) {
          menu.appendChild(this._connectMenuItem(label, () => {
            // Choosing a format copies, as it does on the command menus. It is
            // also remembered, so the button's own half becomes a one-click
            // repeat of whatever was used last.
            this._connectFormats[key] = mime;
            this.fillConnectDialog();
            this.onConnectCopy(key, mime);
          }));
        }
      }

      const format = this.connectFormatFor(key);
      const chosen = QueryResults.CONNECT_FORMATS.find(f => f.mime === format);
      const name = panel.querySelector(`[data-connect-format-name="${key}"]`);
      if (name) name.textContent = chosen ? chosen.label : format;
    }

    // The commands: each item copies in that format, so nothing is carried
    // and nothing is assumed.
    for (const menu of panel.querySelectorAll('[data-connect-copy-menu]')) {
      if (menu.children.length) continue;
      const key = menu.dataset.connectCopyMenu;

      // A stem the items complete: "command to get JSON". Not "copy as JSON",
      // which says the clipboard gets JSON; it gets a command, and JSON is
      // what running the command fetches.
      const header = document.createElement('li');
      header.innerHTML = '<h6 class="dropdown-header">Command to get</h6>';
      menu.appendChild(header);

      for (const { mime, label } of QueryResults.CONNECT_FORMATS) {
        menu.appendChild(this._connectMenuItem(label, () => this.onConnectCopy(key, mime)));
      }
    }
  }

  /** One item of a Connect menu. */
  _connectMenuItem(label, onClick) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dropdown-item';
    button.textContent = label;
    button.addEventListener('click', onClick);
    item.appendChild(button);
    return item;
  }

  /** The format a given Connect button will return; the first one until chosen. */
  connectFormatFor(key) {
    this._connectFormats ??= {};
    return this._connectFormats[key] ?? QueryResults.CONNECT_FORMATS[0].mime;
  }

  /**
   * Show or hide the Connect panel.
   *
   * The popover is built on first use and kept, so the panel element is moved
   * in and out of it rather than rebuilt — which is what lets the listeners
   * wired at start-up go on working.
   */
  toggleConnectPanel() {
    const button = document.getElementById('connect-button');
    const panel = this._connectPanel;
    if (!button || !panel || typeof bootstrap === 'undefined' || !bootstrap.Popover) return;

    if (!this._connectPopover) {
      this._connectPopover = new bootstrap.Popover(button, {
        content: panel,
        html: true,
        sanitize: false,
        placement: 'bottom',
        trigger: 'manual',
        container: 'body',
        customClass: 'connect-popover',
        offset: [0, 14],
      });

      // Dismiss on a click outside it. Clicks within stay: the format menus
      // live inside the panel, and choosing one must not close it.
      document.addEventListener('click', (e) => {
        if (!this._connectPopoverShown) return;
        const tip = this._connectPopover.tip;
        if (tip?.contains(e.target) || button.contains(e.target)) return;
        this.hideConnectPanel();
      }, true);

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.hideConnectPanel();
      });
    }

    if (this._connectPopoverShown) {
      this.hideConnectPanel();
      return;
    }

    this.fillConnectDialog();
    this._connectPopover.show();
    this._connectPopoverShown = true;
    // While the panel is open the call to action is inside it. The button that
    // opened it steps back rather than competing with its own Copy link.
    button.classList.add('connect-open');
    button.setAttribute('aria-expanded', 'true');

    // The popover is appended to the body, far from the button in tab order,
    // so tabbing from the button walks past the panel into the rest of the
    // page. Focus is moved in, and put back on the button when it closes.
    const tip = this._connectPopover.tip;
    if (tip) {
      tip.setAttribute('role', 'dialog');
      tip.setAttribute('aria-label', 'Connect your app');
      tip.querySelector('button, [href], select, input')?.focus();
    }
  }

  hideConnectPanel() {
    if (!this._connectPopoverShown) return;
    const button = document.getElementById('connect-button');
    // Before the popover goes: focus inside it is about to be destroyed, and
    // the browser would drop it on the body.
    if (button && this._connectPopover.tip?.contains(document.activeElement)) {
      button.focus();
    }
    this._connectPopover.hide();
    this._connectPopoverShown = false;
    button?.classList.remove('connect-open');
    button?.setAttribute('aria-expanded', 'false');
  }

  /**
   * Copy the query link without going through the panel.
   *
   * For the timeout recovery message, which offers this when a query took too
   * long for the browser. The results toolbar is hidden on any error, and the
   * panel hangs off a button inside it — so there is nothing to hang it from
   * at the one moment it is most wanted. The link is the whole of what that
   * message is offering anyway.
   */
  copyQueryLink() {
    return this.onConnectCopy('link');
  }

  /**
   * Copy one snippet from the Connect dialog.
   *
   * @param {string} key - link | curl | powershell | sparql
   * @param {string} [format] - A MIME type. The commands name one at the
   *   moment of copying; the link carries the one shown on its button.
   */
  async onConnectCopy(key, format = undefined) {
    const query = this.queryEditor.getQuery();
    if (!query || !query.trim()) {
      showToast('Nothing to copy', 'Write a query first, then try again.', { variant: 'warning' });
      return;
    }

    const chosenFormat = format ?? this.connectFormatFor(key);
    const value = this.buildConnectSnippet(key, chosenFormat);
    if (!value) return;

    // The format is named back, because it was chosen a moment ago in a menu
    // that has already closed. The query carries none: it is the same text
    // whatever the endpoint is asked to return.
    const label = QueryResults.CONNECT_FORMATS.find(f => f.mime === chosenFormat)?.label;
    const returns = key === 'sparql' || !label ? '' : ` It returns ${label}.`;

    const said = {
      link: ['Link copied', 'Paste it into Excel, Power BI, or anything that reads data from the web.'],
      curl: ['cURL command copied', 'Paste it into a terminal on macOS or Linux.'],
      wget: ['wget command copied', 'Paste it into a terminal on Linux.'],
      powershell: ['PowerShell command copied', 'Paste it into PowerShell on Windows.'],
      sparql: ['SPARQL query copied', 'Paste it into an app that speaks SPARQL to run the same query.'],
    }[key];

    if (await copyToClipboard(value)) {
      // The panel has done its job; leaving it open covers the results it
      // describes and asks the user to dismiss something they are finished with.
      this.hideConnectPanel();
      showToast(said[0], said[1] + returns);
    } else {
      showToast('Copy failed', 'Could not copy to the clipboard. Please try again.', { variant: 'danger' });
    }
  }

  /**
   * Download the current query's result in the requested format.
   *
   * Re-fetches the endpoint with the chosen `format` parameter rather
   * than reusing the cached editor response — the editor always runs
   * JSON, but the user might want a CSV or an Excel file on disk.
   *
   * The returned payload is wrapped in a Blob with MIME type
   * application/octet-stream so the browser always triggers a file
   * download instead of opening HTML/XML/CSV content inline. The
   * `download` attribute on the anchor element provides the actual
   * filename and extension.
   *
   * @param {string} format - The SPARQL result MIME type to request
   *   (e.g. "text/csv", "application/sparql-results+json").
   * @async
   */
  async downloadAs(format) {
    const query = this.queryEditor.getQuery();
    if (!query || !query.trim()) {
      showToast('Download failed', 'Write a query first, then try again.', { variant: 'warning' });
      return;
    }

    // Build the same POST body the editor uses, but with the chosen
    // format instead of the always-JSON one.
    const minifiedQuery = this.queryEditor.minifySparqlQuery(query);
    const body = buildSparqlBody(minifiedQuery, format);

    try {
      // Client-side abort ceiling for the download fetch. The user-facing
      // server timeout option was removed (issue #32), so use a fixed 60s.
      const downloadTimeout = 60_000;
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), downloadTimeout);
      const response = await fetch(this.queryEditor.sparqlEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": format,
        },
        body,
        signal: abort.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        console.error('Download failed:', response.status, detail);
        const err = new Error(`HTTP error. Status: ${response.status}\n${detail}`);
        const { friendly } = classifyError(err, 'select');
        showToast('Download failed', friendly, { variant: 'danger' });
        return;
      }
      const text = await response.text();
      triggerBlobDownload(text, `query-results${QueryResults._extensionFor(format)}`);
    } catch (error) {
      console.error('Download failed:', error);
      if (error?.name === 'AbortError') {
        showToast('Download timed out', 'The download took too long. Try narrowing your query with a LIMIT or more specific filters.', { variant: 'danger' });
      } else {
        const { friendly } = classifyError(error, 'select');
        showToast('Download failed', friendly, { variant: 'danger' });
      }
    }
  }

  /**
   * Map a SPARQL result MIME type to a file extension.
   * @param {string} format
   * @returns {string}
   * @private
   */
  static _extensionFor(format) {
    const map = {
      'application/sparql-results+json': '.json',
      'application/sparql-results+xml': '.xml',
      'application/vnd.ms-excel': '.xls',
      'text/csv': '.csv',
      'text/tab-separated-values': '.tsv',
    };
    return map[format] || '.txt';
  }
}