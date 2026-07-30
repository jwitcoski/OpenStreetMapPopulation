export async function loadPresets() {
  const response = await fetch(
    `${import.meta.env.BASE_URL}demographics.json`
  );
  if (!response.ok) {
    throw new Error('Could not load demographics presets');
  }
  return response.json();
}

export function initPanel(presets, { onParamsChange }) {
  const presetSelect = document.getElementById('preset');
  const form = document.getElementById('params-form');

  presetSelect.innerHTML = presets
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join('');

  applyPreset(presets[0]);

  presetSelect.addEventListener('change', () => {
    const preset = presets.find((p) => p.id === presetSelect.value);
    if (preset) {
      applyPreset(preset);
      onParamsChange(readParams());
    }
  });

  form.addEventListener('input', () => {
    onParamsChange(readParams());
  });

  return { readParams, setStatus, renderStats };
}

function applyPreset(preset) {
  document.getElementById('pct-residential').value = preset.pctResidential;
  document.getElementById('household-size').value = preset.householdSize;
  document.getElementById('occupancy').value = preset.occupancy;
  document.getElementById('apartment-pop').value = preset.apartmentPop;
  document.getElementById('pct-mapped').value = preset.pctMapped;
}

export function readParams() {
  return {
    pctResidential: numberValue('pct-residential'),
    householdSize: numberValue('household-size'),
    occupancy: numberValue('occupancy'),
    apartmentPop: numberValue('apartment-pop'),
    pctMapped: numberValue('pct-mapped'),
  };
}

function numberValue(id) {
  return Number(document.getElementById(id).value);
}

export function setStatus(message, kind = '') {
  const el = document.getElementById('status');
  el.textContent = message ?? '';
  el.classList.remove('is-error', 'is-loading');
  if (kind) el.classList.add(`is-${kind}`);
}

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

function setText(id, value) {
  document.getElementById(id).textContent = value ?? '—';
}

function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US').format(value);
}
