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

import {
  classifyColumns, isChartable, aggregateByX, chartLabel,
  axisTooltipFormatter, itemTooltipFormatter,
} from './utils/chartUtils.js';

/**
 * ChartView — renders SPARQL SELECT results as interactive charts using Apache ECharts.
 *
 * Detects chartable data (at least one numeric column and one label column),
 * and renders bar/line/pie/scatter charts with user-selectable axes, chart type,
 * and an optional group-by column that splits data into multiple series.
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
    this.chart = null;
    this.currentData = null;
    this.headers = [];

    this._initEventListeners();
    this._initResizeObserver();
  }

  _initEventListeners() {
    this.tableRadio.addEventListener('change', () => this._onViewChange());
    this.chartRadio.addEventListener('change', () => this._onViewChange());
    this.chartTypeSelect.addEventListener('change', () => this._renderChart());
    this.xSelect.addEventListener('change', () => this._renderChart());
    this.ySelect.addEventListener('change', () => this._renderChart());
    this.groupSelect.addEventListener('change', () => this._renderChart());
  }

  _initResizeObserver() {
    // ECharts needs explicit resize calls when its container changes size
    const observer = new ResizeObserver(() => {
      if (this.chart) this.chart.resize();
    });
    observer.observe(this.chartContainer);
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

    // ECharts is lazy-loaded on the first switch to Chart view, so it's
    // normally absent here — that's fine, clicking the toggle triggers the
    // load. A previous load failure is not latched: it may have been a
    // transient CDN/network blip, so the toggle is still offered and the next
    // click retries (a persistent failure just falls back to the table again).
    const bindings = data.results.bindings;
    this.headers = Object.keys(bindings[0]);
    this.currentData = bindings;

    // Need at least one numeric and one label column to be chartable.
    if (!isChartable(bindings)) {
      this.viewToggle.classList.add('d-none');
      return;
    }

    // Numeric columns are candidate Y axes; label columns are candidate X / Group.
    const { numericColumns, labelColumns } = classifyColumns(bindings);

    // X axis prefers label columns, but falls back to the numeric columns when
    // every column is numeric (e.g. `?year ?count`) so an all-numeric result
    // still has an X axis to plot against.
    const xColumns = labelColumns.length > 0 ? labelColumns : numericColumns;

    // Populate axis selectors
    this._populateSelect(this.xSelect, xColumns);
    this._populateSelect(this.ySelect, numericColumns);
    this._populateGroupSelect(labelColumns);

    // In the all-numeric case X and Y default to the same first column; nudge
    // Y to a different one so the initial chart isn't a column against itself.
    if (this.xSelect.value === this.ySelect.value && numericColumns.length > 1) {
      this.ySelect.value = numericColumns.find(c => c !== this.xSelect.value);
    }

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
      this.chart.dispose();
      this.chart = null;
    }
    this.chartContainer.classList.add('d-none');
    this.chartSettings.classList.add('d-none');
    this.viewToggle.classList.add('d-none');
    // Ensure the results table is visible again when the chart is destroyed
    this.resultsDiv.classList.remove('d-none');
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
    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = 'None';
    this.groupSelect.appendChild(noneOption);
    labelColumns.forEach(col => {
      const option = document.createElement('option');
      option.value = col;
      option.textContent = col;
      this.groupSelect.appendChild(option);
    });
  }

  async _onViewChange() {
    const isChart = this.chartRadio.checked;
    if (!isChart) {
      this.resultsDiv.classList.remove('d-none');
      this.chartContainer.classList.add('d-none');
      this.chartSettings.classList.add('d-none');
      return;
    }

    this.resultsDiv.classList.add('d-none');
    this.chartContainer.classList.remove('d-none');
    this.chartSettings.classList.remove('d-none');

    // Lazy-load ECharts on the first switch to Chart view. Show a brief
    // loading state while the ~1 MB script downloads; if it fails, drop back
    // to the table and remove the toggle.
    if (typeof echarts === 'undefined') {
      this.chartContainer.innerHTML =
        '<div class="d-flex justify-content-center align-items-center py-5 text-muted">' +
        '<div class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></div>' +
        'Loading chart…</div>';
      try {
        await ChartView._loadECharts();
      } catch {
        this._onEChartsUnavailable();
        return;
      }
      // A newer query may have swapped the data out while we were loading.
      if (!this.chartRadio.checked || !this.currentData) return;
    }

    this.chartContainer.innerHTML = '';
    this._renderChart();
  }

  /**
   * Fall back to the table when ECharts can't be loaded (CDN blocked /
   * offline / CSP). Reverts to the table view for this attempt but leaves the
   * toggle in place — the failure isn't latched, so if it was transient the
   * next Chart click retries (`_loadECharts` cleared its cached promise).
   */
  _onEChartsUnavailable() {
    if (!ChartView._echartsWarned) {
      console.warn('[ChartView] Apache ECharts failed to load; showing the table. ' +
        'The next switch to Chart view will retry.');
      ChartView._echartsWarned = true;
    }
    this.chartContainer.innerHTML = '';
    this.tableRadio.checked = true;
    this.resultsDiv.classList.remove('d-none');
    this.chartContainer.classList.add('d-none');
    this.chartSettings.classList.add('d-none');
  }

  /**
   * Inject the ECharts CDN script on demand and resolve once the global is
   * available. Concurrent/repeat calls share one in-flight load; a failed
   * load clears the cached promise so a later attempt can retry.
   * @returns {Promise<void>}
   */
  static _loadECharts() {
    if (typeof echarts !== 'undefined') return Promise.resolve();
    if (ChartView._echartsPromise) return ChartView._echartsPromise;

    ChartView._echartsPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = ChartView.ECHARTS_SRC;
      script.async = true;
      script.onload = () =>
        typeof echarts !== 'undefined'
          ? resolve()
          : reject(new Error('ECharts global missing after script load'));
      script.onerror = () => reject(new Error('Failed to load ECharts script'));
      document.head.appendChild(script);
    });
    ChartView._echartsPromise.catch(() => { ChartView._echartsPromise = null; });
    return ChartView._echartsPromise;
  }

  _renderChart() {
    if (!this.currentData || !this.currentData.length) return;
    // Safety net — setData already hides the toggle when echarts is absent,
    // so this normally can't be reached, but never call echarts.init on undefined.
    if (typeof echarts === 'undefined') return;

    const xColumn = this.xSelect.value;
    const yColumn = this.ySelect.value;
    const groupColumn = this.groupSelect.value;
    const chartType = this.chartTypeSelect.value;

    // Initialize ECharts instance if not already created
    if (!this.chart) {
      this.chart = echarts.init(this.chartContainer);
    }

    let option;
    if (groupColumn && groupColumn !== xColumn) {
      option = this._buildGroupedOption(xColumn, yColumn, groupColumn, chartType);
    } else {
      option = this._buildSimpleOption(xColumn, yColumn, chartType);
    }

    this.chart.setOption(option, true); // true = replace, don't merge
  }

  _buildSimpleOption(xColumn, yColumn, chartType) {
    // Aggregate Y values per unique X label
    const { labels, values } = aggregateByX(this.currentData, xColumn, yColumn);

    if (chartType === 'pie') {
      return {
        title: { text: `${yColumn} by ${xColumn}`, left: 'center' },
        tooltip: { trigger: 'item', formatter: itemTooltipFormatter },
        legend: { type: 'scroll', bottom: 0, formatter: chartLabel },
        series: [{
          type: 'pie',
          radius: ['30%', '70%'],
          data: labels.map((label, i) => ({ name: label, value: values[i] })),
          emphasis: {
            itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.3)' }
          },
          label: { formatter: (p) => `${chartLabel(p.name)}: ${p.percent}%` },
        }]
      };
    }

    if (chartType === 'scatter') {
      // Scatter plots RAW points — every (x, y) row — so duplicate X values
      // spread out vertically instead of collapsing into one aggregated sum
      // (bar/line keep the sum; only scatter shows the distribution). The
      // category axis still lists the unique X labels; points reference them
      // by value, so rows sharing an X stack at that column.
      const points = this.currentData.map(row => [
        row[xColumn]?.value || '',
        Number(row[yColumn]?.value) || 0,
      ]);
      return {
        title: { text: `${yColumn} by ${xColumn}`, left: 'center' },
        tooltip: { trigger: 'item', formatter: itemTooltipFormatter },
        xAxis: { type: 'category', data: labels, name: xColumn, axisLabel: { rotate: 30, formatter: chartLabel } },
        yAxis: { type: 'value', name: yColumn },
        dataZoom: labels.length > 10 ? [{ type: 'inside' }, { type: 'slider' }] : [{ type: 'inside' }],
        series: [{
          type: 'scatter',
          data: points,
          symbolSize: 8,
          itemStyle: { color: '#2c862d', opacity: 0.6 },
        }]
      };
    }

    // Bar or Line
    return {
      title: { text: `${yColumn} by ${xColumn}`, left: 'center' },
      tooltip: { trigger: 'axis', formatter: axisTooltipFormatter },
      xAxis: {
        type: 'category',
        data: labels,
        name: xColumn,
        axisLabel: { rotate: labels.length > 10 ? 30 : 0, overflow: 'truncate', width: 80, formatter: chartLabel },
      },
      yAxis: { type: 'value', name: yColumn },
      dataZoom: labels.length > 10 ? [{ type: 'inside' }, { type: 'slider' }] : [{ type: 'inside' }],
      grid: { bottom: labels.length > 10 ? 80 : 60, containLabel: true },
      series: [{
        type: chartType,
        data: values,
        itemStyle: { color: '#2c862d' },
        areaStyle: chartType === 'line' ? { opacity: 0.15 } : undefined,
        smooth: chartType === 'line',
      }]
    };
  }

  _buildGroupedOption(xColumn, yColumn, groupColumn, chartType) {
    // Collect unique X labels (preserving order of first appearance)
    const labelsSet = new Set();
    this.currentData.forEach(row => labelsSet.add(row[xColumn]?.value || ''));
    const labels = [...labelsSet];

    // Collect unique group values
    const groupsSet = new Set();
    this.currentData.forEach(row => groupsSet.add(row[groupColumn]?.value || ''));
    const groups = [...groupsSet];

    if (chartType === 'pie') {
      // For pie with grouping, show total per group (ignoring X axis)
      const groupTotals = new Map();
      this.currentData.forEach(row => {
        const group = row[groupColumn]?.value || '';
        const value = Number(row[yColumn]?.value) || 0;
        groupTotals.set(group, (groupTotals.get(group) || 0) + value);
      });

      return {
        title: { text: `${yColumn} by ${groupColumn}`, left: 'center' },
        tooltip: { trigger: 'item', formatter: itemTooltipFormatter },
        legend: { type: 'scroll', bottom: 0, formatter: chartLabel },
        series: [{
          type: 'pie',
          radius: ['30%', '70%'],
          data: [...groupTotals.entries()].map(([name, value]) => ({ name, value })),
          emphasis: {
            itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.3)' }
          },
          label: { formatter: (p) => `${chartLabel(p.name)}: ${p.percent}%` },
        }]
      };
    }

    // Build a series per group. Scatter and bar/line differ fundamentally:
    // scatter shows the raw distribution; bar/line show one value per cell.
    let series;
    if (chartType === 'scatter') {
      // Plot every group's raw (x, y) rows — no collapsing of duplicate
      // (x, group) rows and no phantom y=0 point for missing cells.
      series = groups.map(group => ({
        name: group,
        type: 'scatter',
        symbolSize: 8,
        itemStyle: { opacity: 0.6 },
        data: this.currentData
          .filter(r => (r[groupColumn]?.value || '') === group)
          .map(r => [r[xColumn]?.value || '', Number(r[yColumn]?.value) || 0]),
      }));
    } else {
      // Bar/line: sum Y per (x label × group), 0 for a missing cell — the same
      // aggregation the ungrouped bar/line uses (aggregateByX), so duplicate
      // (x, group) rows add up instead of the first one winning. Indexed once
      // so the grid is O(rows + groups×labels), not O(groups × labels × rows).
      const yByCell = new Map();
      for (const r of this.currentData) {
        const key = JSON.stringify([r[xColumn]?.value || '', r[groupColumn]?.value || '']);
        yByCell.set(key, (yByCell.get(key) || 0) + (Number(r[yColumn]?.value) || 0));
      }
      series = groups.map(group => ({
        name: group,
        type: chartType,
        data: labels.map(label => yByCell.get(JSON.stringify([label, group])) ?? 0),
        smooth: chartType === 'line',
        areaStyle: chartType === 'line' ? { opacity: 0.1 } : undefined,
      }));
    }

    return {
      title: { text: `${yColumn} by ${xColumn} (grouped by ${groupColumn})`, left: 'center' },
      tooltip: chartType === 'scatter'
        ? { trigger: 'item', formatter: (p) => itemTooltipFormatter(p, { showSeriesName: true }) }
        : { trigger: 'axis', formatter: axisTooltipFormatter },
      legend: { type: 'scroll', bottom: labels.length > 10 ? 40 : 0, data: groups, formatter: chartLabel },
      xAxis: {
        type: 'category',
        data: labels,
        name: xColumn,
        axisLabel: { rotate: labels.length > 10 ? 30 : 0, overflow: 'truncate', width: 80, formatter: chartLabel },
      },
      yAxis: { type: 'value', name: yColumn },
      dataZoom: labels.length > 10 ? [{ type: 'inside' }, { type: 'slider', bottom: 10 }] : [{ type: 'inside' }],
      grid: { bottom: labels.length > 10 ? 120 : 80, containLabel: true },
      series: series,
    };
  }
}

// CDN source for the lazy-loaded ECharts bundle (see index.html — the eager
// <script> was removed so this ~1 MB download only happens when a user first
// opens a chart). Keep the version in sync with the README component list.
ChartView.ECHARTS_SRC = 'https://cdn.jsdelivr.net/npm/echarts@5.6.0/dist/echarts.min.js';
