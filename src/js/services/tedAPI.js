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
// TED API client for notice and procedure metadata.
//
// The TED search API returns JSON. This module exposes thin wrappers that
// build the request payload and shape the response into the fields the rest
// of the app expects. The actual fetch() is done by the caller so error
// handling and loading state stay in one place.

import { normalize } from '../facets.js';

// Always use the acceptance TED API. The production API
// (api.ted.europa.eu) does NOT include CORS headers for our deploy
// origin (docs.ted.europa.eu), so calling it from a browser-based app
// fails with a preflight error and the procedure timeline does not
// load. The acceptance API (api.acceptance.ted.europa.eu) does allow
// the cross-origin request and is what version 1.0.0 of this app used
// in production unconditionally.
//
// This restores parity with 1.0.0. A request has been filed with the
// TED API admins to enable CORS for docs.ted.europa.eu on the
// production API; once that lands, this can be flipped back to a
// per-host switch (see CORS_REQUEST.md at the repo root for the
// outgoing request and the conditions for re-enabling the switch).
const TED_API = 'https://api.acceptance.ted.europa.eu/v3';

function getTedApi() {
  return TED_API;
}
const PROCEDURE_NOTICE_LIMIT = 249;
const NOTICE_LOOKUP_LIMIT = 10;

// Fields returned per notice when listing the notices of a procedure.
const PROCEDURE_FIELDS = [
  'notice-type',
  'publication-date',
  'notice-version',
  'form-type',
  'publication-number',
  'links',
  'official-language',
  'customization-id',
  'buyer-country',
];

// Fields returned when looking up a single notice by publication number.
const NOTICE_LOOKUP_FIELDS = [
  'publication-number',
  'publication-date',
  'buyer-country',
  'customization-id',
  'procedure-identifier',
  'official-language',
  'notice-type',
  'form-type',
];

// Build a { url, options } pair for searching all notices of a procedure.
function getRequest(procedureId) {
  return _buildRequest({
    query: `procedure-identifier="${procedureId}"`,
    fields: PROCEDURE_FIELDS,
    limit: PROCEDURE_NOTICE_LIMIT,
  });
}

// Build a { url, options } pair for looking up a notice by publication number.
function getNoticeByPublicationNumber(publicationNumber) {
  return _buildRequest({
    query: `publication-number="${publicationNumber}"`,
    fields: NOTICE_LOOKUP_FIELDS,
    limit: NOTICE_LOOKUP_LIMIT,
  });
}

function _buildRequest({ query, fields, limit }) {
  return {
    url: `${getTedApi()}/notices/search`,
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ query, scope: 'ALL', fields, limit }),
    },
  };
}

// Map a raw TED notices-search response into the flat notice objects
// used by NoticeView. Sorted oldest first so the procedure timeline
// reads left-to-right in chronological order. Ties on date — common
// when several amendments are issued the same day — are broken by
// notice version, so v1 always sits before v2 sits before v3.
function mapResponse(tedResponse) {
  const raw = tedResponse?.notices;
  if (raw != null && !Array.isArray(raw)) {
    console.warn('[tedAPI] schema drift: `notices` field is not an array; ignoring response.', raw);
    return [];
  }
  const notices = (raw || []).map(_mapNotice);
  notices.sort((a, b) => {
    const ka = _dateSortKey(a.publicationDate);
    const kb = _dateSortKey(b.publicationDate);
    if (ka !== null && kb !== null && ka !== kb) return ka - kb;
    return (Number(a.noticeVersion) || 0) - (Number(b.noticeVersion) || 0);
  });
  return notices;
}

// TED dates look like "2024-03-28+01:00" (no T separator), which is not a
// valid Date() input. Strip everything after the YYYY-MM-DD prefix and
// build a UTC timestamp — good enough for ordering, immune to TZ skew.
// Returns null for malformed input or out-of-range numeric components so
// "99999-99-99" doesn't slip through and produce a silently nonsense key.
function _dateSortKey(dateStr) {
  if (typeof dateStr !== 'string') return null;
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Date.UTC(year, month - 1, day);
}

function _mapNotice(notice) {
  return {
    pdf: _pickLinkByLanguage(notice.links?.pdf),
    xml: notice.links?.xml?.MUL,
    html: _pickLinkByLanguage(notice.links?.html),
    noticeVersion: notice['notice-version'],
    publicationNumber: _normalizePublicationNumber(notice['publication-number']),
    publicationDate: notice['publication-date'],
    // Missing notice-type/form-type are genuinely unknown; leave them null
    // rather than fabricating a synthetic `{value:'Unknown'}` object that
    // downstream code would render as if it were real data.
    noticeType: _extractCodedValue(notice['notice-type']),
    formType: _extractCodedValue(notice['form-type']),
    officialLanguage: notice['official-language'] || null,
    customizationId: notice['customization-id'] || null,
    buyerCountry: _normalizeBuyerCountry(notice['buyer-country']),
  };
}

// The TED API mostly returns well-formed publication numbers
// (e.g. "572066-2024"), but if the schema ever drifts we log once
// per session and fall back to the raw value so one bad notice
// doesn't crash the whole timeline.
let _publicationNumberDriftLogged = false;
function _normalizePublicationNumber(raw) {
  const normalized = normalize(raw);
  if (normalized) return normalized;
  if (raw && !_publicationNumberDriftLogged) {
    console.warn('[tedAPI] schema drift: unexpected publication-number shape — first occurrence:', raw);
    _publicationNumberDriftLogged = true;
  }
  return raw || null;
}

// TED "coded value" fields (notice-type, form-type) sometimes come back as
// {value: 'xxx'} objects and sometimes as bare strings depending on the
// endpoint. Normalise to `string | null` at the boundary so the rest of
// the codebase never has to duck-type.
function _extractCodedValue(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw || null;
  if (typeof raw === 'object' && typeof raw.value === 'string') return raw.value || null;
  return null;
}

// buyer-country comes back from the TED API as an array of ISO codes
// (`["ITA"]`, sometimes multiple). Earlier code left it as an array, which
// stringified as `"ITA,FRA"` by accident. Normalise to a single string so
// every consumer (timeline, history dropdown, sessionStorage) agrees on
// the shape.
function _normalizeBuyerCountry(raw) {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw.length ? raw.join(', ') : null;
  if (typeof raw === 'object' && typeof raw.value === 'string') return raw.value || null;
  if (typeof raw === 'string') return raw || null;
  return null;
}

// Prefer English, then French, then whatever is available.
function _pickLinkByLanguage(linksByLang) {
  if (!linksByLang) return null;
  return linksByLang.ENG || linksByLang.FRA || Object.values(linksByLang)[0] || null;
}

// Extract the set of procedure IDs referenced by the notices in a response.
// If the response carries notices but none of them have a procedure-id we
// log a warning — that's a real schema-drift signal worth seeing in the
// console, distinct from "the response had zero notices".
function extractProcedureIds(tedResponse) {
  const notices = tedResponse?.notices;
  if (!Array.isArray(notices) || notices.length === 0) return [];

  const ids = new Set();
  for (const notice of notices) {
    // `procedure-identifier` is normally a bare string, but other
    // coded fields (notice-type, form-type) come back as either
    // string or `{value: string}` depending on the endpoint. Route
    // through the same normaliser so a schema shift to the object
    // shape cannot silently produce `[object Object]` entries here.
    const id = _extractCodedValue(notice['procedure-identifier']);
    if (id) ids.add(id);
  }
  if (ids.size === 0) {
    console.warn(
      '[tedAPI] schema drift: notices response had no procedure-identifier fields — possible breaking change upstream.',
      notices,
    );
  }
  return Array.from(ids);
}

export {
  extractProcedureIds,
  getNoticeByPublicationNumber,
  getRequest,
  mapResponse,
};
