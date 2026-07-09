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
 * ChartView — renders SPARQL SELECT results as charts using Chart.js.
 *
 * Detects chartable data (at least one numeric column and one label column),
 * and renders bar/line/pie charts with user-selectable axes, chart type,
 * and an optional group-by column that splits data into multiple datasets.
 */
export class ChartView {
  constructor() {
    this.viewToggle = document.getElementById('results-view-toggle');
    this.tableRadio = document.getElementById('results-view-table');
    this.chartRadio = document.getElementById('results-view-chart');
    this.chartSettings = document.getElementById('chart-settings');
    this.chartTypeSelect = document.getElementById('chart-type-select');
    this.xSelect = document.getElementById('chart-x-select');
    this.ySelect = document.getElementById('chart-y-select');
    this.groupSelect = document.getElementById('chart-group-select');
    this.resultsDiv = document.getElementById('results');
    this.chartContainer = document.getElementById('chart-container');
    this.canvas = document.getElementById('results-chart');
    this.chart = null;
    this.currentData = null;
    this.headers = [];

    this._initEventListeners();
  }

  _initEventListeners() {
    this.tableRadio.addEventListener('change', () => this._onViewChange());
    this.chartRadio.addEventListener('change', () => this._onViewChange());
    this.chartTypeSelect.addEventListener('change', () => this._renderChart());
    this.xSelect.addEventListener('change', () => this._renderChart());
    this.ySelect.addEventListener('change', () => this._renderChart());
    this.groupSelect.addEventListener('change', () => this._renderChart());
  }

  /**
   * Analyse SPARQL JSON results and enable chart view if the data is chartable.
   * Called by QueryResults after displaying the table.
   * @param {Object} data - The SPARQL results JSON (data.results.bindings).
   */
  setData(data) {
    this.destroy();

    if (!data?.results?.bindings?.length) {
      this.viewToggle.classList.add('d-none');
      this.currentData = null;
      return;
    }

    const bindings = data.results.bindings;
    this.headers = Object.keys(bindings[0]);
    this.currentData = bindings;

    // Detect which columns are numeric (candidate Y axes)
    const numericColumns = this.headers.filter(h =>
      bindings.every(row => {
        const val = row[h]?.value;
        return val !== undefined && val !== '' && !isNaN(Number(val));
      })
    );

    // Detect which columns are non-numeric (candidate X axes and group-by)
    const labelColumns = this.headers.filter(h => !numericColumns.includes(h));

    // Need at least one numeric and one label column to be chartable
    if (numericColumns.length === 0 || labelColumns.length === 0) {
      this.viewToggle.classList.add('d-none');
      return;
    }

    // Populate axis selectors
    this._populateSelect(this.xSelect, labelColumns);
    this._populateSelect(this.ySelect, numericColumns);

    // Populate group-by selector with "None" as default plus all label columns
    this._populateGroupSelect(labelColumns);

    // Show the toggle
    this.viewToggle.classList.remove('d-none');

    // Default to table view
    this.tableRadio.checked = true;
    this._onViewChange();
  }

  /**
   * Destroy the current chart and hide chart UI.
   */
  destroy() {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
    this.chartContainer.classList.add('d-none');
    this.chartSettings.classList.add('d-none');
    this.viewToggle.classList.add('d-none');
    this.currentData = null;
  }

  _populateSelect(selectEl, options) {
    selectEl.innerHTML = '';
    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = opt;
      selectEl.appendChild(option);
    });
  }

  _populateGroupSelect(labelColumns) {
    this.groupSelect.innerHTML = '';
    // "None" option — no grouping
    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = 'None';
    this.groupSelect.appendChild(noneOption);
    // All label columns as grouping options
    labelColumns.forEach(col => {
      const option = document.createElement('option');
      option.value = col;
      option.textContent = col;
      this.groupSelect.appendChild(option);
    });
  }

  _onViewChange() {
    const isChart = this.chartRadio.checked;
    if (isChart) {
      this.resultsDiv.classList.add('d-none');
      this.chartContainer.classList.remove('d-none');
      this.chartSettings.classList.remove('d-none');
      this._renderChart();
    } else {
      this.resultsDiv.classList.remove('d-none');
      this.chartContainer.classList.add('d-none');
      this.chartSettings.classList.add('d-none');
    }
  }

  _renderChart() {
    if (!this.currentData || !this.currentData.length) return;

    const xColumn = this.xSelect.value;
    const yColumn = this.ySelect.value;
    const groupColumn = this.groupSelect.value;
    const chartType = this.chartTypeSelect.value;

    if (this.chart) {
      this.chart.destroy();
    }

    const ctx = this.canvas.getContext('2d');
    let config;

    if (groupColumn && groupColumn !== xColumn) {
      config = this._buildGroupedConfig(xColumn, yColumn, groupColumn, chartType);
    } else {
      config = this._buildSimpleConfig(xColumn, yColumn, chartType);
    }

    this.chart = new Chart(ctx, config);
  }

  _buildSimpleConfig(xColumn, yColumn, chartType) {
    // Aggregate Y values per unique X label. If the data has multiple rows
    // for the same X value (e.g. same date with different sub-categories),
    // sum them together so each X label has a single bar/point.
    const aggregated = new Map();
    this.currentData.forEach(row => {
      const label = row[xColumn]?.value || '';
      const value = Number(row[yColumn]?.value) || 0;
      aggregated.set(label, (aggregated.get(label) || 0) + value);
    });

    const labels = [...aggregated.keys()];
    const values = [...aggregated.values()];

    const backgroundColors = this._generateColors(labels.length, 0.6);
    const borderColors = this._generateColors(labels.length, 1);

    return {
      type: chartType,
      data: {
        labels: labels,
        datasets: [{
          label: yColumn,
          data: values,
          backgroundColor: chartType === 'pie' ? backgroundColors : 'rgba(44, 134, 45, 0.6)',
          borderColor: chartType === 'pie' ? borderColors : 'rgba(44, 134, 45, 1)',
          borderWidth: 1,
        }]
      },
      options: this._buildOptions(xColumn, yColumn, chartType),
    };
  }

  _buildGroupedConfig(xColumn, yColumn, groupColumn, chartType) {
    // Collect unique X labels (preserving order of first appearance)
    const labelsSet = new Set();
    this.currentData.forEach(row => labelsSet.add(row[xColumn]?.value || ''));
    const labels = [...labelsSet];

    // Collect unique group values
    const groupsSet = new Set();
    this.currentData.forEach(row => groupsSet.add(row[groupColumn]?.value || ''));
    const groups = [...groupsSet];

    // Build a dataset per group
    const colors = this._generateColors(groups.length, 0.6);
    const borderColorsArr = this._generateColors(groups.length, 1);

    const datasets = groups.map((group, idx) => {
      // For each X label, find the Y value for this group
      const data = labels.map(label => {
        const row = this.currentData.find(r =>
          (r[xColumn]?.value || '') === label &&
          (r[groupColumn]?.value || '') === group
        );
        return row ? (Number(row[yColumn]?.value) || 0) : 0;
      });

      return {
        label: group,
        data: data,
        backgroundColor: colors[idx],
        borderColor: borderColorsArr[idx],
        borderWidth: 1,
      };
    });

    return {
      type: chartType === 'pie' ? 'bar' : chartType, // pie doesn't support grouped well, fall back to bar
      data: { labels, datasets },
      options: this._buildOptions(xColumn, yColumn, chartType === 'pie' ? 'bar' : chartType),
    };
  }

  _buildOptions(xColumn, yColumn, chartType) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
        },
        title: {
          display: true,
          text: `${yColumn} by ${xColumn}`,
        }
      },
      scales: chartType === 'pie' ? {} : {
        x: {
          title: {
            display: true,
            text: xColumn,
          },
          ticks: {
            maxRotation: 45,
            autoSkip: true,
            maxTicksLimit: 30,
          }
        },
        y: {
          title: {
            display: true,
            text: yColumn,
          },
          beginAtZero: true,
        }
      }
    };
  }

  _generateColors(count, alpha) {
    const colors = [];
    for (let i = 0; i < count; i++) {
      const hue = (i * 360 / count) % 360;
      colors.push(`hsla(${hue}, 70%, 50%, ${alpha})`);
    }
    return colors;
  }
}
