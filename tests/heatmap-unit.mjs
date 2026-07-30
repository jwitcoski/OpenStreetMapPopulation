/*
 * Unit checks for apartment unit estimation + heatmap weighting.
 * Run: node tests/heatmap-unit.mjs
 */

import { classifyBuildings } from '../scripts/classify-buildings.js';
import {
  peopleForBuilding,
  estimatePopulation,
  estimateApartmentUnits,
} from '../scripts/population.js';
import { buildingsToHeatFeatures } from '../scripts/heatmap.js';

const params = {
  pctResidential: 80,
  householdSize: 2.5,
  occupancy: 90,
  sqmPerHousehold: 70,
  pctMapped: 100,
};

// ~10m x 10m square ≈ 100 m² footprint near equator-ish test coords
const squareGeom = [
  { lon: -77.03, lat: 38.89 },
  { lon: -77.0299, lat: 38.89 },
  { lon: -77.0299, lat: 38.8901 },
  { lon: -77.03, lat: 38.8901 },
  { lon: -77.03, lat: 38.89 },
];

const elements = [
  {
    type: 'way',
    tags: { building: 'house' },
    center: { lon: -77.03, lat: 38.89 },
    geometry: squareGeom,
  },
  {
    type: 'way',
    tags: { building: 'apartments', 'building:levels': '4' },
    center: { lon: -77.031, lat: 38.891 },
    geometry: squareGeom,
  },
  {
    type: 'way',
    tags: { building: 'apartments', 'building:flats': '12' },
    center: { lon: -77.0315, lat: 38.8915 },
    geometry: squareGeom,
  },
  {
    type: 'way',
    tags: { building: 'apartments', 'building:levels': '3' },
    center: { lon: -77.032, lat: 38.892 },
    // no geometry → levels-only fallback
  },
  {
    type: 'way',
    tags: { building: 'commercial' },
    center: { lon: -77.033, lat: 38.893 },
    geometry: squareGeom,
  },
  {
    type: 'way',
    tags: { building: 'yes' },
    center: { lon: -77.034, lat: 38.894 },
    geometry: squareGeom,
  },
];

const { counts, buildings } = classifyBuildings(elements);

assert(counts.total === 6, `expected 6 buildings, got ${counts.total}`);
assert(counts.apartments === 3, `expected 3 apartments, got ${counts.apartments}`);
assert(buildings.length === 6, `expected 6 records, got ${buildings.length}`);

const aptWithLevels = buildings.find(
  (b) => b.buildingType === 'apartments' && b.levels === 4 && b.flats == null
);
const aptWithFlats = buildings.find((b) => b.flats === 12);
const aptLevelsOnly = buildings.find(
  (b) => b.buildingType === 'apartments' && b.levels === 3 && b.footprintAreaM2 == null
);

assert(aptWithLevels, 'levels+area apartment');
assert(aptWithFlats, 'flats apartment');
assert(aptLevelsOnly, 'levels-only apartment');
assert(aptWithLevels.footprintAreaM2 > 50, 'footprint should be computed');

const unitsFromArea = estimateApartmentUnits(aptWithLevels, params);
const expectedUnits = Math.max(
  1,
  Math.round((aptWithLevels.footprintAreaM2 * 4) / 70)
);
assert(
  unitsFromArea === expectedUnits,
  `area units ${unitsFromArea} !== ${expectedUnits}`
);
assert(estimateApartmentUnits(aptWithFlats, params) === 12, 'flats win');
assert(estimateApartmentUnits(aptLevelsOnly, params) === 3, 'levels fallback');

const house = buildings.find((b) => b.category === 'houses');
const commercial = buildings.find((b) => b.category === 'commercial');

assert(
  peopleForBuilding(house, params) === 2.5 * 0.9,
  `house weight ${peopleForBuilding(house, params)}`
);
assert(peopleForBuilding(commercial, params) === 0, 'commercial weight 0');

const aptWeight = peopleForBuilding(aptWithFlats, params);
assert(
  aptWeight === 12 * 0.9 * 2.5,
  `flat-based apt weight ${aptWeight}`
);

const heat = buildingsToHeatFeatures(buildings, params);
assert(
  heat.features.length === 5,
  `heat features exclude commercial, got ${heat.features.length}`
);

const population = estimatePopulation(buildings, params);
const weightSum = heat.features.reduce((sum, f) => sum + f.properties.weight, 0);
assert(
  Math.round(weightSum) === population,
  `weight sum ${weightSum} should match population ${population}`
);

console.log('PASS heatmap unit checks', {
  counts,
  population,
  weightSum,
  heatPoints: heat.features.length,
  unitsFromArea,
});

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
}
