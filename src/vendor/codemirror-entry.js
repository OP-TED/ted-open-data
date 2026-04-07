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

// Entry point for bundling CodeMirror v6 and all extensions.
// Run: npm run build:codemirror

// Core
export {EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
        drawSelection, dropCursor, rectangularSelection, crosshairCursor,
        highlightSpecialChars, placeholder, keymap} from '@codemirror/view';
export {EditorState} from '@codemirror/state';

// Commands
export {history, defaultKeymap, historyKeymap} from '@codemirror/commands';

// Language
export {bracketMatching, foldGutter, foldKeymap, indentOnInput,
        syntaxHighlighting, defaultHighlightStyle, HighlightStyle} from '@codemirror/language';

// Autocomplete
export {autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap} from '@codemirror/autocomplete';

// Search
export {searchKeymap, highlightSelectionMatches} from '@codemirror/search';

// Lint
export {linter, lintGutter, lintKeymap} from '@codemirror/lint';

// SPARQL language
export {sparql} from 'codemirror-lang-sparql';

// Turtle language (for the Explore tab's Turtle view mode)
export {turtle} from 'codemirror-lang-turtle';

// Lezer highlight (for theme)
export {tags} from '@lezer/highlight';
