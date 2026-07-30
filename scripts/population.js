/*
 * population.js
 * Pure math: building counts / records + form parameters → population.
 *
 * Formula:
 *   apartments × peoplePerApartment
 *   + (houses + other × residential%) × occupancy × householdSize
 *   then multiply by mapped%
 */

/**
 * @param {import('./classify-buildings.js').BuildingCounts} counts
 * @param {EstimateParams} params
 * @returns {number} rounded whole-person estimate
 */
export function estimatePopulation(counts, params) {
  const factors = getPopulationFactors(params);

  const houseLikeUnits =
    counts.houses + counts.other * factors.residentialFraction;

  const rawPopulation =
    counts.apartments * factors.peoplePerApartment +
    houseLikeUnits * factors.occupancyFraction * factors.householdSize;

  return Math.round(rawPopulation * factors.mappedFraction);
}

/**
 * Estimated people contributed by one building (for heatmap weighting).
 * @param {import('./classify-buildings.js').BuildingCategory} category
 * @param {EstimateParams} params
 * @returns {number}
 */
export function peopleForBuilding(category, params) {
  const factors = getPopulationFactors(params);

  let raw = 0;
  if (category === 'apartments') {
    raw = factors.peoplePerApartment;
  } else if (category === 'houses') {
    raw = factors.householdSize * factors.occupancyFraction;
  } else if (category === 'other') {
    raw =
      factors.householdSize *
      factors.occupancyFraction *
      factors.residentialFraction;
  }

  return raw * factors.mappedFraction;
}

/**
 * @typedef {{
 *   pctResidential: number,
 *   householdSize: number,
 *   occupancy: number,
 *   apartmentPop: number,
 *   pctMapped: number
 * }} EstimateParams
 */

function getPopulationFactors(params) {
  return {
    residentialFraction: clamp(params.pctResidential, 0, 100) / 100,
    occupancyFraction: clamp(params.occupancy, 0, 100) / 100,
    mappedFraction: clamp(params.pctMapped, 1, 100) / 100,
    householdSize: Math.max(0, params.householdSize),
    peoplePerApartment: Math.max(0, params.apartmentPop),
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
