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
// Guided tour for the Customize tab (Query Editor).

import { startTour } from './tour.js';

export async function startCustomizeTour() {
  startTour([
    {
      element: '#query',
      title: 'SPARQL editor',
      content:
        'A full-featured SPARQL editor with syntax highlighting, bracket matching, line ' +
        'numbers, and autocomplete for the eProcurement Ontology. Write a query from scratch ' +
        'or tweak one you loaded from the library.',
      placement: 'top',
    },
    {
      element: '#copy-editor-sparql',
      title: 'Copy and Clear',
      content:
        'Use <strong>Copy</strong> to copy your query to the clipboard, or ' +
        '<strong>Clear</strong> to empty the editor (with confirmation).',
      placement: 'bottom',
    },
    {
      element: '#options-button',
      title: 'Options',
      content:
        'Click to expand the options panel. Fine-tune how the endpoint executes your query: ' +
        'set a <strong>timeout</strong>, toggle strict checking of void variables, or ask the ' +
        'server for debug output and a compilation report.',
      placement: 'bottom',
    },
    {
      element: '#run-query-button-top',
      title: 'Run your query',
      content:
        'Click to send the query to the endpoint. The results appear on the ' +
        '<strong>Reuse</strong> tab — as a sortable table for SELECT queries, or as an ' +
        'interactive knowledge graph for CONSTRUCT and DESCRIBE.',
      placement: 'bottom',
    },
    {
      title: 'New to SPARQL?',
      content:
        'The fastest way to get started is to pick a query from the <strong>Explore</strong> ' +
        'tab and click <strong>Customise</strong> — it drops the query straight into this ' +
        'editor, ready for you to adapt to your own needs.',
    },
  ]);
}
