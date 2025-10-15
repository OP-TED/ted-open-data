/*
 * Copyright 2022 European Union
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
    this.queryEditorTab = new bootstrap.Tab(document.getElementById('query-editor-tab'));
    this.queryLibraryTab = new bootstrap.Tab(document.getElementById('query-library-tab'));

    this.initEventListeners();
  }

  /**
   * Initialize event listeners.
   * Sets up event listeners for the start tour button and the try query library button.
   */
  initEventListeners() {
    this.startTourButton.addEventListener('click', this.onStartTour.bind(this));
    this.tryQueryLibraryButton.addEventListener('click', this.onTryQueryLibrary.bind(this));
  }

  /**
   * Handle start tour button click event.
   * Switches to the query editor tab.
   */
  onStartTour() {
    console.log('Write your query button clicked');
    this.queryEditorTab.show();
  }

  /**
   * Handle try query library button click event.
   * Switches to the query library tab.
   */
  onTryQueryLibrary() {
    console.log('Try our query library button clicked');
    this.queryLibraryTab.show();
  }
}
