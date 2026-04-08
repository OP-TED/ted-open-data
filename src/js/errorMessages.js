/*
 * Copyright 2026 European Union
 *
 * Licensed under the EUPL, Version 1.2 or - as soon they will be approved by the European
 * Commission - subsequent versions of the EUPL (the "Licence"); You may not use this work except in
 * compliance with the Licence. You may obtain a copy of the Licence at:
 * https://joinup.ec.europa.eu/software/page/eupl
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the Licence
 * is distributed on an "AS IS" basis, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the Licence for the specific language governing permissions and limitations under
 * the Licence.
 */
// Shared error-message classifier used by both lanes of the Data tab.
// Both QueryEditor (SELECT lane) and DataView (graph lane) turn the raw
// error they catch into a structured pair for the friendly error
// state. Having it in one place means both lanes present errors with
// the same vocabulary and the same fallback behaviour.
//
// Inputs:
//   error  — the caught Error (may carry a .serverMessage)
//   lane   — 'select' | 'graph', because a few kinds (notably 504)
//            warrant different copy per lane — a timeout in a
//            SELECT is "simplify / use externally"; a timeout in a
//            graph CONSTRUCT is "the endpoint is slow, try again".
//
// Output:
//   {
//     friendly: string,                // user-safe sentence
//     detail:   string | null,         // optional technical block
//     action:   { label, kind } | null // optional inline recovery
//   }
// `action.kind` is a symbol the renderer interprets. For now the only
// kind is 'copy-select-url'; others can be added without changing
// the signature.

export function classifyError(error, lane = 'select') {
  if (!error) {
    return { friendly: 'The query could not be completed.', detail: null, action: null };
  }

  const raw = error.message || '';
  const serverMessage = error.serverMessage || null;

  // User cancellation — not really an error, but the catch branch may
  // still land here.
  if (error.name === 'AbortError' || /cancell?ed/i.test(raw)) {
    return { friendly: 'Query cancelled.', detail: null, action: null };
  }

  // 400 Bad Request — SPARQL parser / semantic error. The server's own
  // message usually includes line/column information that's useful to
  // surface.
  if (raw.includes('Status: 400') || raw.includes('400')) {
    return {
      friendly: 'The SPARQL endpoint could not process your query. Please check your query syntax, prefixes, and property names.',
      detail: serverMessage || _extractVirtuoso(raw),
      action: null,
    };
  }

  // 500 Internal Server Error — Virtuoso itself gave up. The detail is
  // rarely actionable for the user but helps when filing a bug.
  if (raw.includes('Status: 500') || raw.includes('500')) {
    return {
      friendly: 'The SPARQL endpoint encountered an internal error. The query may be too complex or the server may be temporarily unavailable.',
      detail: serverMessage || _extractVirtuoso(raw),
      action: null,
    };
  }

  // 504 Gateway Timeout — the query took longer than the endpoint's
  // allowed execution budget. Per-lane copy:
  //   SELECT → honest, with a recovery link: the query is fine,
  //            copy the URL to use it from a tool that handles long
  //            requests (curl, Python, Excel's Get Data...).
  //   GRAPH  → the user can't "simplify" a canned CONSTRUCT for a
  //            notice; the honest advice is "try again".
  if (raw.includes('Status: 504') || raw.includes('504') || /timeout/i.test(raw)) {
    if (lane === 'graph') {
      return {
        friendly: 'The query took too long to complete. The endpoint may be under load — please try again in a moment.',
        detail: null,
        action: null,
      };
    }
    return {
      friendly: 'The query timed out.',
      detail: null,
      action: { label: 'copy the query URL', kind: 'copy-select-url' },
    };
  }

  // Network failure — fetch threw before the endpoint answered at all.
  // Chrome surfaces this as TypeError "Failed to fetch" in the main
  // thread, but worker-relayed errors arrive as plain Error because
  // the worker postMessages only the message string. Matching on the
  // message substring catches both cases.
  if (/Failed to fetch|NetworkError|ERR_NETWORK|ECONNRESET|socket hang up/i.test(raw)) {
    return {
      friendly: 'Could not reach the SPARQL endpoint. Please check your internet connection and try again.',
      detail: null,
      action: null,
    };
  }

  // Unknown — show the raw message as the friendly line and skip
  // the detail slot so we don't duplicate.
  return {
    friendly: raw || 'The query could not be completed.',
    detail: null,
    action: null,
  };
}

/**
 * Pull a Virtuoso-shaped server error out of a generic error message
 * (e.g. "HTTP error. Status: 400\nVirtuoso 37000 Error SP030: …").
 * Returns null if there's no recognisable Virtuoso block.
 * @private
 */
function _extractVirtuoso(raw) {
  const m = raw.match(/Virtuoso\s+\d+\s+Error[\s\S]*/);
  return m ? m[0].trim() : null;
}
