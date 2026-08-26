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
// What to call a resource, given the types it declares.
//
// The name shown for a resource used to be cut out of its URI, which carries a
// class name chosen by the RML mapping rather than by the ontology — a
// contract appeared as "SettledContract", which ePO calls "Contract" (issue
// #74). The name is taken from rdf:type instead.
//
// A resource commonly declares several types. Which of them is the most
// specific is decided from the ontology's rdfs:subClassOf statements, not by
// preferring a shape or a length: epo:Business wins over org:Organization
// because ePO states that Business is a subclass of Organization. Where the
// ontology states no relationship between two declared types, neither is more
// specific and both are shown.

const localName = (iri) => String(iri).split(/[#/]/).pop();

/**
 * Whether `ancestor` is reachable from `descendant` by following superclass
 * statements. Cycles in the data cannot loop this: every class is visited at
 * most once.
 */
function isSuperclassOf(ancestor, descendant, hierarchy, visited = new Set()) {
  for (const parent of hierarchy[descendant] || []) {
    if (parent === ancestor) return true;
    if (visited.has(parent)) continue;
    visited.add(parent);
    if (isSuperclassOf(ancestor, parent, hierarchy, visited)) return true;
  }
  return false;
}

/**
 * The declared types that no other declared type specialises.
 *
 * Usually one. Two unrelated classes both survive, because the ontology gives
 * no grounds to rank them and inventing grounds is what this exists to avoid.
 *
 * @param {string[]} typeIris - Class IRIs the resource declares.
 * @param {object} hierarchy - Superclasses by class IRI, from the ontology.
 * @returns {string[]} A subset of typeIris, in their original order.
 */
export function mostSpecificTypes(typeIris, hierarchy = {}) {
  const types = [...new Set((typeIris || []).filter(Boolean))];
  if (types.length < 2) return types;

  return types.filter(
    candidate => !types.some(other => other !== candidate && isSuperclassOf(candidate, other, hierarchy)),
  );
}

/**
 * What to display for a resource declaring these types, or null when it
 * declares none and the application therefore has nothing to say about it.
 *
 * Local names only. The badge this feeds sits directly above a `type` row
 * showing the same class in full, so repeating the vocabulary here would
 * duplicate what is already on screen.
 *
 * @param {string[]} typeIris - Class IRIs the resource declares.
 * @param {object} hierarchy - Superclasses by class IRI, from the ontology.
 * @returns {string|null}
 */
export function resourceTypeName(typeIris, hierarchy = {}) {
  const specific = mostSpecificTypes(typeIris, hierarchy);
  return specific.length ? specific.map(localName).join(', ') : null;
}
