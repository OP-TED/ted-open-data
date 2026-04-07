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
 * the Lic
 */

/**
 * Class representing the Home Tab.
 * This class is responsible for initializing the home tab and handling related actions.
 */
export class HomeTab {
  constructor() {
    this.startTourButton = document.getElementById('start-tour');
    this.tryQueryLibraryButton = document.getElementById('try-query-library');
    // Stage 11 — third CTA: "Look up an existing notice" jumps to the
    // Search tab. Mirrors the two existing CTAs.
    this.lookupNoticeButton = document.getElementById('lookup-notice');
    this.queryEditorTab = new bootstrap.Tab(document.getElementById('query-editor-tab'));
    this.queryLibraryTab = new bootstrap.Tab(document.getElementById('query-library-tab'));
    // Search tab is added by Stage 5; the bootstrap.Tab is built lazily
    // because the element only exists in the merged app.
    const searchTabBtn = document.getElementById('app-tab-search');
    this.searchTab = searchTabBtn ? new bootstrap.Tab(searchTabBtn) : null;

    this.initEventListeners();
  }

  /**
   * Initialize event listeners.
   */
  initEventListeners() {
    this.startTourButton.addEventListener('click', this.onStartTour.bind(this));
    this.tryQueryLibraryButton.addEventListener('click', this.onTryQueryLibrary.bind(this));
    if (this.lookupNoticeButton && this.searchTab) {
      this.lookupNoticeButton.addEventListener('click', this.onLookupNotice.bind(this));
    }
  }

  /**
   * Handle start tour button click event.
   * Switches to the query editor tab.
   */
  onStartTour() {
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
   * Stage 11 — handle the look-up-a-notice CTA.
   * Switches to the Search tab and focuses the input.
   */
  onLookupNotice() {
    this.searchTab.show();
    document.getElementById('search-input')?.focus();
  }
}
