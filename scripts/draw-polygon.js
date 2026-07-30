/*
 * draw-polygon.js
 * Simple polygon drawer for MapLibre — no MapboxDraw.
 *
 * Flow:
 *   1. startDrawing()
 *   2. user clicks / taps the map to place vertices
 *   3. click the first vertex again (or Finish) to close
 *   4. fires onComplete(geojsonFeature)
 */

import maplibregl from 'maplibre-gl';

const SOURCE_ID = 'buildingpop-draw';
const FILL_LAYER = 'buildingpop-draw-fill';
const LINE_LAYER = 'buildingpop-draw-line';
const POINT_LAYER = 'buildingpop-draw-points';

/**
 * @param {maplibregl.Map} map
 * @param {{
 *   onComplete?: (feature: GeoJSON.Feature) => void,
 *   onClear?: () => void,
 *   onCancel?: () => void,
 *   onVertexCount?: (count: number) => void,
 * }} [handlers]
 */
export function createPolygonDrawer(map, handlers = {}) {
  let vertices = []; // [lng, lat][]
  let drawing = false;
  let finishedFeature = null;

  ensureLayers(map);
  render();

  const onMapClick = (event) => {
    if (!drawing) return;

    const point = [event.lngLat.lng, event.lngLat.lat];

    // Close when user taps near the first vertex (and we have a triangle+).
    if (vertices.length >= 3 && isNearFirstVertex(map, point, vertices[0])) {
      finish();
      return;
    }

    vertices.push(point);
    handlers.onVertexCount?.(vertices.length);
    render();
  };

  map.on('click', onMapClick);

  function startDrawing() {
    vertices = [];
    finishedFeature = null;
    drawing = true;
    map.getCanvas().style.cursor = 'crosshair';
    handlers.onVertexCount?.(0);
    render();
  }

  function finish() {
    if (vertices.length < 3) return null;

    drawing = false;
    map.getCanvas().style.cursor = '';

    const ring = [...vertices, vertices[0]];
    finishedFeature = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [ring],
      },
    };

    render();
    handlers.onComplete?.(finishedFeature);
    return finishedFeature;
  }

  function clear() {
    const hadShape = vertices.length > 0 || finishedFeature;
    vertices = [];
    finishedFeature = null;
    drawing = false;
    map.getCanvas().style.cursor = '';
    handlers.onVertexCount?.(0);
    render();
    if (hadShape) handlers.onClear?.();
  }

  function cancelDrawing() {
    if (!drawing) return;
    vertices = [];
    drawing = false;
    map.getCanvas().style.cursor = '';
    handlers.onVertexCount?.(0);
    render();
    handlers.onCancel?.();
  }

  function getPolygon() {
    return finishedFeature;
  }

  function isDrawing() {
    return drawing;
  }

  function render() {
    const data = buildFeatureCollection(vertices, finishedFeature);
    const source = map.getSource(SOURCE_ID);
    if (source) source.setData(data);
  }

  function destroy() {
    map.off('click', onMapClick);
    clear();
  }

  return {
    startDrawing,
    finish,
    clear,
    cancelDrawing,
    getPolygon,
    isDrawing,
    destroy,
  };
}

function ensureLayers(map) {
  const add = () => {
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: emptyCollection(),
      });
    }

    if (!map.getLayer(FILL_LAYER)) {
      map.addLayer({
        id: FILL_LAYER,
        type: 'fill',
        source: SOURCE_ID,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'fill-color': '#0f6b5c',
          'fill-opacity': 0.18,
        },
      });
    }

    if (!map.getLayer(LINE_LAYER)) {
      map.addLayer({
        id: LINE_LAYER,
        type: 'line',
        source: SOURCE_ID,
        paint: {
          'line-color': '#0f6b5c',
          'line-width': 2.5,
        },
      });
    }

    if (!map.getLayer(POINT_LAYER)) {
      map.addLayer({
        id: POINT_LAYER,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': [
            'case',
            ['==', ['get', 'role'], 'first'],
            7,
            5,
          ],
          'circle-color': [
            'case',
            ['==', ['get', 'role'], 'first'],
            '#f0a202',
            '#0f6b5c',
          ],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });
    }
  };

  if (map.isStyleLoaded()) add();
  else map.once('load', add);
}

function buildFeatureCollection(vertices, finishedFeature) {
  if (finishedFeature) {
    return {
      type: 'FeatureCollection',
      features: [finishedFeature],
    };
  }

  const features = vertices.map((coordinates, index) => ({
    type: 'Feature',
    properties: { role: index === 0 ? 'first' : 'vertex' },
    geometry: { type: 'Point', coordinates },
  }));

  if (vertices.length >= 2) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: vertices,
      },
    });
  }

  if (vertices.length >= 3) {
    features.push({
      type: 'Feature',
      properties: { preview: true },
      geometry: {
        type: 'Polygon',
        coordinates: [[...vertices, vertices[0]]],
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

function emptyCollection() {
  return { type: 'FeatureCollection', features: [] };
}

/** True if `point` is within ~24 screen pixels of the first vertex. */
function isNearFirstVertex(map, point, firstVertex) {
  const a = map.project(point);
  const b = map.project(firstVertex);
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy) <= 24;
}
