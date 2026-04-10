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
// Guided tour for the Reuse tab — graph lane — 5 steps.
// No priming needed — the trigger only exists when a graph is loaded.

import { startTour } from './tour.js';

export function startReuseGraphTour() {
  startTour([
    {
      element: '#data-breadcrumb',
      title: 'Where you are',
      content:
        'The breadcrumb trail shows the path you have taken through the graph. Click any step ' +
        'to jump back to an earlier resource.',
      placement: 'bottom',
    },
    {
      element: '#data-view-mode-toggle',
      title: 'Three ways to look at the same data',
      content:
        '<strong>Tree</strong> presents the graph as a clickable outline. ' +
        '<strong>Turtle</strong> shows the raw RDF serialisation, for when you want to read ' +
        'the underlying statements. <strong>Backlinks</strong> lists the other resources in ' +
        'the dataset that reference the one you are currently looking at.',
      placement: 'bottom',
    },
    {
      element: '#data-share-btn',
      title: 'Share this view',
      content:
        'Copies a URL that reproduces exactly what you are looking at right now — the same ' +
        'resource, the same view mode, the same breadcrumb. Save it for later or send it to ' +
        'a colleague; when they open it, they will see what you see.',
      placement: 'bottom',
    },
    {
      element: '#data-download-btn',
      title: 'Download the graph',
      content:
        'Save the whole graph as a file, in the RDF serialisation of your choice: Turtle, ' +
        'RDF/XML or N-Triples.',
      placement: 'bottom',
    },
    {
      title: 'Reading the results',
      content:
        'Each card is a node in the graph — a notice, an organisation, a contract, or any other entity. ' +
        'The contents of the card show you the node\'s properties and links to other nodes. ' +
        'You can click on any element to dig deeper into the connected data. ' +
        'Use the <span style="color:#000000; font-size:13.6px;">&#9654;</span> arrows to expand or collapse nested nodes. ' +
        'The breadcrumb at the top tracks your path — click any step to go back.' +
        '<br><br><b>Color coding:</b><br>' +
        '<span style="color:#b56217; font-weight:500; text-decoration:underline;">link or property name</span><span style="font-weight:500;"> → </span><br>' +
        '<span style="color:#2a00ff;">"property value"</span>' +
        '<span style="color:#666666; font-size:0.75em;">^^datatype@language</span><br>' +
        '<span style="color:#2c862d; font-weight:700; text-decoration:underline;">linked node type</span><br>' +
        '<span style="display:inline-flex; border-radius:999px; border:1px solid #666666; overflow:hidden; font-size:1em; line-height:1;">' +
          '<span style="background:#666666; color:#fff; padding:0.25em 0.6em;">linked node type</span>' +
          '<span style="background:#fff; color:#2a00ff; padding:0.25em 0.6em;">identifier</span>' +
        '</span>',
    },
  ]);
}
