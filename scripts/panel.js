/*
 * panel.js
 * Reads and updates the side panel DOM (stats, status, form fields).
 * No map or Overpass logic lives here.
 */

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
  };
}

/**
 * Wire up the preset dropdown and form inputs.
 * Calls onParamsChange whenever the user edits a value.
 */
export function initPanel({ source, presets }, { onParamsChange }) {
  const presetSelect = document.getElementById('preset');
  const form = document.getElementById('params-form');
  const sourceNote = document.getElementById('demographics-source');

  if (!presets.length) {
    throw new Error('No demographic presets found');
  }

  presetSelect.innerHTML = presets
    .map((preset) => `<option value="${preset.id}">${preset.name}</option>`)
    .join('');

  if (sourceNote && source?.url) {
    sourceNote.innerHTML = `Household size from <a href="${source.url}" target="_blank" rel="noopener">${source.label || 'UN DESA'}</a>. Other factors are estimation defaults.`;
  }

  applyPreset(presets[0]);

  presetSelect.addEventListener('change', () => {
    const selected = presets.find((preset) => preset.id === presetSelect.value);
    if (!selected) return;
    applyPreset(selected);
    onParamsChange(readParams());
  });

  form.addEventListener('input', () => {
    onParamsChange(readParams());
  });

  return { readParams };
}

/** Copy a preset's numbers into the form fields. */
function applyPreset(preset) {
  document.getElementById('pct-residential').value = preset.pctResidential;
  document.getElementById('household-size').value = preset.householdSize;
  document.getElementById('occupancy').value = preset.occupancy;
  document.getElementById('apartment-pop').value = preset.apartmentPop;
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
    apartmentPop: numberValue('apartment-pop'),
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
 */
export function renderStats({ population, counts, areaKm2 }) {
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
}

function setText(elementId, value) {
  document.getElementById(elementId).textContent = value ?? '—';
}

function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US').format(value);
}
