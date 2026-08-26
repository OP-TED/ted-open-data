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
// Loads src/assets/epo-terms.json, the generated view of the ePO ontology.
//
// Two features read it — the editor's autocomplete and linter, and the tree's
// type naming — so the fetch lives here rather than inside either of them.
// Loading is lazy and happens once; callers that need the data before it
// arrives await ensureOntologyData(), callers that can do without it read
// getOntologyData() and cope with null.
//
// The file is produced by scripts/extract-epo-terms.js and
// scripts/merge-epo-terms.js from the ontology's Turtle sources.

const ONTOLOGY_URL = 'src/assets/epo-terms.json';

let data = null;
let loading = null;

/**
 * Load the ontology data, or return it if already loaded. A failed load is
 * not cached, so a later call retries.
 *
 * @returns {Promise<object|null>}
 */
export async function ensureOntologyData() {
  if (data) return data;
  if (loading) return loading;

  loading = fetch(ONTOLOGY_URL)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(loaded => { data = loaded; return data; })
    .catch(err => {
      console.error('[ontologyData] Failed to load ePO terms:', err);
      loading = null;
      return null;
    });

  return loading;
}

/** The loaded data, or null if it has not arrived yet. */
export function getOntologyData() {
  return data;
}

/** Direct superclasses by class IRI, or an empty map if not loaded. */
export function getClassHierarchy() {
  return data?.subClassOf ?? {};
}

// Test seam: lets a test supply the data without a network call.
export function __setOntologyDataForTesting(value) {
  data = value;
  loading = null;
}
