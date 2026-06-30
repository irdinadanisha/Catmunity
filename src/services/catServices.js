export async function autoDetectCatCrop(imageUrl) {
  // TODO: Replace with an on-device model or backend image detection service.
  // If detection confidence is low, route to a manual crop editor.
  return {
    croppedImageUrl: imageUrl,
    confidence: 0.82,
    mode: 'auto',
  };
}

export async function getCurrentPosition() {
  // TODO: Use navigator.geolocation in production, with permission handling.
  return {
    latitude: 3.1478,
    longitude: 101.6953,
    accuracyMeters: 280,
  };
}

export function approximateLocation(latitude, longitude) {
  // TODO: Reverse geocode to a privacy-preserving neighborhood label.
  if (latitude && longitude) return 'Central Kuala Lumpur area';
  return 'Approximate area';
}

export function saveCatCatch(cat) {
  // TODO: Persist to backend database, object storage, and user collection tables.
  return cat;
}

export function getLockedStateForUser(cat, userId) {
  return !cat.caught_by_users.includes(userId);
}
