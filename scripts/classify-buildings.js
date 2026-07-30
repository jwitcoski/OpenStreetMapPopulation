/*
 * classify-buildings.js
 * Turns raw Overpass building elements into simple type counts.
 *
 * Categories:
 *   houses      — single-family / house-like tags
 *   apartments  — multi-unit residential tags
 *   commercial  — shops, industry, schools, etc. (not used in population)
 *   other       — building=yes and uncommon tags (partially residential via %)
 */

import {
  APARTMENT_TYPES,
  COMMERCIAL_TYPES,
  HOUSE_TYPES,
} from './config.js';

/**
 * @typedef {object} BuildingCounts
 * @property {number} total
 * @property {number} houses
 * @property {number} apartments
 * @property {number} commercial
 * @property {number} other
 */

/**
 * Classify an array of Overpass elements by their building=* tag.
 * @param {Array<{ tags?: Record<string, string> }>} elements
 * @returns {BuildingCounts}
 */
export function classifyBuildings(elements) {
  const counts = {
    total: 0,
    houses: 0,
    apartments: 0,
    commercial: 0,
    other: 0,
  };

  for (const element of elements) {
    const buildingType = String(element.tags?.building ?? '').toLowerCase();
    if (!buildingType) continue;

    counts.total += 1;

    if (HOUSE_TYPES.has(buildingType)) {
      counts.houses += 1;
    } else if (APARTMENT_TYPES.has(buildingType)) {
      counts.apartments += 1;
    } else if (COMMERCIAL_TYPES.has(buildingType)) {
      counts.commercial += 1;
    } else {
      // Ambiguous tags (often building=yes) — residential % applied later.
      counts.other += 1;
    }
  }

  return counts;
}
