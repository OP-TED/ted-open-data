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
// Lightweight guided-tour engine built on Bootstrap 5 Popover.
//
// No external library — uses the Bootstrap JS bundle already on the
// page. Each tour is an array of step objects:
//
//   { element: '#css-selector', title: '...', content: '...', placement: 'bottom' }
//
// Steps without an `element` render as a centered modal-style popover
// anchored to a hidden element in the middle of the viewport.

let activeTour = null;

/**
 * Run a guided tour.
 *
 * @param {Array<{element?: string, title: string, content: string, placement?: string}>} steps
 */
export function startTour(steps) {
  if (activeTour) {
    destroyTour();
  }

  let currentStep = 0;
  const state = { steps, popovers: [] };
  activeTour = state;

  function show(index) {
    // Hide previous
    hide(currentStep);
    currentStep = index;

    const step = steps[index];
    const target = step.element ? document.querySelector(step.element) : null;

    // For steps without an element, create a temporary anchor in the
    // center of the viewport.
    let anchor = target;
    if (!anchor) {
      anchor = document.createElement('div');
      anchor.className = 'tour-center-anchor';
      anchor.style.cssText = 'position:fixed;top:50%;left:50%;width:1px;height:1px;pointer-events:none;z-index:-1;';
      document.body.appendChild(anchor);
      step._tempAnchor = anchor;
    }

    // Scroll the target into view if needed
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Build navigation buttons
    const isFirst = index === 0;
    const isLast = index === steps.length - 1;
    const progress = `${index + 1} of ${steps.length}`;
    const nav =
      `<div class="d-flex align-items-center justify-content-between mt-3">` +
        `<span class="text-muted small">${progress}</span>` +
        `<div>` +
          (isFirst ? `<button class="btn btn-sm btn-link tour-cancel-btn">Cancel</button>` :
                     `<button class="btn btn-sm btn-link tour-prev-btn">\u2190 Back</button>`) +
          `<button class="btn btn-sm btn-primary tour-${isLast ? 'done' : 'next'}-btn ms-1">${isLast ? 'Got it' : 'Next \u2192'}</button>` +
        `</div>` +
      `</div>`;

    const popover = new bootstrap.Popover(anchor, {
      title: step.title,
      content: step.content + nav,
      placement: target ? (step.placement || 'bottom') : 'bottom',
      fallbackPlacements: ['top', 'bottom', 'left', 'right'],
      html: true,
      sanitize: false,
      trigger: 'manual',
      container: 'body',
      customClass: 'tour-popover' + (target ? '' : ' tour-no-arrow'),
    });

    popover.show();
    state.popovers[index] = popover;

    // Wire up navigation buttons and keyboard accessibility
    setTimeout(() => {
      const tip = popover.tip;
      if (!tip) return;

      // Set ARIA role so screen readers announce the popover
      tip.setAttribute('role', 'dialog');
      tip.setAttribute('aria-label', step.title);

      const nextBtn = tip.querySelector('.tour-next-btn');
      const prevBtn = tip.querySelector('.tour-prev-btn');
      const cancelBtn = tip.querySelector('.tour-cancel-btn');
      const doneBtn = tip.querySelector('.tour-done-btn');
      if (nextBtn) nextBtn.addEventListener('click', () => show(currentStep + 1));
      if (prevBtn) prevBtn.addEventListener('click', () => show(currentStep - 1));
      if (cancelBtn) cancelBtn.addEventListener('click', () => destroyTour());
      if (doneBtn) doneBtn.addEventListener('click', () => destroyTour());

      // Move focus to the primary action button
      const primary = doneBtn || nextBtn;
      if (primary) primary.focus();

      // Escape key dismisses the tour
      tip.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') destroyTour();
      });
    }, 50);
  }

  function hide(index) {
    const popover = state.popovers[index];
    if (popover) {
      popover.dispose();
      state.popovers[index] = null;
    }
    const step = steps[index];
    if (step?._tempAnchor) {
      step._tempAnchor.remove();
      step._tempAnchor = null;
    }
  }

  show(0);
}

export function destroyTour() {
  if (!activeTour) return;
  activeTour.popovers.forEach((p, i) => {
    if (p) p.dispose();
    const step = activeTour.steps[i];
    if (step?._tempAnchor) {
      step._tempAnchor.remove();
      step._tempAnchor = null;
    }
  });
  activeTour = null;
}
