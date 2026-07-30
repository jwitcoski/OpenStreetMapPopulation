/*
 * panel.js
 * Reads and updates the side panel DOM (stats, status, form fields).
 * No map or Overpass logic lives here.
 */

import {
  COMPARE_DATASETS,
  getCompareDataset,
} from './compare-population.js';

/**
 * Load country / custom demographic presets from public/demographics.json.
 * Supports either a bare preset array or `{ source, presets }`.
 */
export async function loadPresets() {
  const response = await fetch(
    `${import.meta.env.BASE_URL}demographics.json`
  );

  if (!response.ok) {
    throw new Error('Could not load demographics presets');
  }

  const data = await response.json();
  if (Array.isArray(data)) {
    return { source: null, presets: data };
  }

  return {
    source: data.source ?? null,
    presets: data.presets ?? [],
    defaultPresetId: data.defaultPresetId ?? null,
  };
}

/**
 * Wire up the preset dropdown and form inputs.
 * Calls onParamsChange whenever the user edits a value.
 * Calls onCompareChange when the reference dataset changes.
 */
export function initPanel(
  { source, presets, defaultPresetId },
  { onParamsChange, onCompareChange }
) {
  const presetSelect = document.getElementById('preset');
  const presetFilter = document.getElementById('preset-filter');
  const compareSelect = document.getElementById('compare-dataset');
  const form = document.getElementById('params-form');
  const sourceNote = document.getElementById('demographics-source');

  if (!presets.length) {
    throw new Error('No demographic presets found');
  }

  if (compareSelect && !compareSelect.options.length) {
    compareSelect.innerHTML = COMPARE_DATASETS.map(
      (dataset) => `<option value="${dataset.id}">${dataset.label}</option>`
    ).join('');
  }
  if (compareSelect) {
    compareSelect.value = 'worldpop';
    updateCompareChrome(compareSelect.value);
    compareSelect.addEventListener('change', () => {
      updateCompareChrome(compareSelect.value);
      onCompareChange?.(compareSelect.value);
    });
  }

  function renderPresetOptions(filterText = '') {
    const needle = filterText.trim().toLowerCase();
    const visible = needle
      ? presets.filter((preset) => preset.name.toLowerCase().includes(needle))
      : presets;

    const selectedId = presetSelect.value;
    presetSelect.innerHTML = visible
      .map((preset) => `<option value="${preset.id}">${preset.name}</option>`)
      .join('');

    if (visible.some((preset) => preset.id === selectedId)) {
      presetSelect.value = selectedId;
    } else if (visible[0]) {
      presetSelect.value = visible[0].id;
    }
  }

  if (sourceNote && source?.url) {
    const count = presets.filter((preset) => preset.id !== 'custom').length;
    sourceNote.innerHTML = `Household size for ${count} countries from <a href="${source.url}" target="_blank" rel="noopener">${source.label || 'UN DESA'}</a>. Other factors are estimation defaults.`;
  }

  const preferred =
    presets.find((preset) => preset.id === defaultPresetId) ||
    presets.find((preset) => preset.id === 'united-states') ||
    presets[0];

  renderPresetOptions('');
  presetSelect.value = preferred.id;
  applyPreset(preferred);

  presetFilter?.addEventListener('input', () => {
    renderPresetOptions(presetFilter.value);
  });

  presetSelect.addEventListener('change', () => {
    const selected = presets.find((preset) => preset.id === presetSelect.value);
    if (!selected) return;
    applyPreset(selected);
    onParamsChange(readParams());
  });

  form.addEventListener('input', (event) => {
    if (event.target === presetFilter || event.target === compareSelect) return;
    onParamsChange(readParams());
  });

  return { readParams, readCompareDataset };
}

/** @returns {import('./compare-population.js').CompareDatasetId} */
export function readCompareDataset() {
  const select = document.getElementById('compare-dataset');
  const value = select?.value || 'worldpop';
  if (value === 'ghs-pop' || value === 'none' || value === 'worldpop') {
    return value;
  }
  return 'worldpop';
}

function updateCompareChrome(datasetId) {
  const dataset = getCompareDataset(datasetId);
  const hint = document.getElementById('compare-hint');
  const source = document.getElementById('compare-source');
  const compareStats = document.getElementById('compare-stats');

  if (hint) {
    hint.textContent =
      datasetId === 'none'
        ? 'Skip gridded population comparison.'
        : `Reference population from ${dataset.label}.`;
  }

  if (source) {
    source.innerHTML =
      datasetId === 'none' || !dataset.creditHtml
        ? ''
        : ` Comparison via ${dataset.creditHtml}.`;
  }

  if (compareStats) {
    compareStats.hidden = datasetId === 'none';
  }
}

/** Copy a preset's numbers into the form fields. */
function applyPreset(preset) {
  document.getElementById('pct-residential').value = preset.pctResidential;
  document.getElementById('household-size').value = preset.householdSize;
  document.getElementById('occupancy').value = preset.occupancy;
  document.getElementById('sqm-per-household').value =
    preset.sqmPerHousehold ?? 70;
  document.getElementById('pct-mapped').value = preset.pctMapped;

  const hint = document.getElementById('household-size-hint');
  if (hint) {
    if (preset.id === 'custom' || !preset.householdSizeYear) {
      hint.textContent = '';
    } else {
      hint.textContent = `UN average household size (${preset.householdSizeYear}).`;
    }
  }
}

/** Read the current estimate parameters from the form. */
export function readParams() {
  return {
    pctResidential: numberValue('pct-residential'),
    householdSize: numberValue('household-size'),
    occupancy: numberValue('occupancy'),
    sqmPerHousehold: numberValue('sqm-per-household'),
    pctMapped: numberValue('pct-mapped'),
  };
}

function numberValue(elementId) {
  return Number(document.getElementById(elementId).value);
}

/**
 * Show a short status message under the stats.
 * @param {string} message
 * @param {'' | 'error' | 'loading'} [kind]
 * @param {{ showRetry?: boolean }} [options]
 */
export function setStatus(message, kind = '', options = {}) {
  const statusElement = document.getElementById('status');
  const retryButton = document.getElementById('retry-overpass');
  statusElement.textContent = message ?? '';
  statusElement.classList.remove('is-error', 'is-loading');
  if (kind) statusElement.classList.add(`is-${kind}`);
  if (retryButton) {
    retryButton.hidden = !options.showRetry;
  }
}

/** Hide the Overpass retry control. */
export function hideRetry() {
  const retryButton = document.getElementById('retry-overpass');
  if (retryButton) retryButton.hidden = true;
}

/**
 * Update all statistic readouts in the panel.
 * @param {{
 *   population: number | null,
 *   counts: object | null,
 *   areaKm2: number | null,
 *   compare?: {
 *     population?: number | null,
 *     ratio?: number | null,
 *     label?: string,
 *     loading?: boolean,
 *     error?: string | null,
 *     hidden?: boolean
 *   } | null
 * }} stats
 */
export function renderStats({ population, counts, areaKm2, compare }) {
  setText('stat-population', formatNumber(population));
  setText('stat-buildings', formatNumber(counts?.total));
  setText('stat-houses', formatNumber(counts?.houses));
  setText('stat-apartments', formatNumber(counts?.apartments));
  setText('stat-commercial', formatNumber(counts?.commercial));
  setText('stat-other', formatNumber(counts?.other));
  setText(
    'stat-area',
    areaKm2 == null ? '—' : `${areaKm2.toFixed(2)} km²`
  );

  if (compare !== undefined) {
    renderCompareStats(compare);
  }
}

/**
 * @param {{
 *   population?: number | null,
 *   ratio?: number | null,
 *   label?: string,
 *   loading?: boolean,
 *   error?: string | null,
 *   hidden?: boolean
 * } | null} compare
 */
export function renderCompareStats(compare) {
  const compareStats = document.getElementById('compare-stats');
  if (!compareStats) return;

  if (compare?.hidden) {
    compareStats.hidden = true;
    return;
  }
  compareStats.hidden = false;

  const label = document.getElementById('stat-compare-label');
  if (label) {
    label.textContent = compare?.label || 'Reference';
  }

  if (compare?.loading) {
    setText('stat-compare-population', '…');
    setText('stat-compare-ratio', '…');
    return;
  }

  if (compare?.error) {
    setText('stat-compare-population', '—');
    setText('stat-compare-ratio', '—');
    return;
  }

  setText('stat-compare-population', formatNumber(compare?.population));
  setText('stat-compare-ratio', formatRatio(compare?.ratio));
}

function formatRatio(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(2)}×`;
}

function setText(elementId, value) {
  document.getElementById(elementId).textContent = value ?? '—';
}

function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US').format(value);
}
