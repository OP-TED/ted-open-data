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
 * Interactive guided tour for the Reuse tab — graph lane.
 *
 * Shown when the current view is a linked-data graph (a single
 * notice from the Inspect tab or the output of a CONSTRUCT /
 * DESCRIBE query). The tour walks through the navigation chrome
 * (breadcrumb, view-mode toggle) and the two reuse actions (Share
 * view and Download as…).
 *
 * No priming is needed — the trigger only exists inside the data
 * card, which is hidden until a graph has actually loaded.
 */

import { createTour, loadDriver } from './_driver.js';

let activeTour = null;

/**
 * Start the Reuse (graph lane) tour. Any previous instance is
 * destroyed first so only one tour is ever live at a time.
 */
export async function startReuseGraphTour() {
  const driver = await loadDriver();

  if (activeTour) {
    try { activeTour.destroy(); } catch { /* best-effort cleanup */ }
    activeTour = null;
  }

  activeTour = createTour(driver, [
    {
      element: '#data-breadcrumb',
      popover: {
        title: 'Where you are',
        description:
          'The breadcrumb trail shows the path you have taken through the graph. Click any step ' +
          'to jump back to an earlier resource.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      // Target the view-mode toggle by its own id, not by the
      // generic `.btn-group[role="group"]` selector. The old selector
      // returned the first such element anywhere in the document,
      // which would silently steal the anchor if any future button
      // group landed above it.
      element: '#data-view-mode-toggle',
      popover: {
        title: 'Three ways to look at the same data',
        description:
          '<strong>Tree</strong> presents the graph as a clickable outline. ' +
          '<strong>Turtle</strong> shows the raw RDF serialisation, for when you want to read ' +
          'the underlying statements. <strong>Backlinks</strong> lists the other resources in ' +
          'the dataset that reference the one you are currently looking at.',
        side: 'bottom',
        align: 'end',
      },
    },
    {
      element: '#data-share-btn',
      popover: {
        title: 'Share this view',
        description:
          'Copies a URL that reproduces exactly what you are looking at right now — the same ' +
          'resource, the same view mode, the same breadcrumb. Save it for later or send it to ' +
          'a colleague; when they open it, they will see what you see.',
        side: 'bottom',
        align: 'end',
      },
    },
    {
      element: '#data-download-btn',
      popover: {
        title: 'Download the graph',
        description:
          'Save the whole graph as a file, in the RDF serialisation of your choice: Turtle, ' +
          'RDF/XML or N-Triples.',
        side: 'bottom',
        align: 'end',
      },
    },
    {
      // Centered modal — explains how to read the tree, using
      // colour references that match the actual CSS classes.
      popover: {
        title: 'Reading the results',
        description:
          'Each card is a node in the graph — a notice, an organisation, a contract, or any other entity. ' +
          'The contents of the card show you the node\'s properties and links to other nodes. ' +
          'You can click on any element to dig deeper into the connected data. ' +
          'Use the <span style="color:#000000; font-size:13.6px;">&#9654;</span> arrows to expand or collapse nested nodes. ' +
          'The breadcrumb at the top tracks your path — click any step to go back.' +
          '<br><br><b>Color coding:</b><br>' +
          '<span style="color:#0d6efd; text-decoration:underline; font-weight:400;">link/property name</span><span style="font-weight:500;"> → </span><br>' +
          '<span style="color:#7f0055; text-decoration:underline;">linked node</span><br>' +
          '<span style="color:#2a00ff;">"property value"</span><br>' +
          '<span class="badge text-info-emphasis bg-info-subtle" style="font-size:1em; font-weight:400;">linked node ID</span>',
      },
    },
  ]);

  activeTour.drive();
}
