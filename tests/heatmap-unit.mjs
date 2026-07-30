/*
 * Unit checks for heatmap weighting (no browser required).
 * Run: node tests/heatmap-unit.mjs
 */

import { classifyBuildings } from '../scripts/classify-buildings.js';
import { peopleForBuilding, estimatePopulation } from '../scripts/population.js';
import { buildingsToHeatFeatures } from '../scripts/heatmap.js';

const params = {
  pctResidential: 80,
  householdSize: 2.5,
  occupancy: 90,
  apartmentPop: 40,
  pctMapped: 100,
};

const elements = [
  { tags: { building: 'house' }, center: { lon: -77.03, lat: 38.89 } },
  { tags: { building: 'apartments' }, center: { lon: -77.031, lat: 38.891 } },
  { tags: { building: 'commercial' }, center: { lon: -77.032, lat: 38.892 } },
  { tags: { building: 'yes' }, center: { lon: -77.033, lat: 38.893 } },
  { tags: { building: 'house' } }, // no center — skipped for heatmap, still counted? 
];

// Buildings without center are skipped entirely in classify now.
// Keep a centered-only set for count/heatmap consistency.
const centered = elements.filter((e) => e.center);
const { counts, buildings } = classifyBuildings(centered);

assert(counts.total === 4, `expected 4 buildings, got ${counts.total}`);
assert(buildings.length === 4, `expected 4 records, got ${buildings.length}`);
assert(counts.commercial === 1, 'commercial count');

const houseWeight = peopleForBuilding('houses', params);
const aptWeight = peopleForBuilding('apartments', params);
const commercialWeight = peopleForBuilding('commercial', params);

assert(houseWeight === 2.5 * 0.9, `house weight ${houseWeight}`);
assert(aptWeight === 40, `apt weight ${aptWeight}`);
assert(commercialWeight === 0, 'commercial weight should be 0');

const heat = buildingsToHeatFeatures(buildings, params);
assert(heat.features.length === 3, `heat features exclude commercial, got ${heat.features.length}`);
assert(
  heat.features.every((f) => f.properties.weight > 0),
  'all heat points need positive weight'
);

const population = estimatePopulation(counts, params);
const weightSum = heat.features.reduce((sum, f) => sum + f.properties.weight, 0);
// commercial excluded from both; other contributes 80% of a house
assert(
  Math.round(weightSum) === population,
  `weight sum ${weightSum} should match population ${population}`
);

console.log('PASS heatmap unit checks', { counts, population, weightSum, heatPoints: heat.features.length });

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
}
