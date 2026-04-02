#!/usr/bin/env node
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
const { execSync } = require('child_process');

execSync(
  'npx esbuild src/vendor/codemirror-entry.js' +
  ' --bundle --format=esm --minify' +
  ' --outfile=src/vendor/codemirror-bundle.js' +
  ' --banner:js="/* CodeMirror v6 bundle (includes transitive dependencies). All packages are MIT licensed. */"',
  { stdio: 'inherit' }
);
