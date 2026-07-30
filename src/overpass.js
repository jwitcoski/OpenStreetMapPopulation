import { APARTMENT_TYPES, COMMERCIAL_TYPES, HOUSE_TYPES, OVERPASS_URL } from './config.js';

/**
 * Convert a GeoJSON polygon to an Overpass poly:"lat lon ..." string.
 */
export function polygonToOverpassPoly(geometry) {
  const ring = geometry.coordinates[0];
  return ring.map(([lon, lat]) => `${lat} ${lon}`).join(' ');
}

/**
 * Query Overpass for building ways/relations inside a polygon.
 */
export async function fetchBuildingsInPolygon(geometry, { signal } = {}) {
  const poly = polygonToOverpassPoly(geometry);
  const query = `
[out:json][timeout:60];
(
  way["building"](poly:"${poly}");
  relation["building"](poly:"${poly}");
);
out tags center;
`.trim();

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
  if (data.remark) {
    throw new Error(data.remark);
  }

  return classifyBuildings(data.elements ?? []);
}

export function classifyBuildings(elements) {
  const counts = {
    total: 0,
    houses: 0,
    apartments: 0,
    commercial: 0,
    other: 0,
  };

  for (const element of elements) {
    const type = String(element.tags?.building ?? '').toLowerCase();
    if (!type) continue;

    counts.total += 1;

    if (HOUSE_TYPES.has(type)) {
      counts.houses += 1;
    } else if (APARTMENT_TYPES.has(type)) {
      counts.apartments += 1;
    } else if (COMMERCIAL_TYPES.has(type)) {
      counts.commercial += 1;
    } else {
      // building=yes and uncommon tags — apply residential % in the estimate.
      counts.other += 1;
    }
  }

  return counts;
}
