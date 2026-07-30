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
} from './config.js';

import 'maplibre-gl/dist/maplibre-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';

// MapboxDraw expects a mapboxgl global; MapLibre is API-compatible.
if (!globalThis.mapboxgl) {
  globalThis.mapboxgl = maplibregl;
}

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

export function createMap(container) {
  const map = new maplibregl.Map({
    container,
    style: BASEMAP_STYLE,
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    attributionControl: true,
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

  const draw = new MapboxDraw({
    displayControlsDefault: false,
    controls: {
      polygon: true,
      trash: true,
    },
    defaultMode: 'draw_polygon',
  });

  map.addControl(draw, 'top-left');

  return { map, draw };
}

export function getDrawnPolygon(draw) {
  const data = draw.getAll();
  const feature = data.features.find((f) => f.geometry?.type === 'Polygon');
  return feature ?? null;
}

export function measureAreaKm2(geometry) {
  const km2 = area(polygon(geometry.coordinates)) / 1_000_000;
  return km2;
}

export function assertCityScaleArea(geometry) {
  const km2 = measureAreaKm2(geometry);
  if (km2 > MAX_AREA_KM2) {
    const error = new Error(
      `Polygon is ${km2.toFixed(1)} km² — keep it under ${MAX_AREA_KM2} km² (city blocks / neighborhood).`
    );
    error.code = 'AREA_TOO_LARGE';
    error.areaKm2 = km2;
    throw error;
  }
  return km2;
}
