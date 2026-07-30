/*
 * compare-population.js
 * Fetch reference population for a drawn polygon from WorldPop or GHS-POP.
 *
 * WorldPop: ArcGIS ImageServer computeStatisticsHistograms (browser CORS).
 * GHS-POP: JRC GeoServer WCS GeoTIFF + in-browser sum (CORS *).
 */

import { fromArrayBuffer } from 'geotiff';

/** @typedef {'worldpop' | 'ghs-pop' | 'none'} CompareDatasetId */

/**
 * @typedef {{
 *   id: CompareDatasetId,
 *   label: string,
 *   year: number | null,
 *   resolutionNote: string,
 *   creditHtml: string
 * }} CompareDataset
 */

/** Datasets offered in the Compare-with control. */
export const COMPARE_DATASETS = /** @type {const} */ ([
  {
    id: 'worldpop',
    label: 'WorldPop (2020, ~100 m)',
    year: 2020,
    resolutionNote: '~100 m',
    creditHtml:
      '<a href="https://www.worldpop.org/" target="_blank" rel="noopener">WorldPop</a>',
  },
  {
    id: 'ghs-pop',
    label: 'GHS-POP (2025, ~100 m)',
    year: 2025,
    resolutionNote: '~100 m (3″)',
    creditHtml:
      '<a href="https://ghsl.jrc.ec.europa.eu/ghs_pop2023.php" target="_blank" rel="noopener">GHS-POP (JRC)</a>',
  },
  {
    id: 'none',
    label: 'Off',
    year: null,
    resolutionNote: '',
    creditHtml: '',
  },
]);

const WORLDPOP_100M =
  'https://worldpop.arcgis.com/arcgis/rest/services/WorldPop_Total_Population_100m/ImageServer';
/** Unix ms for 2020-01-01 — WorldPop mosaic year selector. */
const WORLDPOP_2020_TIME = 1577836800000;

const WORLDPOP_2025_1KM =
  'https://di-worldpop.img.arcgis.com/arcgis/rest/services/WP2_TotalPop_2025/ImageServer';

const GHS_WCS_URL = 'https://geospatial.jrc.ec.europa.eu/geoserver/wcs';
const GHS_COVERAGE_2025_3SS = 'africa_platform__ghsl_pop_2025_3ss';

/**
 * @param {CompareDatasetId} id
 * @returns {CompareDataset}
 */
export function getCompareDataset(id) {
  return (
    COMPARE_DATASETS.find((dataset) => dataset.id === id) || COMPARE_DATASETS[0]
  );
}

/**
 * Sum reference population inside a GeoJSON Polygon.
 * @param {GeoJSON.Polygon} geometry
 * @param {CompareDatasetId} datasetId
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{
 *   population: number,
 *   dataset: CompareDataset,
 *   method: string
 * } | null>}
 */
export async function fetchComparePopulation(
  geometry,
  datasetId,
  options = {}
) {
  if (!geometry || datasetId === 'none') return null;

  if (datasetId === 'worldpop') {
    return fetchWorldPop(geometry, options);
  }
  if (datasetId === 'ghs-pop') {
    return fetchGhsPop(geometry, options);
  }

  throw new Error(`Unknown comparison dataset: ${datasetId}`);
}

/**
 * WorldPop via ArcGIS zonal statistics (100 m / 2020, fallback 1 km / 2025).
 * @param {GeoJSON.Polygon} geometry
 * @param {{ signal?: AbortSignal }} [options]
 */
export async function fetchWorldPop(geometry, options = {}) {
  const dataset = getCompareDataset('worldpop');

  try {
    const population = await arcgisPolygonPopulationSum(
      WORLDPOP_100M,
      geometry,
      { signal: options.signal, time: WORLDPOP_2020_TIME }
    );
    return {
      population: Math.round(population),
      dataset,
      method: 'arcgis-100m-2020',
    };
  } catch (primaryError) {
    if (options.signal?.aborted) throw primaryError;

    const population = await arcgisPolygonPopulationSum(
      WORLDPOP_2025_1KM,
      geometry,
      { signal: options.signal }
    );
    return {
      population: Math.round(population),
      dataset: {
        ...dataset,
        label: 'WorldPop (2025, ~1 km)',
        year: 2025,
        resolutionNote: '~1 km',
      },
      method: 'arcgis-1km-2025-fallback',
    };
  }
}

/**
 * GHS-POP via JRC WCS GeoTIFF subset, summing cells whose centers fall in the polygon.
 * @param {GeoJSON.Polygon} geometry
 * @param {{ signal?: AbortSignal }} [options]
 */
export async function fetchGhsPop(geometry, options = {}) {
  const dataset = getCompareDataset('ghs-pop');
  const bbox = polygonBbox(geometry);
  if (!bbox) throw new Error('Polygon has no coordinates.');

  const [minLon, minLat, maxLon, maxLat] = padBbox(bbox, 0.0005);
  const params = new URLSearchParams({
    service: 'WCS',
    version: '2.0.1',
    request: 'GetCoverage',
    coverageId: GHS_COVERAGE_2025_3SS,
    format: 'image/tiff',
  });
  // Axis subset syntax for GeoServer WCS 2.0
  const url =
    `${GHS_WCS_URL}?${params.toString()}` +
    `&subset=Long(${minLon},${maxLon})` +
    `&subset=Lat(${minLat},${maxLat})`;

  const response = await fetch(url, { signal: options.signal });
  if (!response.ok) {
    throw new Error(`GHS-POP WCS failed (${response.status}).`);
  }

  const contentType = response.headers.get('content-type') || '';
  const buffer = await response.arrayBuffer();
  if (contentType.includes('xml') || contentType.includes('html')) {
    const text = new TextDecoder().decode(buffer.slice(0, 400));
    throw new Error(`GHS-POP WCS error: ${text.slice(0, 160)}`);
  }

  const population = await sumGeoTiffInPolygon(buffer, geometry);
  return {
    population: Math.round(population),
    dataset,
    method: 'jrc-wcs-3ss-2025',
  };
}

/**
 * @param {string} imageServerUrl
 * @param {GeoJSON.Polygon} geometry
 * @param {{ signal?: AbortSignal, time?: number }} [options]
 * @returns {Promise<number>}
 */
export async function arcgisPolygonPopulationSum(
  imageServerUrl,
  geometry,
  options = {}
) {
  const rings = geometryToEsriRings(geometry);
  const body = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({
      rings,
      spatialReference: { wkid: 4326 },
    }),
    geometryType: 'esriGeometryPolygon',
  });
  if (options.time != null) body.set('time', String(options.time));

  const response = await fetch(
    `${imageServerUrl}/computeStatisticsHistograms`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: options.signal,
    }
  );

  if (!response.ok) {
    throw new Error(`WorldPop service failed (${response.status}).`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || 'WorldPop service error.');
  }

  const sum = data?.statistics?.[0]?.sum;
  if (typeof sum !== 'number' || !Number.isFinite(sum)) {
    throw new Error('WorldPop returned no population sum.');
  }
  return sum;
}

/**
 * Decode a GeoTIFF ArrayBuffer and sum pixel values whose centers lie in the polygon.
 * @param {ArrayBuffer} buffer
 * @param {GeoJSON.Polygon} geometry
 * @returns {Promise<number>}
 */
export async function sumGeoTiffInPolygon(buffer, geometry) {
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const [minX, minY, maxX, maxY] = image.getBoundingBox();
  const rasters = await image.readRasters();
  const band = rasters[0];

  const pixelWidth = (maxX - minX) / width;
  const pixelHeight = (maxY - minY) / height;
  const ring = geometry.coordinates?.[0];
  if (!ring?.length) return 0;

  let sum = 0;
  for (let row = 0; row < height; row += 1) {
    const lat = maxY - (row + 0.5) * pixelHeight;
    for (let col = 0; col < width; col += 1) {
      const lon = minX + (col + 0.5) * pixelWidth;
      if (!pointInPolygon([lon, lat], ring)) continue;
      const value = band[row * width + col];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        sum += value;
      }
    }
  }
  return sum;
}

/**
 * Ray-casting point-in-polygon for a single ring ([lon, lat][]).
 * @param {[number, number]} point
 * @param {number[][]} ring
 */
export function pointInPolygon(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * @param {GeoJSON.Polygon} geometry
 * @returns {[number, number, number, number] | null} minLon, minLat, maxLon, maxLat
 */
export function polygonBbox(geometry) {
  const ring = geometry?.coordinates?.[0];
  if (!ring?.length) return null;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const coord of ring) {
    const lon = coord[0];
    const lat = coord[1];
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

function padBbox(bbox, pad) {
  return [bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad];
}

/**
 * @param {GeoJSON.Polygon} geometry
 * @returns {number[][][]}
 */
function geometryToEsriRings(geometry) {
  return (geometry.coordinates || []).map((ring) =>
    ring.map((coord) => [coord[0], coord[1]])
  );
}

/**
 * Ratio of OSM estimate to reference population.
 * @param {number | null | undefined} estimate
 * @param {number | null | undefined} reference
 * @returns {number | null}
 */
export function compareRatio(estimate, reference) {
  if (
    estimate == null ||
    reference == null ||
    !Number.isFinite(estimate) ||
    !Number.isFinite(reference) ||
    reference <= 0
  ) {
    return null;
  }
  return estimate / reference;
}
