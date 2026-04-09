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
// RDF namespace map and URI shortening helpers.
//
// `ns` maps common prefixes to their full base URIs and is used both as a
// vocabulary and as an input to the label service to decide which URIs to
// request labels for.

const ns = {
  schema:    'http://schema.org/',
  rdf:       'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  xsd:       'http://www.w3.org/2001/XMLSchema#',
  rdfs:      'http://www.w3.org/2000/01/rdf-schema#',
  owl:       'http://www.w3.org/2002/07/owl#',
  skos:      'http://www.w3.org/2004/02/skos/core#',
  dcterms:   'http://purl.org/dc/terms/',
  dct:       'http://purl.org/dc/terms/',
  foaf:      'http://xmlns.com/foaf/0.1/',
  m8g:       'http://data.europa.eu/m8g/',
  sfrml:     'http://data.europa.eu/a4g/mapping/sf-rml/',
  epo:       'http://data.europa.eu/a4g/ontology#',
  eli:       'http://data.europa.eu/eli/ontology#',
  time:      'http://www.w3.org/2006/time#',
  person:    'http://www.w3.org/ns/person#',
  locn:      'http://www.w3.org/ns/locn#',
  shacl:     'http://www.w3.org/ns/shacl#',
  org:       'http://www.w3.org/ns/org#',
  adms:      'http://www.w3.org/ns/adms#',
  rml:       'http://semweb.mmlab.be/ns/rml#',
  r2rml:     'http://www.w3.org/ns/r2rml#',
  sh:        'http://www.w3.org/ns/shacl#',
  euvoc:     'http://publications.europa.eu/ontology/euvoc#',
  epo_shape: 'http://data.europa.eu/a4g/data-shape#',
};

// ePO resource URIs follow the pattern:
//   http://data.europa.eu/a4g/resource/id_{uuid}_{Type}_{identifier}
// We strip the "base + uuid_" prefix to get a compact "Type identifier" label.
const EPO_RESOURCE_PREFIX = 'http://data.europa.eu/a4g/resource/id_';

// Shrink a full URI to prefix:localname if it matches a known namespace,
// otherwise return it unchanged.
function shrink(uri) {
  for (const [prefix, base] of Object.entries(ns)) {
    if (uri.startsWith(base)) {
      return `${prefix}:${uri.slice(base.length)}`;
    }
  }
  return uri;
}

// Return { prefix, localName } for a URI, or null if no namespace matches.
function resolvePrefix(uri) {
  for (const [prefix, base] of Object.entries(ns)) {
    if (uri.startsWith(base)) {
      return { prefix, localName: uri.slice(base.length) };
    }
  }
  return null;
}

// Short human-readable label for any URI.
// - ePO resource: "Type identifier" (prefix and UUID stripped)
// - Known namespace: "prefix:localname"
// - Anything else: the URI unchanged
function shortLabel(uri) {
  if (uri.startsWith(EPO_RESOURCE_PREFIX)) {
    return _shortenEpoResource(uri.slice(EPO_RESOURCE_PREFIX.length));
  }
  const resolved = resolvePrefix(uri);
  if (resolved) return `${resolved.prefix}:${resolved.localName}`;
  return uri;
}

// Input: "{uuid}_{Type}_{identifier}". Output: "Type identifier".
function _shortenEpoResource(uuidAndRest) {
  const uuidEnd = uuidAndRest.indexOf('_');
  if (uuidEnd === -1) return uuidAndRest;

  const typeAndId = uuidAndRest.slice(uuidEnd + 1);
  const firstUnderscore = typeAndId.indexOf('_');
  if (firstUnderscore === -1) return typeAndId;

  // Replace the first underscore with a space for readability.
  return typeAndId.slice(0, firstUnderscore) + ' ' + typeAndId.slice(firstUnderscore + 1);
}

export { ns, resolvePrefix, shortLabel, shrink };
