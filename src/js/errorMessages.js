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
// Shared error-message classifier used by both lanes of the Reuse tab.
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
  const status = _extractStatus(raw);

  // User cancellation — not really an error, but the catch branch may
  // still land here.
  if (error.name === 'AbortError' || /cancell?ed/i.test(raw)) {
    return { friendly: 'Query cancelled.', detail: null, action: null };
  }

  // Timeout — check before the generic 5xx branch, because a Virtuoso
  // 500 response body can contain the word "timeout" ("Transaction
  // timed out", "anytime query timeout") and would otherwise be
  // misclassified as a generic internal error.
  //
  // Per-lane copy:
  //   SELECT → honest, with a recovery link: the query is fine,
  //            copy the URL to use it from a tool that handles long
  //            requests (curl, Python, Excel's Get Data...).
  //   GRAPH  → the user can't "simplify" a canned CONSTRUCT for a
  //            notice; the honest advice is "try again".
  //
  // Status 524 is Cloudflare's "A timeout occurred" and is handled
  // here rather than with the generic 5xx branch. The regex covers
  // both "timeout" (Virtuoso's "anytime query timeout") and "timed out"
  // (Virtuoso's "Transaction timed out") so a 500 body containing
  // either flavour is correctly re-routed to the timeout branch.
  if (status === 504 || status === 524 || /time\s*(?:d\s+)?out/i.test(raw)) {
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

  // 400 Bad Request — SPARQL parser / semantic error. The server's own
  // message usually includes line/column information that's useful to
  // surface.
  if (status === 400) {
    return {
      friendly: 'The SPARQL endpoint could not process your query. Please check your query syntax, prefixes, and property names.',
      detail: serverMessage || _extractServerDetail(raw),
      action: null,
    };
  }

  // 413 Payload Too Large — long queries sent via GET overflow the
  // endpoint's URL limit; suggest the obvious workaround rather than
  // the generic "syntax" hint for 400.
  if (status === 413) {
    return {
      friendly: 'The query is too large to send. Try shortening it or splitting it into smaller queries.',
      detail: serverMessage || _extractServerDetail(raw),
      action: null,
    };
  }

  // 500-class — 500, 502, 503 all mean "the endpoint can't answer right
  // now". 500 is usually Virtuoso itself giving up; 502/503 are
  // reverse-proxy / load-balancer layers above it (nginx "Bad Gateway",
  // Cloudflare "Service Unavailable"). Collapse into one friendly
  // message because the distinction isn't actionable for the user.
  if (status === 500 || status === 502 || status === 503) {
    return {
      friendly: 'The SPARQL endpoint encountered an internal error. The query may be too complex or the server may be temporarily unavailable.',
      detail: serverMessage || _extractServerDetail(raw),
      action: null,
    };
  }

  // Network failure — fetch threw before the endpoint answered at all.
  // Chrome surfaces this as TypeError "Failed to fetch" in the main
  // thread, but worker-relayed errors arrive as plain Error because
  // the worker postMessages only the message string. The alternation
  // below covers browser wording (Failed to fetch, NetworkError,
  // ERR_*) and common Node-side socket / DNS / TLS errors that can
  // reach the classifier via tests or a proxy-layer relay.
  if (/Failed to fetch|NetworkError|ERR_NETWORK|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|certificate/i.test(raw)) {
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
 * Parse the HTTP status code out of a raw error message that follows
 * the sparqlWorker convention `"HTTP error. Status: <n>\n<body>"`.
 * Returns the status as a number, or null when no status prefix is
 * present. This is deliberately strict: it only matches the explicit
 * `Status: NNN` prefix produced by the worker, never bare digit
 * substrings, because bare-match collides with timestamps, millisecond
 * values, literal digits inside a query, port numbers in URLs, and
 * cross-status matches like "504" being a substring of "5040".
 * @private
 */
function _extractStatus(raw) {
  const m = raw.match(/Status:\s*(\d{3})\b/);
  return m ? Number(m[1]) : null;
}

/**
 * Pull a readable server-side error block out of a raw error message.
 * Prefers a Virtuoso-shaped block when present (the EU endpoint's
 * canonical format), and falls back to the body that follows the
 * `HTTP error. Status: NNN` prefix so non-Virtuoso backends
 * (Fuseki, Blazegraph, GraphDB) still surface useful detail instead
 * of disappearing.
 * @private
 */
function _extractServerDetail(raw) {
  const virtuoso = raw.match(/Virtuoso\s+\d+\s+Error[\s\S]*/);
  if (virtuoso) return virtuoso[0].trim();

  // Strip the "HTTP error. Status: NNN" prefix (optionally followed by
  // a newline) and return whatever remains, if anything.
  const stripped = raw.replace(/^HTTP error\.\s*Status:\s*\d+\s*\n?/, '').trim();
  return stripped || null;
}
