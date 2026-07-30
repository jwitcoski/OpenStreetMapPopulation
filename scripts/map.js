/*
 * map.js
 * Creates the MapLibre map and polygon draw tools.
 * Also measures / validates drawn polygon area.
 */

import maplibregl from 'maplibre-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import area from '@turf/area';
import { polygon } from '@turf/helpers';

import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  MAX_AREA_KM2,
  MAX_ZOOM,
  MIN_ZOOM,
  TOOL_MIN_ZOOM,
} from './config.js';

import 'maplibre-gl/dist/maplibre-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';

// MapboxDraw still looks for a global named mapboxgl; MapLibre works as a drop-in.
if (!globalThis.mapboxgl) {
  globalThis.mapboxgl = maplibregl;
}

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
 * Create the map and attach zoom + draw controls.
 * @param {string} containerId - DOM id of the map div
 * @returns {{ map: maplibregl.Map, draw: MapboxDraw }}
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

  const draw = new MapboxDraw({
    displayControlsDefault: false,
    controls: {
      polygon: true,
      trash: true,
    },
    // Start in select mode so the trash button can delete a drawn polygon.
    defaultMode: 'simple_select',
  });

  map.addControl(draw, 'top-left');

  // MapboxDraw's trash only deletes *selected* features. After drawing,
  // select the new polygon so trash works. Also make trash clear all
  // polygons if nothing is selected (common mobile frustration).
  map.on('draw.create', (event) => {
    const created = event.features?.[0];
    if (!created?.id) return;
    draw.changeMode('simple_select', { featureIds: [created.id] });
  });

  wireReliableTrashButton(draw);

  return { map, draw };
}

/**
 * Make the trash control always clear polygons, even if nothing is selected.
 */
function wireReliableTrashButton(draw) {
  const trashButton = document.querySelector('.mapbox-gl-draw_trash');
  if (!trashButton || trashButton.dataset.clearWired === 'true') return;

  trashButton.dataset.clearWired = 'true';
  trashButton.title = 'Delete drawn area';
  trashButton.setAttribute('aria-label', 'Delete drawn area');

  trashButton.addEventListener(
    'click',
    (event) => {
      // If a feature is selected, let MapboxDraw's normal trash behavior run.
      if (draw.getSelectedIds().length > 0) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      if (draw.getAll().features.length === 0) return;
      draw.deleteAll();
    },
    true
  );
}

/**
 * Enable or disable the polygon draw tool based on zoom.
 * When disabled, users can still pan / zoom / search the map.
 */
export function setDrawToolEnabled(draw, enabled) {
  const drawRoot = document.querySelector('.mapbox-gl-draw');
  if (drawRoot) {
    drawRoot.classList.toggle('is-disabled', !enabled);
  }

  document.body.classList.toggle('is-tool-disabled', !enabled);

  if (!enabled) {
    // Leave any finished polygon in place, but cancel in-progress drawing.
    try {
      draw.changeMode('simple_select');
    } catch {
      // Ignore mode errors during early map init.
    }
  }
}

/** True when the current zoom is high enough for Overpass queries. */
export function isToolZoomOk(map) {
  return map.getZoom() >= TOOL_MIN_ZOOM;
}

/**
 * Return the first polygon currently on the draw layer, or null.
 */
export function getDrawnPolygon(draw) {
  const data = draw.getAll();
  const feature = data.features.find((f) => f.geometry?.type === 'Polygon');
  return feature ?? null;
}

/**
 * Measure a GeoJSON polygon's area in square kilometers.
 */
export function measureAreaKm2(geometry) {
  return area(polygon(geometry.coordinates)) / 1_000_000;
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
