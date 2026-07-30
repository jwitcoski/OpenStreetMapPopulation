/*
 * classify-buildings.js
 * Turns raw Overpass building elements into counts + per-building records.
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
 * @typedef {'houses' | 'apartments' | 'commercial' | 'other'} BuildingCategory
 *
 * @typedef {object} BuildingCounts
 * @property {number} total
 * @property {number} houses
 * @property {number} apartments
 * @property {number} commercial
 * @property {number} other
 *
 * @typedef {object} BuildingRecord
 * @property {BuildingCategory} category
 * @property {string} buildingType
 * @property {number} longitude
 * @property {number} latitude
 */

/**
 * Classify Overpass elements and keep centers for the heatmap.
 * @param {Array<object>} elements
 * @returns {{ counts: BuildingCounts, buildings: BuildingRecord[] }}
 */
export function classifyBuildings(elements) {
  const counts = {
    total: 0,
    houses: 0,
    apartments: 0,
    commercial: 0,
    other: 0,
  };
  const buildings = [];

  for (const element of elements) {
    const buildingType = String(element.tags?.building ?? '').toLowerCase();
    if (!buildingType) continue;

    /** @type {BuildingCategory} */
    let category;
    if (HOUSE_TYPES.has(buildingType)) {
      category = 'houses';
      counts.houses += 1;
    } else if (APARTMENT_TYPES.has(buildingType)) {
      category = 'apartments';
      counts.apartments += 1;
    } else if (COMMERCIAL_TYPES.has(buildingType)) {
      category = 'commercial';
      counts.commercial += 1;
    } else {
      category = 'other';
      counts.other += 1;
    }

    counts.total += 1;

    const center = element.center;
    if (center?.lon == null || center?.lat == null) continue;

    buildings.push({
      category,
      buildingType,
      longitude: center.lon,
      latitude: center.lat,
    });
  }

  return { counts, buildings };
}
