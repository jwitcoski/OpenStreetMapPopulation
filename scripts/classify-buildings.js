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

import area from '@turf/area';
import { polygon } from '@turf/helpers';
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
 * @property {number | null} levels
 * @property {number | null} flats
 * @property {number | null} footprintAreaM2
 */

/**
 * Classify Overpass elements and keep centers / size cues for estimates.
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

    // Overpass `out geom` returns geometry/bounds but omits `center`.
    // Derive a point so population + heatmap still work.
    const center = resolveBuildingCenter(element);
    if (center?.lon == null || center?.lat == null) continue;

    buildings.push({
      category,
      buildingType,
      longitude: center.lon,
      latitude: center.lat,
      levels: parseBuildingLevels(element.tags),
      flats: parseBuildingFlats(element.tags),
      footprintAreaM2: footprintAreaFromElement(element),
    });
  }

  return { counts, buildings };
}

/**
 * Prefer Overpass `center`, else bounds midpoint, else geometry centroid.
 * @param {object} element
 * @returns {{ lon: number, lat: number } | null}
 */
export function resolveBuildingCenter(element) {
  const provided = element?.center;
  if (provided?.lon != null && provided?.lat != null) {
    const lon = Number(provided.lon);
    const lat = Number(provided.lat);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return { lon, lat };
    }
  }

  const bounds = element?.bounds;
  if (
    bounds &&
    bounds.minlon != null &&
    bounds.minlat != null &&
    bounds.maxlon != null &&
    bounds.maxlat != null
  ) {
    const lon = (Number(bounds.minlon) + Number(bounds.maxlon)) / 2;
    const lat = (Number(bounds.minlat) + Number(bounds.maxlat)) / 2;
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return { lon, lat };
    }
  }

  const ring = ringFromElement(element);
  if (!ring || ring.length < 3) return null;

  // Average ring vertices (skip duplicate closing point when present).
  const last = ring[ring.length - 1];
  const first = ring[0];
  const open =
    first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
  if (!open.length) return null;

  let sumLon = 0;
  let sumLat = 0;
  for (const [lon, lat] of open) {
    sumLon += lon;
    sumLat += lat;
  }
  return { lon: sumLon / open.length, lat: sumLat / open.length };
}

/**
 * Read building:levels (above-ground storeys). Returns null if untagged.
 * @param {Record<string, string> | undefined} tags
 * @returns {number | null}
 */
export function parseBuildingLevels(tags) {
  const raw = tags?.['building:levels'];
  if (raw == null || raw === '') return null;
  // OSM sometimes uses "3;4" or "2.5" — take the first finite number.
  const match = String(raw).match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * Read building:flats (explicit dwelling count) when mapped.
 * @param {Record<string, string> | undefined} tags
 * @returns {number | null}
 */
export function parseBuildingFlats(tags) {
  const raw = tags?.['building:flats'] ?? tags?.flats;
  if (raw == null || raw === '') return null;
  const match = String(raw).match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * Footprint area in m² from Overpass `out geom` coordinates.
 * Ways are supported; relations without a usable outer ring return null.
 * @param {object} element
 * @returns {number | null}
 */
export function footprintAreaFromElement(element) {
  const ring = ringFromElement(element);
  if (!ring || ring.length < 4) return null;

  try {
    const sqm = area(polygon([ring]));
    if (!Number.isFinite(sqm) || sqm <= 0) return null;
    return sqm;
  } catch {
    return null;
  }
}

/**
 * @param {object} element
 * @returns {number[][] | null} closed [lon, lat] ring
 */
function ringFromElement(element) {
  if (Array.isArray(element.geometry) && element.geometry.length >= 3) {
    return closeRing(
      element.geometry.map((node) => [Number(node.lon), Number(node.lat)])
    );
  }

  // Multipolygon relations: use the longest outer member ring when present.
  if (element.type === 'relation' && Array.isArray(element.members)) {
    let best = null;
    for (const member of element.members) {
      if (member?.role && member.role !== 'outer') continue;
      if (!Array.isArray(member.geometry) || member.geometry.length < 3) continue;
      const ring = closeRing(
        member.geometry.map((node) => [Number(node.lon), Number(node.lat)])
      );
      if (!best || ring.length > best.length) best = ring;
    }
    return best;
  }

  return null;
}

function closeRing(ring) {
  const cleaned = ring.filter(
    ([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat)
  );
  if (cleaned.length < 3) return null;
  const first = cleaned[0];
  const last = cleaned[cleaned.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    cleaned.push([first[0], first[1]]);
  }
  return cleaned;
}
