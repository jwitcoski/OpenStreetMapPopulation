/*
 * population.js
 * Pure math: building counts + form parameters → population estimate.
 *
 * Formula:
 *   apartments × peoplePerApartment
 *   + (houses + other × residential%) × occupancy × householdSize
 *   then multiply by mapped%
 */

/**
 * @param {import('./classify-buildings.js').BuildingCounts} counts
 * @param {{
 *   pctResidential: number,
 *   householdSize: number,
 *   occupancy: number,
 *   apartmentPop: number,
 *   pctMapped: number
 * }} params
 * @returns {number} rounded whole-person estimate
 */
export function estimatePopulation(counts, params) {
  const residentialFraction = clamp(params.pctResidential, 0, 100) / 100;
  const occupancyFraction = clamp(params.occupancy, 0, 100) / 100;
  const mappedFraction = clamp(params.pctMapped, 1, 100) / 100;
  const householdSize = Math.max(0, params.householdSize);
  const peoplePerApartment = Math.max(0, params.apartmentPop);

  const houseLikeUnits =
    counts.houses + counts.other * residentialFraction;

  const rawPopulation =
    counts.apartments * peoplePerApartment +
    houseLikeUnits * occupancyFraction * householdSize;

  return Math.round(rawPopulation * mappedFraction);
}

/** Keep a number inside [min, max]. */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
