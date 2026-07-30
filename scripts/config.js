/*
 * config.js
 * Tunable app settings and OSM building-type groups.
 * Change zoom / area limits here — nowhere else.
 */

/** Lowest zoom the map allows (city / neighborhood, not region). */
export const MIN_ZOOM = 13;

/** Highest zoom the map allows. */
export const MAX_ZOOM = 19;

/** Starting view: [longitude, latitude]. */
export const DEFAULT_CENTER = [-77.03659, 38.89399]; // Washington, DC

/** Starting zoom level. */
export const DEFAULT_ZOOM = 15;

/**
 * Largest polygon area we will send to Overpass (square kilometers).
 * Keeps queries at city-block / neighborhood scale.
 */
export const MAX_AREA_KM2 = 12;

/** Public Overpass endpoint used to fetch OSM buildings. */
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/** OSM building=* values counted as single-family / house-like. */
export const HOUSE_TYPES = new Set([
  'house',
  'detached',
  'semidetached_house',
  'terrace',
  'bungalow',
  'cabin',
  'farm',
  'static_caravan',
  'ger',
  'houseboat',
]);

/** OSM building=* values counted as multi-unit / apartment-like. */
export const APARTMENT_TYPES = new Set([
  'apartments',
  'residential',
  'dormitory',
  'hotel',
]);

/** OSM building=* values treated as non-residential (excluded from pop). */
export const COMMERCIAL_TYPES = new Set([
  'commercial',
  'industrial',
  'retail',
  'warehouse',
  'office',
  'garage',
  'garages',
  'hangar',
  'factory',
  'manufacture',
  'supermarket',
  'kiosk',
  'shed',
  'barn',
  'farm_auxiliary',
  'service',
  'school',
  'hospital',
  'church',
  'chapel',
  'mosque',
  'temple',
  'cathedral',
  'public',
  'civic',
  'government',
  'university',
  'college',
  'kindergarten',
  'train_station',
  'transportation',
  'parking',
]);
