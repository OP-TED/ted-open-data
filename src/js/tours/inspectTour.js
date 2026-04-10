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
// Guided tour for the Inspect tab — 4 steps.

import { startTour } from './tour.js';

export function startInspectTour() {
  startTour([
    {
      element: '#search-input',
      title: 'Look up a notice',
      content:
        'Type a TED publication number here — the format is usually something like ' +
        '<code>123456-2024</code>. Press Enter or click the magnifying glass to fetch it.',
      placement: 'bottom',
    },
    {
      element: '#history-btn',
      title: 'Your recent lookups',
      content:
        'Every notice you look up is remembered here so you can jump back to it without retyping. ' +
        'The list lives in your browser — nothing is sent anywhere.',
      placement: 'bottom',
    },
    {
      element: '#lucky-link',
      title: 'Not sure where to start?',
      content:
        'Click this to pick a random notice from the dataset. Handy if you just want to see ' +
        'what a notice looks like before you have a specific one in mind.',
      placement: 'bottom',
    },
    {
      title: 'Then what?',
      content:
        'Once you press Enter, you are taken straight to the <strong>Reuse</strong> tab to ' +
        'inspect the notice as a linked-data graph — browse every property, follow the ' +
        'links between resources, and download the whole thing when you are done.',
    },
  ]);
}
