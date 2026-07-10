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

import { classifyColumns, aggregateByX } from './utils/chartUtils.js';

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

    const bindings = data.results.bindings;
    this.headers = Object.keys(bindings[0]);
    this.currentData = bindings;

    // Detect which columns are numeric (candidate Y axes)
    const { numericColumns, labelColumns } = classifyColumns(bindings);

    // Need at least one numeric and one label column to be chartable
    if (numericColumns.length === 0 || labelColumns.length === 0) {
      this.viewToggle.classList.add('d-none');
      return;
    }

    // Populate axis selectors
    this._populateSelect(this.xSelect, labelColumns);
    this._populateSelect(this.ySelect, numericColumns);
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
      this.chart.dispose();
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
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        legend: { type: 'scroll', bottom: 0 },
        series: [{
          type: 'pie',
          radius: ['30%', '70%'],
          data: labels.map((label, i) => ({ name: label, value: values[i] })),
          emphasis: {
            itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.3)' }
          },
          label: { formatter: '{b}: {d}%' },
        }]
      };
    }

    if (chartType === 'scatter') {
      return {
        title: { text: `${yColumn} by ${xColumn}`, left: 'center' },
        tooltip: { trigger: 'item', formatter: (p) => `${p.name}: ${p.value[1]}` },
        xAxis: { type: 'category', data: labels, name: xColumn, axisLabel: { rotate: 30 } },
        yAxis: { type: 'value', name: yColumn },
        dataZoom: labels.length > 10 ? [{ type: 'inside' }, { type: 'slider' }] : [{ type: 'inside' }],
        series: [{
          type: 'scatter',
          data: values.map((v, i) => [labels[i], v]),
          symbolSize: 10,
          itemStyle: { color: '#2c862d' },
        }]
      };
    }

    // Bar or Line
    return {
      title: { text: `${yColumn} by ${xColumn}`, left: 'center' },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: labels,
        name: xColumn,
        axisLabel: { rotate: labels.length > 10 ? 30 : 0, overflow: 'truncate', width: 80 },
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
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        legend: { type: 'scroll', bottom: 0 },
        series: [{
          type: 'pie',
          radius: ['30%', '70%'],
          data: [...groupTotals.entries()].map(([name, value]) => ({ name, value })),
          emphasis: {
            itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.3)' }
          },
          label: { formatter: '{b}: {d}%' },
        }]
      };
    }

    // Build a series per group for bar/line/scatter
    const series = groups.map(group => {
      const data = labels.map(label => {
        const row = this.currentData.find(r =>
          (r[xColumn]?.value || '') === label &&
          (r[groupColumn]?.value || '') === group
        );
        return row ? (Number(row[yColumn]?.value) || 0) : 0;
      });

      return {
        name: group,
        type: chartType === 'scatter' ? 'scatter' : chartType,
        data: data,
        smooth: chartType === 'line',
        areaStyle: chartType === 'line' ? { opacity: 0.1 } : undefined,
        symbolSize: chartType === 'scatter' ? 10 : undefined,
      };
    });

    return {
      title: { text: `${yColumn} by ${xColumn} (grouped by ${groupColumn})`, left: 'center' },
      tooltip: { trigger: chartType === 'scatter' ? 'item' : 'axis' },
      legend: { type: 'scroll', bottom: labels.length > 10 ? 40 : 0, data: groups },
      xAxis: {
        type: 'category',
        data: labels,
        name: xColumn,
        axisLabel: { rotate: labels.length > 10 ? 30 : 0, overflow: 'truncate', width: 80 },
      },
      yAxis: { type: 'value', name: yColumn },
      dataZoom: labels.length > 10 ? [{ type: 'inside' }, { type: 'slider', bottom: 10 }] : [{ type: 'inside' }],
      grid: { bottom: labels.length > 10 ? 120 : 80, containLabel: true },
      series: series,
    };
  }
}
