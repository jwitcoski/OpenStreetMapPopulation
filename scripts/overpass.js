/*
 * overpass.js
 * Talks to the Overpass API: turn a drawn polygon into OSM building results.
 */

import { OVERPASS_URL } from './config.js';
import { classifyBuildings } from './classify-buildings.js';

/**
 * Convert a GeoJSON polygon into Overpass poly:"lat lon lat lon ..." syntax.
 * Overpass expects latitude first (opposite of GeoJSON).
 */
export function polygonToOverpassPoly(geometry) {
  const ring = geometry.coordinates[0];
  return ring.map(([longitude, latitude]) => `${latitude} ${longitude}`).join(' ');
}

/**
 * Build the Overpass QL query that selects buildings inside a polygon.
 */
function buildBuildingsQuery(polyString) {
  return `
[out:json][timeout:60];
(
  way["building"](poly:"${polyString}");
  relation["building"](poly:"${polyString}");
);
out tags center;
`.trim();
}

/**
 * Fetch OSM buildings inside a GeoJSON polygon.
 * Returns classified counts plus per-building centers for the heatmap.
 * @param {object} geometry - GeoJSON Polygon geometry
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ counts: object, buildings: object[] }>}
 */
export async function fetchBuildingsInPolygon(geometry, { signal } = {}) {
  const polyString = polygonToOverpassPoly(geometry);
  const query = buildBuildingsQuery(polyString);

  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: `data=${encodeURIComponent(query)}`,
    signal,
  });

  if (!response.ok) {
    throw new Error(`Overpass request failed (${response.status})`);
  }

  const data = await response.json();

  // Overpass sometimes returns 200 with a remark when it timed out or ran out of memory.
  if (data.remark) {
    throw new Error(data.remark);
  }

  return classifyBuildings(data.elements ?? []);
}
