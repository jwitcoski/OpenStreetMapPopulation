/**
 * Estimate population from classified building counts and form parameters.
 *
 * estimate =
 *   (apartments * peoplePerApartment
 *    + (houses + other * residentialFraction) * occupancy * householdSize)
 *   * mappedFraction
 */
export function estimatePopulation(counts, params) {
  const residentialFraction = clamp(params.pctResidential, 0, 100) / 100;
  const occupancy = clamp(params.occupancy, 0, 100) / 100;
  const mapped = clamp(params.pctMapped, 1, 100) / 100;
  const householdSize = Math.max(0, params.householdSize);
  const apartmentPop = Math.max(0, params.apartmentPop);

  const houseLike =
    counts.houses + counts.other * residentialFraction;

  const raw =
    counts.apartments * apartmentPop +
    houseLike * occupancy * householdSize;

  return Math.round(raw * mapped);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
