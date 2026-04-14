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
// Re-serialise parsed RDF quads as Turtle with meaningful prefixes.
//
// Virtuoso's Turtle output uses auto-generated prefixes (ns1:, ns2:, ...).
// This function re-serialises the quads through N3.Writer with the app's
// known prefix map so the Turtle view and downloads show epo:, rdf:, etc.

import { ns } from './namespaces.js';

/**
 * Re-serialise quads as Turtle with known prefixes.
 * Falls back to the original Turtle string on any error.
 *
 * @param {Array} quads - Parsed N3 quads
 * @param {string} fallback - Original Turtle string to return on failure
 * @returns {string} Turtle string with meaningful prefixes
 */
export function prettifyTurtle(quads, fallback) {
  try {
    const writer = new N3.Writer({ prefixes: { ...ns } });
    writer.addQuads(quads);
    let result = fallback;
    writer.end((error, output) => {
      if (!error) result = output;
    });
    return result;
  } catch {
    return fallback;
  }
}
