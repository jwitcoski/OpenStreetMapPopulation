/*
 * map.js
 * Creates the MapLibre map and measures polygon area.
 */

import maplibregl from 'maplibre-gl';
import area from '@turf/area';

import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  MAX_AREA_KM2,
  MAX_ZOOM,
  MIN_ZOOM,
  TOOL_MIN_ZOOM,
} from './config.js';
import { createPolygonDrawer } from './draw-polygon.js';

import 'maplibre-gl/dist/maplibre-gl.css';

/** Free raster basemap (OSM data via CARTO) — no API key required. */
const BASEMAP_STYLE = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [
    {
      id: 'carto',
      type: 'raster',
      source: 'carto',
    },
  ],
};

/**
 * Create the map.
 * @param {string} containerId
 * @returns {{ map: maplibregl.Map }}
 */
export function createMap(containerId) {
  const map = new maplibregl.Map({
    container: containerId,
    style: BASEMAP_STYLE,
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    attributionControl: true,
  });

  map.addControl(
    new maplibregl.NavigationControl({ showCompass: false }),
    'top-left'
  );

  return { map };
}

/**
 * Attach the simple polygon drawer once the map style is ready.
 */
export function attachPolygonDrawer(map, handlers) {
  return createPolygonDrawer(map, handlers);
}

/** True when the current zoom is high enough for Overpass queries. */
export function isToolZoomOk(map) {
  return map.getZoom() >= TOOL_MIN_ZOOM;
}

/**
 * Measure a GeoJSON polygon's area in square kilometers.
 */
export function measureAreaKm2(geometry) {
  return area(geometry) / 1_000_000;
}

/**
 * Ensure the polygon is small enough for a city-scale Overpass query.
 * Throws an error with code AREA_TOO_LARGE when over the limit.
 * @returns {number} area in km²
 */
export function assertCityScaleArea(geometry) {
  const areaKm2 = measureAreaKm2(geometry);

  if (areaKm2 > MAX_AREA_KM2) {
    const error = new Error(
      `Polygon is ${areaKm2.toFixed(1)} km² — keep it under ${MAX_AREA_KM2} km² (city blocks / neighborhood).`
    );
    error.code = 'AREA_TOO_LARGE';
    error.areaKm2 = areaKm2;
    throw error;
  }

  return areaKm2;
}

/**
 * Enable / disable draw UI chrome based on zoom.
 */
export function setToolEnabled(enabled) {
  document.body.classList.toggle('is-tool-disabled', !enabled);
  document.querySelectorAll('[data-requires-tool]').forEach((element) => {
    element.disabled = !enabled;
  });
}
