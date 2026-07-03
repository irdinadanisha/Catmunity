const defaultAccurateLocation = {
  latitude: 3.1478,
  longitude: 101.6953,
  accuracyMeters: 280,
};

export async function autoDetectCatCrop(imageUrl) {
  // TODO: Replace with an on-device model or backend image detection service.
  // If detection confidence is low, route to a manual crop editor.
  return {
    croppedImageUrl: imageUrl,
    confidence: 0.82,
    mode: 'auto',
  };
}

export async function getCurrentAccurateLocation() {
  if (!navigator.geolocation) return defaultAccurateLocation;

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        resolve({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracyMeters: coords.accuracy,
        });
      },
      () => resolve(defaultAccurateLocation),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  });
}

export function getApproximateLocation(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return {
      latitude: defaultAccurateLocation.latitude,
      longitude: defaultAccurateLocation.longitude,
      areaName: 'Central Kuala Lumpur area',
      city: 'Kuala Lumpur',
      country: 'Malaysia',
      locationName: 'Central Kuala Lumpur area',
    };
  }

  const approximateLatitude = Number(latitude.toFixed(3));
  const approximateLongitude = Number(longitude.toFixed(3));

  return {
    latitude: approximateLatitude,
    longitude: approximateLongitude,
    areaName: getAreaName(approximateLatitude, approximateLongitude),
    city: 'Kuala Lumpur',
    country: 'Malaysia',
    locationName: `${getAreaName(approximateLatitude, approximateLongitude)}, Kuala Lumpur`,
  };
}

export function approximateLocation(latitude, longitude) {
  return getApproximateLocation(latitude, longitude).locationName;
}

export function createNewCatWithCanonicalLocation({ capture, form = {}, currentUserId }) {
  const now = new Date().toISOString();
  const catId = form.id || `cat-${Date.now()}`;
  const approximate = getApproximateLocation(capture.latitude, capture.longitude);
  const tags = Array.isArray(form.tags)
    ? form.tags
    : String(form.tags || 'new find')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

  return {
    id: catId,
    name: form.name?.trim() || 'Unnamed Cat',
    image_url: capture.originalImage,
    cropped_image_url: capture.croppedImage,
    original_image_url: capture.originalImage,
    color: form.color || '',
    colour: form.color || '',
    breed: form.breed || '',
    weight: form.weight || '',
    fun_info: form.fun_info || '',
    fun_facts: form.fun_info || '',
    remarks: form.remarks || '',
    tags,
    discovered_by: currentUserId,
    created_by: currentUserId,
    caught_by_users: [currentUserId],
    canonical_latitude: capture.latitude,
    canonical_longitude: capture.longitude,
    approximate_latitude: approximate.latitude,
    approximate_longitude: approximate.longitude,
    latitude: approximate.latitude,
    longitude: approximate.longitude,
    location_name: form.location_name || approximate.locationName,
    area_name: approximate.areaName,
    city: approximate.city,
    country: approximate.country,
    user_cats: [
      createUserCatRecord({
        userId: currentUserId,
        catId,
        capture,
        isUnlocked: true,
        userGivenName: form.name,
        userNotes: form.remarks,
      }),
    ],
    sighting_count: 1,
    created_at: now,
    updated_at: now,
    map: { x: 52, y: 48 },
  };
}

export function addExistingCatToUserCollection(cats, catId, userId, capture = null) {
  return cats.map((cat) => {
    if (cat.id !== catId || cat.caught_by_users.includes(userId)) return cat;

    const sighting = createUserCatRecord({
      userId,
      catId,
      capture,
      isUnlocked: true,
    });

    return {
      ...cat,
      caught_by_users: [...cat.caught_by_users, userId],
      user_cats: [...(cat.user_cats || []), sighting],
      sighting_count: (cat.sighting_count || cat.caught_by_users.length || 0) + 1,
      updated_at: new Date().toISOString(),
    };
  });
}

export function getCatMapPosition(cat) {
  return {
    lat: cat.approximate_latitude ?? cat.latitude ?? cat.canonical_latitude ?? defaultAccurateLocation.latitude,
    lng: cat.approximate_longitude ?? cat.longitude ?? cat.canonical_longitude ?? defaultAccurateLocation.longitude,
  };
}

export function saveCatCatch(cat) {
  // TODO: Persist to Supabase using createNewCatWithCanonicalLocation for new cats.
  // TODO: Add automatic duplicate detection with image similarity + nearby approximate cell matching.
  return cat;
}

export function getLockedStateForUser(cat, userId) {
  return !cat.caught_by_users.includes(userId);
}

function createUserCatRecord({ userId, catId, capture, isUnlocked, userGivenName = '', userNotes = '' }) {
  const approximate = capture
    ? getApproximateLocation(capture.latitude, capture.longitude)
    : getApproximateLocation(null, null);

  return {
    id: `user-cat-${userId}-${catId}-${Date.now()}`,
    user_id: userId,
    cat_id: catId,
    discovered_at: new Date().toISOString(),
    user_given_name: userGivenName || null,
    user_notes: userNotes || null,
    is_unlocked: isUnlocked,
    sighting_area_name: approximate.areaName,
    approximate_sighting_latitude: approximate.latitude,
    approximate_sighting_longitude: approximate.longitude,
  };
}

function getAreaName(latitude, longitude) {
  if (latitude >= 3.145 && latitude <= 3.151 && longitude >= 101.691 && longitude <= 101.699) {
    return 'Petaling Street area';
  }

  if (latitude >= 3.15 && latitude <= 3.158 && longitude >= 101.702 && longitude <= 101.71) {
    return 'Kampung Baru area';
  }

  if (latitude >= 3.116 && latitude <= 3.126 && longitude >= 101.648 && longitude <= 101.66) {
    return 'University Garden area';
  }

  return 'Central Kuala Lumpur area';
}
