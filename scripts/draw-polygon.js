/*
 * draw-polygon.js
 * Simple polygon drawer for MapLibre — no MapboxDraw.
 *
 * Flow:
 *   1. startDrawing()
 *   2. user clicks / taps the map to place vertices
 *   3. click the first vertex again (or Finish) to close
 *   4. fires onComplete(geojsonFeature)
 *   5. after close, vertices stay visible — drag them to reshape (onEdit)
 */

import maplibregl from 'maplibre-gl';

const SOURCE_ID = 'buildingpop-draw';
const FILL_LAYER = 'buildingpop-draw-fill';
const LINE_LAYER = 'buildingpop-draw-line';
const POINT_LAYER = 'buildingpop-draw-points';

const HIT_PX = 24;

/**
 * @param {maplibregl.Map} map
 * @param {{
 *   onComplete?: (feature: GeoJSON.Feature) => void,
 *   onEdit?: (feature: GeoJSON.Feature) => void,
 *   onClear?: () => void,
 *   onCancel?: () => void,
 *   onVertexCount?: (count: number) => void,
 *   onStateChange?: () => void,
 * }} [handlers]
 */
export function createPolygonDrawer(map, handlers = {}) {
  let vertices = []; // [lng, lat][]
  let drawing = false;
  let finishedFeature = null;
  /** @type {number | null} */
  let dragIndex = null;

  ensureLayers(map);
  render();

  const onMapClick = (event) => {
    if (!drawing || dragIndex !== null) return;

    const point = [event.lngLat.lng, event.lngLat.lat];

    // Close when user taps near the first vertex (and we have a triangle+).
    if (vertices.length >= 3 && isNearScreenPoint(map, point, vertices[0])) {
      finish();
      return;
    }

    vertices.push(point);
    handlers.onVertexCount?.(vertices.length);
    render();
    handlers.onStateChange?.();
  };

  const onVertexDown = (event) => {
    // Only reshape a finished polygon — drawing uses clicks to place/close.
    if (drawing || !finishedFeature) return;
    if (!event.features?.length) return;

    const index = Number(event.features[0].properties?.index);
    if (!Number.isInteger(index) || index < 0 || index >= vertices.length) {
      return;
    }

    dragIndex = index;
    map.dragPan.disable();
    map.getCanvas().style.cursor = 'grabbing';
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    if (dragIndex === null) return;

    vertices[dragIndex] = [event.lngLat.lng, event.lngLat.lat];
    finishedFeature = polygonFromVertices(vertices);
    render();
  };

  const onPointerUp = () => {
    if (dragIndex === null) return;

    dragIndex = null;
    map.dragPan.enable();
    map.getCanvas().style.cursor = '';

    if (finishedFeature) {
      handlers.onEdit?.(finishedFeature);
    }
    handlers.onStateChange?.();
  };

  const onPointEnter = () => {
    if (drawing || !finishedFeature || dragIndex !== null) return;
    map.getCanvas().style.cursor = 'grab';
  };

  const onPointLeave = () => {
    if (drawing || dragIndex !== null) return;
    map.getCanvas().style.cursor = '';
  };

  map.on('click', onMapClick);
  map.on('mousedown', POINT_LAYER, onVertexDown);
  map.on('touchstart', POINT_LAYER, onVertexDown);
  map.on('mousemove', onPointerMove);
  map.on('touchmove', onPointerMove);
  map.on('mouseup', onPointerUp);
  map.on('touchend', onPointerUp);
  map.on('mouseenter', POINT_LAYER, onPointEnter);
  map.on('mouseleave', POINT_LAYER, onPointLeave);

  function startDrawing() {
    // Finished shapes are cleared with Clear — don't wipe via Draw area.
    if (finishedFeature) return false;

    vertices = [];
    finishedFeature = null;
    drawing = true;
    dragIndex = null;
    map.getCanvas().style.cursor = 'crosshair';
    handlers.onVertexCount?.(0);
    render();
    handlers.onStateChange?.();
    return true;
  }

  function finish() {
    if (vertices.length < 3) return null;

    drawing = false;
    map.getCanvas().style.cursor = '';
    finishedFeature = polygonFromVertices(vertices);

    render();
    handlers.onComplete?.(finishedFeature);
    handlers.onStateChange?.();
    return finishedFeature;
  }

  function clear() {
    const hadShape = vertices.length > 0 || finishedFeature;
    vertices = [];
    finishedFeature = null;
    drawing = false;
    dragIndex = null;
    map.dragPan.enable();
    map.getCanvas().style.cursor = '';
    handlers.onVertexCount?.(0);
    render();
    handlers.onStateChange?.();
    if (hadShape) handlers.onClear?.();
  }

  function cancelDrawing() {
    if (!drawing) return;
    vertices = [];
    drawing = false;
    dragIndex = null;
    map.getCanvas().style.cursor = '';
    handlers.onVertexCount?.(0);
    render();
    handlers.onCancel?.();
    handlers.onStateChange?.();
  }

  function getPolygon() {
    return finishedFeature;
  }

  function isDrawing() {
    return drawing;
  }

  function isEditing() {
    return dragIndex !== null;
  }

  function getVertexCount() {
    return vertices.length;
  }

  function render() {
    const data = buildFeatureCollection(vertices, finishedFeature);
    const source = map.getSource(SOURCE_ID);
    if (source) source.setData(data);
  }

  function destroy() {
    map.off('click', onMapClick);
    map.off('mousedown', POINT_LAYER, onVertexDown);
    map.off('touchstart', POINT_LAYER, onVertexDown);
    map.off('mousemove', onPointerMove);
    map.off('touchmove', onPointerMove);
    map.off('mouseup', onPointerUp);
    map.off('touchend', onPointerUp);
    map.off('mouseenter', POINT_LAYER, onPointEnter);
    map.off('mouseleave', POINT_LAYER, onPointLeave);
    clear();
  }

  /**
   * Move a finished-polygon corner (also used by tests).
   * @param {number} index
   * @param {[number, number]} lngLat
   */
  function moveVertex(index, lngLat) {
    if (!finishedFeature) return false;
    if (!Number.isInteger(index) || index < 0 || index >= vertices.length) {
      return false;
    }
    vertices[index] = lngLat;
    finishedFeature = polygonFromVertices(vertices);
    render();
    handlers.onEdit?.(finishedFeature);
    handlers.onStateChange?.();
    return true;
  }

  return {
    startDrawing,
    finish,
    clear,
    cancelDrawing,
    getPolygon,
    isDrawing,
    isEditing,
    getVertexCount,
    moveVertex,
    destroy,
  };
}

function polygonFromVertices(vertices) {
  const ring = [...vertices, vertices[0]];
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [ring],
    },
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
  const features = [];

  if (finishedFeature) {
    features.push(finishedFeature);
  } else if (vertices.length >= 3) {
    features.push({
      type: 'Feature',
      properties: { preview: true },
      geometry: {
        type: 'Polygon',
        coordinates: [[...vertices, vertices[0]]],
      },
    });
  }

  if (!finishedFeature && vertices.length >= 2) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: vertices,
      },
    });
  }

  // Keep corner handles visible after finish so the boundary can be adjusted.
  vertices.forEach((coordinates, index) => {
    features.push({
      type: 'Feature',
      properties: {
        role: index === 0 ? 'first' : 'vertex',
        index,
      },
      geometry: { type: 'Point', coordinates },
    });
  });

  return { type: 'FeatureCollection', features };
}

function emptyCollection() {
  return { type: 'FeatureCollection', features: [] };
}

/** True if `point` is within ~HIT_PX screen pixels of `target`. */
function isNearScreenPoint(map, point, target) {
  const a = map.project(point);
  const b = map.project(target);
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy) <= HIT_PX;
}
