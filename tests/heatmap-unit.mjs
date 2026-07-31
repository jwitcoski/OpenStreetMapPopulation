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
  // Real Overpass `out geom` shape: geometry + bounds, no center.
  {
    type: 'way',
    id: 999001,
    tags: { building: 'house' },
    bounds: {
      minlat: 38.895,
      minlon: -77.035,
      maxlat: 38.8951,
      maxlon: -77.0349,
    },
    geometry: [
      { lon: -77.035, lat: 38.895 },
      { lon: -77.0349, lat: 38.895 },
      { lon: -77.0349, lat: 38.8951 },
      { lon: -77.035, lat: 38.8951 },
      { lon: -77.035, lat: 38.895 },
    ],
  },
  // Geometry only (no center / bounds) — still need a heatmap point.
  {
    type: 'way',
    id: 999002,
    tags: { building: 'house' },
    geometry: [
      { lon: -77.036, lat: 38.896 },
      { lon: -77.0359, lat: 38.896 },
      { lon: -77.0359, lat: 38.8961 },
      { lon: -77.036, lat: 38.8961 },
      { lon: -77.036, lat: 38.896 },
    ],
  },
];

const { counts, buildings } = classifyBuildings(elements);

assert(counts.total === 8, `expected 8 buildings, got ${counts.total}`);
assert(counts.apartments === 3, `expected 3 apartments, got ${counts.apartments}`);
assert(counts.houses === 3, `expected 3 houses, got ${counts.houses}`);
assert(buildings.length === 8, `expected 8 records, got ${buildings.length}`);

const geomOnlyHouse = buildings.find(
  (b) => b.buildingType === 'house' && b.longitude === -77.03495
);
assert(geomOnlyHouse, 'bounds-derived center house missing');
assert(
  Math.abs(geomOnlyHouse.latitude - 38.89505) < 1e-9,
  `bounds center lat ${geomOnlyHouse.latitude}`
);

const ringOnlyHouse = buildings.find(
  (b) =>
    b.buildingType === 'house' &&
    Math.abs(b.longitude - -77.03595) < 1e-9
);
assert(ringOnlyHouse, 'geometry-derived center house missing');

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
  heat.features.length === 7,
  `heat features exclude commercial, got ${heat.features.length}`
);

const population = estimatePopulation(buildings, params);
assert(population > 0, `population should be > 0, got ${population}`);
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
