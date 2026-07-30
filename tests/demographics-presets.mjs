/*
 * Verify demographic presets load with UN country household sizes.
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
assert(Array.isArray(data.presets), 'presets must be an array');

const ids = data.presets.map((p) => p.id);
const expected = [
  'united-states',
  'germany',
  'france',
  'belgium',
  'switzerland',
  'denmark',
  'united-kingdom',
  'custom',
];

for (const id of expected) {
  assert(ids.includes(id), `missing preset ${id}`);
}

const byId = Object.fromEntries(data.presets.map((p) => [p.id, p]));

assert(byId['united-states'].householdSize === 2.49, 'US household size');
assert(byId.germany.householdSize === 2.14, 'Germany household size');
assert(byId.france.householdSize === 2.22, 'France household size');
assert(byId.belgium.householdSize === 2.32, 'Belgium household size');
assert(byId.switzerland.householdSize === 2.24, 'Switzerland household size');
assert(byId.denmark.householdSize === 1.83, 'Denmark household size');
assert(byId['united-kingdom'].householdSize === 2.35, 'UK household size');

for (const preset of data.presets) {
  assert(preset.householdSize > 0, `${preset.id} householdSize`);
  assert(preset.occupancy > 0 && preset.occupancy <= 100, `${preset.id} occupancy`);
  assert(preset.apartmentPop > 0, `${preset.id} apartmentPop`);
  assert(preset.pctResidential >= 0 && preset.pctResidential <= 100, `${preset.id} pctResidential`);
  assert(preset.pctMapped >= 1 && preset.pctMapped <= 100, `${preset.id} pctMapped`);
}

console.log('PASS demographics presets', {
  countries: ids.filter((id) => id !== 'custom'),
  source: data.source.label,
});
