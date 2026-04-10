/*
 * Copyright 2024 European Union
 *
 * Licensed under the EUPL, Version 1.2 or – as soon they will be approved by the European
 * Commission – subsequent versions of the EUPL (the "Licence"); You may not use this work except in
 * compliance with the Licence. You may obtain a copy of the Licence at:
 * https://joinup.ec.europa.eu/software/page/eupl
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the Licence
 * is distributed on an "AS IS" basis, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the Licence for the specific language governing permissions and limitations under
 * the Licence.
 */

/**
 * Class representing the Home Tab.
 * This class is responsible for initializing the home tab and handling related actions.
 */
export class HomeTab {
  constructor() {
    this.startTourButton = document.getElementById('start-tour');
    this.tryQueryLibraryButton = document.getElementById('try-query-library');
    // Third CTA: "Look up an existing notice" jumps to the
    // Inspect tab (`#app-tab-search`). Mirrors the two existing CTAs.
    this.lookupNoticeButton = document.getElementById('lookup-notice');
    this.queryEditorTab = new bootstrap.Tab(document.getElementById('query-editor-tab'));
    this.queryLibraryTab = new bootstrap.Tab(document.getElementById('query-library-tab'));
    // The Inspect tab (`#app-tab-search`) is added  the
    // bootstrap.Tab is built lazily because the element only exists
    // in the merged app.
    const searchTabBtn = document.getElementById('app-tab-search');
    this.searchTab = searchTabBtn ? new bootstrap.Tab(searchTabBtn) : null;

    this.initEventListeners();
  }

  /**
   * Initialize event listeners.
   *
   * There are two sets of CTA buttons on the Home tab:
   *   - The slide-specific buttons on carousel slides 2-4 (IDs:
   *     lookup-notice, try-query-library, start-tour) — these are
   *     the original  buttons that work when a user flips
   *     to the relevant slide.
   *   - The "all three at once" CTAs on slide 1 (IDs:
   *     home-cta-lookup, home-cta-library, home-cta-editor) — these
   *     guarantee a user who never interacts with the carousel still
   *     has every entry point visible.
   *
   * Both sets share the same handlers. Slide-1 buttons are wired
   * here with direct document.getElementById lookups because they
   * weren't captured in the constructor (the constructor's field
   * assignments pre-date the slide-1 addition; this keeps the
   * diff localised to initEventListeners).
   */
  initEventListeners() {
    this.startTourButton.addEventListener('click', this.onOpenCustomizeTab.bind(this));
    this.tryQueryLibraryButton.addEventListener('click', this.onTryQueryLibrary.bind(this));
    if (this.lookupNoticeButton && this.searchTab) {
      this.lookupNoticeButton.addEventListener('click', this.onLookupNotice.bind(this));
    }

    // Slide 1 CTAs are NOT shortcuts to the destination tabs — they
    // advance the carousel to the matching feature slide instead. This
    // turns slide 1 into a table of contents: the user clicks the
    // headline they're interested in, reads the slide that explains
    // it, then clicks the "real" CTA on that slide. The destination
    // tab is reached in two steps, not one.
    //
    // Slide indices: 1 = lookup, 2 = library, 3 = editor.
    const carouselEl = document.getElementById('home-carousel');
    const goToSlide = (index) => {
      if (!carouselEl) return;
      bootstrap.Carousel.getOrCreateInstance(carouselEl).to(index);
    };
    document.getElementById('home-cta-lookup')?.addEventListener('click', () => goToSlide(1));
    document.getElementById('home-cta-library')?.addEventListener('click', () => goToSlide(2));
    document.getElementById('home-cta-editor')?.addEventListener('click', () => goToSlide(3));
    document.getElementById('home-cta-reuse')?.addEventListener('click', () => goToSlide(4));

    // Slide 5 "Get started →" — send the user straight to the Search
    // tab. Slide 5 is the end of the narrative ("use the data"), so the
    // CTA is a direct jump to the first real action, not a carousel
    // advance.
    document.getElementById('home-cta-get-started')?.addEventListener(
      'click', () => this.searchTab?.show(),
    );
  }

  /**
   * Handle the "write your own query" CTA on the Customize
   * carousel slide. Switches to the Customize tab
   * (`#query-editor-tab`). Named onOpenCustomizeTab rather than
   * onStartTour (the legacy DOM id `start-tour` predates the rename
   * to Customize) so the method name matches what it actually does.
   */
  onOpenCustomizeTab() {
    this.queryEditorTab.show();
  }

  /**
   * Handle try query library button click event.
   * Switches to the query library tab.
   */
  onTryQueryLibrary() {
    this.queryLibraryTab.show();
  }

  /**
   * Handle the look-up-a-notice CTA.
   * Switches to the Inspect tab (`#app-tab-search`) and focuses the
   * publication-number input.
   */
  onLookupNotice() {
    this.searchTab.show();
    document.getElementById('search-input')?.focus();
  }
}
