/*
 * draw-styles.js
 * MapboxDraw styles that MapLibre GL JS will accept.
 *
 * MapLibre rejects data-driven line-dasharray (used in mapbox-gl-draw 1.5+
 * defaults), which shows up as:
 *   layers.gl-draw-lines.cold.paint.line-dasharray...
 * These styles keep Draw's current theme shape but use solid lines only.
 */

const accent = '#0f6b5c';
const active = '#f0a202';
const white = '#ffffff';

export const DRAW_STYLES = [
  {
    id: 'gl-draw-polygon-fill',
    type: 'fill',
    filter: ['all', ['==', '$type', 'Polygon']],
    paint: {
      'fill-color': [
        'case',
        ['==', ['get', 'active'], 'true'],
        active,
        accent,
      ],
      'fill-opacity': 0.14,
    },
  },
  {
    id: 'gl-draw-lines',
    type: 'line',
    filter: [
      'any',
      ['==', '$type', 'LineString'],
      ['==', '$type', 'Polygon'],
    ],
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': [
        'case',
        ['==', ['get', 'active'], 'true'],
        active,
        accent,
      ],
      // Solid stroke — do NOT use data-driven line-dasharray (breaks MapLibre).
      'line-width': 2.5,
    },
  },
  {
    id: 'gl-draw-point-outer',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'feature']],
    paint: {
      'circle-radius': [
        'case',
        ['==', ['get', 'active'], 'true'],
        7,
        5,
      ],
      'circle-color': white,
    },
  },
  {
    id: 'gl-draw-point-inner',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'feature']],
    paint: {
      'circle-radius': [
        'case',
        ['==', ['get', 'active'], 'true'],
        5,
        3,
      ],
      'circle-color': [
        'case',
        ['==', ['get', 'active'], 'true'],
        active,
        accent,
      ],
    },
  },
  {
    id: 'gl-draw-vertex-outer',
    type: 'circle',
    filter: [
      'all',
      ['==', '$type', 'Point'],
      ['==', 'meta', 'vertex'],
      ['!=', 'mode', 'simple_select'],
    ],
    paint: {
      'circle-radius': [
        'case',
        ['==', ['get', 'active'], 'true'],
        7,
        5,
      ],
      'circle-color': white,
    },
  },
  {
    id: 'gl-draw-vertex-inner',
    type: 'circle',
    filter: [
      'all',
      ['==', '$type', 'Point'],
      ['==', 'meta', 'vertex'],
      ['!=', 'mode', 'simple_select'],
    ],
    paint: {
      'circle-radius': [
        'case',
        ['==', ['get', 'active'], 'true'],
        5,
        3,
      ],
      'circle-color': active,
    },
  },
  {
    id: 'gl-draw-midpoint',
    type: 'circle',
    filter: ['all', ['==', 'meta', 'midpoint']],
    paint: {
      'circle-radius': 4,
      'circle-color': active,
    },
  },
];
