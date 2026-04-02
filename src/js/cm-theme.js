/*
 * Copyright 2026 European Union
 *
 * Licensed under the EUPL, Version 1.2 or – as soon they will be approved by the European
 * Commission – subsequent versions of the EUPL (the "Licence"); You may not use this work except in
 * compliance with the Licence. You may obtain a copy of the Licence at:
 * https://joinup.ec.europa.eu/software/page/eupl
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the Licence
 * is distributed on an "AS IS" basis, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the Licence for the specific language governing permissions and limitations under
 * the Lic
 */

import {EditorView, HighlightStyle, syntaxHighlighting, tags} from '../vendor/codemirror-bundle.js';

/**
 * Eclipse-like light theme for the editor chrome (gutters, background, cursor, selection).
 */
export const eclipseTheme = EditorView.theme({
  "&": { backgroundColor: "#fff" },
  ".cm-gutters": { backgroundColor: "#f7f7f7", borderRight: "1px solid #ddd", color: "#999" },
  ".cm-activeLineGutter": { backgroundColor: "#e8f2ff" },
  ".cm-activeLine": { backgroundColor: "#e8f2ff33" },
  ".cm-cursor": { borderLeftColor: "#000" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "#d7d4f0" },
});

/**
 * Eclipse-like syntax highlighting colors.
 */
export const eclipseHighlightStyle = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.keyword, color: "#7f0055", fontWeight: "bold" },
  { tag: tags.variableName, color: "#0000c0" },
  { tag: tags.string, color: "#2a00ff" },
  { tag: tags.comment, color: "#3f7f5f" },
  { tag: tags.number, color: "#164" },
  { tag: tags.typeName, color: "#7f0055" },
  { tag: tags.propertyName, color: "#0000c0" },
  { tag: tags.operator, color: "#000" },
  { tag: tags.punctuation, color: "#000" },
  { tag: tags.bracket, color: "#000" },
]));
