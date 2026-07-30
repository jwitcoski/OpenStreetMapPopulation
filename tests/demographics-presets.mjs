/*
 * Verify UN DESA country household-size presets.
 * Run: node tests/demographics-presets.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(
  readFileSync(path.join(root, 'public/demographics.json'), 'utf8')
);

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
}

assert(data.source?.url, 'missing source.url');
assert(data.source?.dataset, 'missing source.dataset (Excel URL)');
assert(Array.isArray(data.presets), 'presets must be an array');

const countries = data.presets.filter((preset) => preset.id !== 'custom');
assert(countries.length >= 180, `expected ~world list, got ${countries.length}`);
assert(data.presets.at(-1)?.id === 'custom', 'Custom should be last');

const byId = Object.fromEntries(data.presets.map((p) => [p.id, p]));
for (const id of [
  'united-states',
  'germany',
  'india',
  'nigeria',
  'brazil',
  'japan',
  'china',
  'australia',
  'egypt',
  'mexico',
]) {
  assert(byId[id], `missing preset ${id}`);
  assert(byId[id].householdSize > 1, `${id} householdSize`);
}

assert(byId['united-states'].householdSize === 2.49, 'US household size');
assert(byId.germany.householdSize === 2.14, 'Germany household size');
assert(byId.india.householdSize === 4.42, 'India household size');
assert(byId.nigeria.householdSize === 5.37, 'Nigeria household size');
assert(data.defaultPresetId === 'united-states', 'default preset');

for (const preset of countries) {
  assert(preset.householdSize > 0, `${preset.id} householdSize`);
  assert(preset.householdSizeYear, `${preset.id} year`);
  assert(preset.occupancy > 0 && preset.occupancy <= 100, `${preset.id} occupancy`);
  assert(preset.apartmentPop > 0, `${preset.id} apartmentPop`);
}

console.log('PASS demographics presets', {
  countries: countries.length,
  source: data.source.label,
  sample: ['united-states', 'india', 'nigeria', 'japan'].map((id) => ({
    id,
    householdSize: byId[id].householdSize,
  })),
});
