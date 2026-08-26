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

/**
 * Reconstruct the route the user walked through the graph, from the
 * breadcrumb, for the Path row on the SPARQL reference card (issue #73).
 *
 * Every tree click records on its facet the predicates it traversed
 * (`viaPath`), the root subject that walk started from (`viaRoot`), and the
 * pattern binding that root (`viaRootPattern`) — see TermRenderer.
 *
 * Those hops may only be concatenated when they genuinely join up: hop N has
 * to start at the subject hop N-1 landed on. Two situations break that:
 *
 *   - a graph can render several root cards, and a chain walked beneath one
 *     of them says nothing about the others;
 *   - a lateral jump (the procedure timeline) replaces the breadcrumb entry
 *     with one carrying no chain at all.
 *
 * Concatenating regardless would produce a pattern that parses cleanly and
 * asserts a relationship the data never had — the worst kind of wrong, since
 * nothing downstream can detect it. So a broken join yields no chain, and the
 * card falls back to binding the resource by its own type.
 *
 * @param {Array<object>} breadcrumb - Facets, oldest first. Entry 0 is the search that started it.
 * @param {number} breadcrumbIndex - Position currently displayed; forward history beyond it is ignored.
 * @returns {{chain: string[], anchor: string|null}} Predicate URIs walked, and the pattern they hang off.
 */
export function navigationPath(breadcrumb, breadcrumbIndex) {
  const crumbs = Array.isArray(breadcrumb) ? breadcrumb : [];
  const walked = crumbs.slice(1, breadcrumbIndex + 1);

  const chain = [];
  let anchor = null;
  let expectedRoot = null;

  for (const facet of walked) {
    if (!isWalkedHop(facet)) return noPath();
    if (expectedRoot !== null && facet.viaRoot !== expectedRoot) return noPath();

    if (anchor === null) anchor = facet.viaRootPattern;
    chain.push(...facet.viaPath);
    expectedRoot = facet.term?.value ?? null;
  }

  return anchor ? { chain, anchor } : noPath();
}

// A fresh object each time rather than a shared constant: freezing the outer
// object would still leave one mutable `chain` array shared by every caller.
function noPath() {
  return { chain: [], anchor: null };
}

/**
 * Whether a breadcrumb entry carries a usable record of how it was reached.
 *
 * The shapes are checked rather than assumed. A facet is a plain object that
 * has been through validateFacet(), which spreads unknown fields without
 * inspecting them — so a `viaPath` that is a string rather than an array would
 * spread into its individual characters and yield a path of single letters,
 * and a non-string `viaRootPattern` would throw when the pattern is assembled.
 * Neither can happen from this app's own writes, but nothing here should
 * depend on that: the cost of checking is a few comparisons, and the failure
 * mode without it is a plausible-looking query built from nonsense.
 */
function isWalkedHop(facet) {
  if (!facet || typeof facet !== 'object') return false;
  if (!isNonEmptyString(facet.viaRoot)) return false;
  if (!isNonEmptyString(facet.viaRootPattern)) return false;
  return Array.isArray(facet.viaPath)
    && facet.viaPath.length > 0
    && facet.viaPath.every(isNonEmptyString);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}
