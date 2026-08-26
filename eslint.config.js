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
// What the linter is asked to catch.
//
// The recommended set only, which is the part of ESLint that finds mistakes
// rather than opinions: a variable that is never read, a case that falls
// through, a regular expression with a typo in it. Formatting is left
// alone — this codebase is consistent already, and a linter that argues
// about spacing is one people learn to ignore.
//
// The application runs in a browser and the tests and build scripts run in
// node, so each is told which globals it may name. Anything not declared
// there is a mistake worth hearing about.

import js from '@eslint/js';
import globals from 'globals';

/**
 * Libraries the page loads from a CDN into the global scope, so no module
 * imports them and nothing else would tell the linter they exist.
 */
const FROM_A_SCRIPT_TAG = {
  bootstrap: 'readonly',
  Chart: 'readonly',
  echarts: 'readonly',
  N3: 'readonly',
};

export default [
  {
    // Generated: 450kb of someone else's code. Its entry point next to it
    // is ours, and is linted.
    ignores: ['src/vendor/codemirror-bundle.js'],
  },
  js.configs.recommended,
  {
    rules: {
      // A leading underscore is how this codebase says an argument is
      // there to satisfy a signature and is not meant to be read. It says
      // no such thing about a variable — `_isSafeUri` is a private helper,
      // not a spare one — so only arguments and caught errors are spared.
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        // `const { secret, ...rest } = o` names a field in order to leave
        // it behind. That naming is the point, not an oversight.
        ignoreRestSiblings: true,
      }],
      // Two more that find mistakes rather than express taste. Both are in
      // the recommended set of the next major, which is fair evidence they
      // are not opinions; naming them here keeps this config's floor at
      // the Node version the rest of the project already asks for.
      'no-useless-assignment': 'error',
      'preserve-caught-error': 'error',
    },
  },
  {
    // The application: ES modules in a browser, with the libraries it
    // loads from a <script> tag rather than an import.
    files: ['src/js/**/*.js', 'src/vendor/codemirror-entry.js'],
    // The worker below runs in a thread of its own, with no page around it.
    ignores: ['src/js/sparqlWorker.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...FROM_A_SCRIPT_TAG },
    },
  },
  {
    // A Web Worker has no window and no document. Handing it the page's
    // globals would let a reach for one of them pass here and fail in the
    // browser, which is the opposite of what this is for.
    files: ['src/js/sparqlWorker.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.worker,
    },
  },
  {
    // Tests and build scripts: ES modules in node. The tests of the ported
    // explorer modules reach for browser globals too, which `_helpers.js`
    // stands up on globalThis before they run.
    files: ['test/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser, ...FROM_A_SCRIPT_TAG },
    },
  },
  {
    // The two files that are still CommonJS: the dev proxy and the bundler.
    files: ['**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
];
