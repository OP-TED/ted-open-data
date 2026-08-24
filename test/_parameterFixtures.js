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
// Shared ground for the parameter tests.
//
// The queries here are parsed by the same SPARQL grammar the editor uses,
// so what the tests exercise is what the application sees.

import { EditorState } from '@codemirror/state';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { sparql } from 'codemirror-lang-sparql';

import { queryParameters } from '../src/js/utils/queryParameters.js';
import { fillQuery } from '../src/js/utils/parameterValues.js';

export const PROLOGUE = 'PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>\n';

/** A query with the prologue these tests would otherwise all repeat. */
export const query = (body) => `${PROLOGUE}SELECT * WHERE { ${body} ?s ?p ?o }`;

/** The parameters of a query, as the application reads them. */
export function parametersOf(text) {
  const state = EditorState.create({ doc: text, extensions: [sparql()] });
  const tree = ensureSyntaxTree(state, state.doc.length, 5000) || syntaxTree(state);
  return queryParameters(tree, state.doc);
}

/** Label, kind and value of every slot, for the many cases about shape alone. */
export const shapeOf = (text) => parametersOf(text).map(parameter => ({
  label: parameter.label,
  slots: parameter.slots.map(slot => `${slot.kind}${slot.bound ? `/${slot.bound}${slot.inclusive ? '=' : ''}` : ''}=${slot.value}`),
}));

/** A query filled from a list of values per parameter, in slot order. */
export function filled(text, valuesPerParameter) {
  const parameters = parametersOf(text);
  const values = new Map();
  parameters.forEach((parameter, i) => parameter.slots.forEach((slot, j) => {
    const value = valuesPerParameter[i]?.[j];
    if (value !== undefined) values.set(slot, value);
  }));
  return fillQuery(text, parameters, values);
}
