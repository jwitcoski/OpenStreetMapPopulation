/** City-scale limits for Overpass queries. */
export const MIN_ZOOM = 13;
export const MAX_ZOOM = 19;
export const DEFAULT_CENTER = [-77.03659, 38.89399]; // Washington, DC
export const DEFAULT_ZOOM = 15;

/** Soft cap so a single draw stays neighborhood/city-block sized. */
export const MAX_AREA_KM2 = 12;

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

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

export const APARTMENT_TYPES = new Set([
  'apartments',
  'residential',
  'dormitory',
  'hotel',
]);

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
