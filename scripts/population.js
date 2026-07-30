/*
 * population.js
 * Pure math: building records + form parameters → population.
 *
 * Houses / other:
 *   (houses + other × residential%) × occupancy × householdSize
 *
 * Apartments (per building):
 *   units × occupancy × householdSize
 *   where units prefer building:flats; else (footprint m² × levels) /
 *   m²-per-household; else levels (default 1).
 *
 * Then multiply the total by mapped%.
 */

/**
 * @param {import('./classify-buildings.js').BuildingRecord[]} buildings
 * @param {EstimateParams} params
 * @returns {number} rounded whole-person estimate
 */
export function estimatePopulation(buildings, params) {
  const factors = getPopulationFactors(params);
  let rawPopulation = 0;

  for (const building of buildings) {
    rawPopulation += rawPeopleForBuilding(building, factors);
  }

  return Math.round(rawPopulation * factors.mappedFraction);
}

/**
 * Estimated people contributed by one building (for heatmap weighting).
 * @param {import('./classify-buildings.js').BuildingRecord} building
 * @param {EstimateParams} params
 * @returns {number}
 */
export function peopleForBuilding(building, params) {
  const factors = getPopulationFactors(params);
  return rawPeopleForBuilding(building, factors) * factors.mappedFraction;
}

/**
 * Dwelling-unit count for an apartment-like building.
 * @param {import('./classify-buildings.js').BuildingRecord} building
 * @param {Pick<EstimateParams, 'sqmPerHousehold'>} params
 * @returns {number}
 */
export function estimateApartmentUnits(building, params) {
  if (building.flats != null && building.flats > 0) {
    return Math.max(1, Math.round(building.flats));
  }

  const levels =
    building.levels != null && building.levels > 0 ? building.levels : 1;
  const sqmPerHousehold = Math.max(1, Number(params.sqmPerHousehold) || 1);

  if (building.footprintAreaM2 != null && building.footprintAreaM2 > 0) {
    const floorspaceM2 = building.footprintAreaM2 * levels;
    return Math.max(1, Math.round(floorspaceM2 / sqmPerHousehold));
  }

  // No footprint: treat each above-ground level as one unit (assume 1 if untagged).
  return Math.max(1, Math.round(levels));
}

/**
 * @typedef {{
 *   pctResidential: number,
 *   householdSize: number,
 *   occupancy: number,
 *   sqmPerHousehold: number,
 *   pctMapped: number
 * }} EstimateParams
 */

function rawPeopleForBuilding(building, factors) {
  if (building.category === 'apartments') {
    const units = estimateApartmentUnits(building, {
      sqmPerHousehold: factors.sqmPerHousehold,
    });
    return units * factors.occupancyFraction * factors.householdSize;
  }

  if (building.category === 'houses') {
    return factors.householdSize * factors.occupancyFraction;
  }

  if (building.category === 'other') {
    return (
      factors.householdSize *
      factors.occupancyFraction *
      factors.residentialFraction
    );
  }

  return 0;
}

function getPopulationFactors(params) {
  return {
    residentialFraction: clamp(params.pctResidential, 0, 100) / 100,
    occupancyFraction: clamp(params.occupancy, 0, 100) / 100,
    mappedFraction: clamp(params.pctMapped, 1, 100) / 100,
    householdSize: Math.max(0, params.householdSize),
    sqmPerHousehold: Math.max(1, params.sqmPerHousehold),
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
