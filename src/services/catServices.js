import { getCurrentSession, isSupabaseConfigured, supabase } from './supabaseClient';

export const duplicateLocationRadiusMeters = 20;

const defaultAccurateLocation = {
  latitude: 3.1478,
  longitude: 101.6953,
  accuracyMeters: 280,
};

export async function autoDetectCatCrop(imageUrl) {
  const croppedImageUrl = await createSquareCatCrop(imageUrl);

  return {
    croppedImageUrl,
    confidence: 0.7,
    mode: 'square-crop',
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

export async function getCurrentCatLocation() {
  if (!navigator.geolocation) {
    return {
      ok: false,
      error: 'unsupported',
      message: 'Location is not available on this device.',
    };
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const approximate = getApproximateLocation(coords.latitude, coords.longitude);
        const geocoded = await reverseGeocodeLocation(coords.latitude, coords.longitude);
        const readable = geocoded || approximate;
        console.debug('[Catmunity location]', {
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracyMeters: coords.accuracy,
          reverseGeocodeResult: geocoded,
          finalAreaName: readable.locationName,
          source: geocoded ? 'fresh-gps-google-reverse-geocode' : 'fresh-gps-local-fallback',
        });
        resolve({
          ok: true,
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracyMeters: coords.accuracy,
          approximateLatitude: approximate.latitude,
          approximateLongitude: approximate.longitude,
          areaName: readable.areaName,
          city: readable.city,
          country: readable.country,
          locationName: readable.locationName,
          approximate: coords.accuracy > 80,
          source: geocoded ? 'fresh-gps-google-reverse-geocode' : 'fresh-gps-local-fallback',
        });
      },
      (error) => {
        console.debug('[Catmunity location]', {
          error: error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable',
          message: error.message,
          source: 'geolocation-failed',
        });
        resolve({
          ok: false,
          error: error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable',
          message: error.code === error.PERMISSION_DENIED
            ? 'Location permission is needed to register where this cat was found.'
            : 'We could not detect your current location. Please try again.',
        });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

export async function reverseGeocodeLocation(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (typeof window === 'undefined' || !window.google?.maps?.Geocoder) return null;

  try {
    const geocoder = new window.google.maps.Geocoder();
    const { results } = await geocoder.geocode({ location: { lat: latitude, lng: longitude } });
    const parsed = parseGoogleReverseGeocode(results || []);
    console.debug('[Catmunity reverse geocode]', {
      latitude,
      longitude,
      result: parsed,
      rawFirstResult: results?.[0],
    });
    return parsed;
  } catch (error) {
    console.warn('[Catmunity reverse geocode failed]', error);
    return null;
  }
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
  const fallbackApproximate = getApproximateLocation(capture.latitude, capture.longitude);
  const approximate = {
    ...fallbackApproximate,
    latitude: capture.approximateLatitude ?? fallbackApproximate.latitude,
    longitude: capture.approximateLongitude ?? fallbackApproximate.longitude,
    areaName: capture.areaName || fallbackApproximate.areaName,
    city: capture.city || fallbackApproximate.city,
    country: capture.country || fallbackApproximate.country,
    locationName: capture.locationName || fallbackApproximate.locationName,
  };
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
    behavior: form.behavior || '',
    gender: form.gender || '',
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
    latitude: capture.latitude,
    longitude: capture.longitude,
    location_name: form.location_name || approximate.locationName,
    area_name: approximate.areaName,
    city: approximate.city,
    country: approximate.country,
    discovered_at: form.date_found ? new Date(`${form.date_found}T12:00:00`).toISOString() : now,
    user_cats: [
      createUserCatRecord({
        userId: currentUserId,
        catId,
        capture,
        isUnlocked: true,
        userGivenName: form.name,
        userNotes: form.remarks,
        discoveredAt: form.date_found,
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
    lat: cat.canonical_latitude ?? cat.latitude ?? cat.approximate_latitude ?? defaultAccurateLocation.latitude,
    lng: cat.canonical_longitude ?? cat.longitude ?? cat.approximate_longitude ?? defaultAccurateLocation.longitude,
  };
}

export function getDistanceMeters(from, to) {
  if (!from || !to) return Number.POSITIVE_INFINITY;

  const fromLatitude = from.latitude ?? from.lat;
  const fromLongitude = from.longitude ?? from.lng;
  const toLatitude = to.latitude ?? to.lat;
  const toLongitude = to.longitude ?? to.lng;

  if (![fromLatitude, fromLongitude, toLatitude, toLongitude].every(Number.isFinite)) {
    return Number.POSITIVE_INFINITY;
  }

  const earthRadiusMeters = 6371000;
  const latitudeDelta = toRadians(toLatitude - fromLatitude);
  const longitudeDelta = toRadians(toLongitude - fromLongitude);
  const fromRadians = toRadians(fromLatitude);
  const toRadiansValue = toRadians(toLatitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromRadians) * Math.cos(toRadiansValue) * Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function isWithinDuplicateRadius(cat, capture, radiusMeters = duplicateLocationRadiusMeters) {
  if (!cat || !capture) return true;

  const originalLocation = {
    latitude: cat.canonical_latitude ?? cat.latitude,
    longitude: cat.canonical_longitude ?? cat.longitude,
  };

  return getDistanceMeters(originalLocation, capture) <= radiusMeters;
}

export function saveCatCatch(cat) {
  // TODO: Persist to Supabase using createNewCatWithCanonicalLocation for new cats.
  // TODO: Add automatic duplicate detection with image similarity + nearby approximate cell matching.
  return cat;
}

export function getLockedStateForUser(cat, userId) {
  return !cat.caught_by_users.includes(userId);
}

export async function loadCatsFromSupabase(uiUserId) {
  return fetchCatsForMap(uiUserId);
}

export async function fetchCatsForMap(uiUserId) {
  if (!isSupabaseConfigured) return null;

  const user = await getSupabaseUser();
  if (!user) return null;

  const [{ data: publicCats, error: catsError }, { data: userCats, error: userCatsError }] = await Promise.all([
    supabase
      .from('cat_public_map')
      .select('*')
      .order('updated_at', { ascending: false }),
    supabase
      .from('user_cats')
      .select('cat_id, is_unlocked, discovered_at')
      .eq('user_id', user.id)
      .eq('is_unlocked', true),
  ]);

  if (catsError || userCatsError) {
    console.warn('Supabase cat load failed', catsError || userCatsError);
    return null;
  }

  const userCatsByCatId = new Map((userCats || []).map((item) => [item.cat_id, item]));
  return (publicCats || []).map((cat) => mapSupabaseCat(cat, uiUserId, userCatsByCatId.has(cat.id), userCatsByCatId.get(cat.id)));
}

export async function fetchUserCollection(userId) {
  return fetchPublicUserCollection(userId, userId);
}

export async function fetchPublicUserCollection(profileUserId, viewerUserId) {
  if (!isSupabaseConfigured || !profileUserId) return [];

  const [{ data: profileCats, error: profileError }, { data: viewerCats, error: viewerError }] = await Promise.all([
    supabase
      .from('public_user_cat_map')
      .select('*')
      .eq('profile_user_id', profileUserId)
      .order('discovered_at', { ascending: false }),
    viewerUserId
      ? supabase
        .from('user_cats')
        .select('cat_id, is_unlocked, discovered_at')
        .eq('user_id', viewerUserId)
        .eq('is_unlocked', true)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (profileError || viewerError) {
    console.warn('Supabase public collection load failed', profileError || viewerError);
    return [];
  }

  const viewerCatsByCatId = new Map((viewerCats || []).map((item) => [item.cat_id, item]));
  return (profileCats || []).map((cat) => mapSupabaseCat(cat, viewerUserId, viewerCatsByCatId.has(cat.id), viewerCatsByCatId.get(cat.id)));
}

export async function findNearbyCats(latitude, longitude, radiusMeters = duplicateLocationRadiusMeters) {
  if (!isSupabaseConfigured) return [];
  const cats = await fetchCatsForMap((await getSupabaseUser())?.id || '');
  return (cats || []).filter((cat) =>
    getDistanceMeters(
      {
        latitude,
        longitude,
      },
      {
        latitude: cat.canonical_latitude ?? cat.latitude,
        longitude: cat.canonical_longitude ?? cat.longitude,
      },
    ) <= radiusMeters,
  );
}

export async function createNewCatInSupabase({ capture, form, uiUserId }) {
  if (!isSupabaseConfigured) return null;

  const user = await getSupabaseUser();
  if (!user) return null;

  const persistentCapture = await persistCaptureImages(capture, user.id);
  const localCat = createNewCatWithCanonicalLocation({ capture: persistentCapture, form, currentUserId: uiUserId });
  const catPayload = {
    name: localCat.name,
    colour: localCat.colour,
    breed: localCat.breed || null,
    weight: localCat.weight || null,
    behavior: localCat.behavior || null,
    gender: localCat.gender || null,
    fun_facts: localCat.fun_facts,
    remarks: localCat.remarks,
    original_image_url: localCat.original_image_url,
    cropped_image_url: localCat.cropped_image_url,
    created_by: user.id,
    canonical_latitude: localCat.canonical_latitude,
    canonical_longitude: localCat.canonical_longitude,
    approximate_latitude: localCat.approximate_latitude,
    approximate_longitude: localCat.approximate_longitude,
    location_name: localCat.location_name,
    area_name: localCat.area_name,
    city: localCat.city,
    country: localCat.country,
  };

  const { data: createdCat, error: catError } = await supabase
    .from('cats')
    .insert(catPayload)
    .select()
    .single();

  if (catError) {
    console.warn('Supabase new cat insert failed', catError);
    return null;
  }

  await createSupabaseUserCat({
    userId: user.id,
    catId: createdCat.id,
    capture,
    userGivenName: localCat.name,
    userNotes: localCat.remarks,
    discoveredAt: form.date_found,
  });

  await createSupabaseSighting({
    userId: user.id,
    catId: createdCat.id,
    capture,
    remarks: localCat.remarks,
    photoUrl: localCat.cropped_image_url,
  });

  return {
    ...localCat,
    id: createdCat.id,
    created_by: user.id,
    discovered_by: uiUserId,
  };
}

export async function addExistingCatToSupabase({ catId, capture }) {
  return addExistingCatToCollection({ catId, capture });
}

export async function addExistingCatToCollection({ userId: explicitUserId, catId, capture }) {
  if (!isSupabaseConfigured) return false;

  const user = await getSupabaseUser();
  const userId = explicitUserId || user?.id;
  if (!userId) return false;
  const persistentCapture = capture ? await persistCaptureImages(capture, userId) : capture;

  const userCatResult = await createSupabaseUserCat({
    userId,
    catId,
    capture: persistentCapture,
  });

  if (!userCatResult) return false;

  await createSupabaseSighting({
    userId,
    catId,
    capture: persistentCapture,
  });

  return true;
}

export async function removeCatFromUserCollection(userId, catId) {
  if (!isSupabaseConfigured || !userId || !catId) return { error: null };

  const { error } = await supabase
    .from('user_cats')
    .delete()
    .eq('user_id', userId)
    .eq('cat_id', catId);

  return { error };
}

export async function getCatOwnershipInfo(userId, catId) {
  if (!isSupabaseConfigured || !userId || !catId) {
    return {
      isOriginalCreator: true,
      totalCatchers: 1,
      otherCatchers: 0,
      error: null,
    };
  }

  const [{ data: cat, error: catError }, { data: mapCat, error: mapError }] = await Promise.all([
    supabase
      .from('cats')
      .select('id, created_by')
      .eq('id', catId)
      .single(),
    supabase
      .from('cat_public_map')
      .select('id, sighting_count')
      .eq('id', catId)
      .single(),
  ]);

  if (catError || mapError) {
    return {
      isOriginalCreator: false,
      totalCatchers: 0,
      otherCatchers: 0,
      error: catError || mapError,
    };
  }

  const creatorId = cat?.created_by || '';
  const totalCatchers = Number(mapCat?.sighting_count || 0);
  const isOriginalCreator = creatorId === userId;

  return {
    isOriginalCreator,
    totalCatchers,
    otherCatchers: Math.max(0, totalCatchers - (isOriginalCreator ? 1 : 0)),
    error: null,
  };
}

export async function deleteCatAsOriginalCreator(userId, catId) {
  const ownership = await getCatOwnershipInfo(userId, catId);
  if (ownership.error) return { ...ownership, deletedGlobally: false };

  if (!ownership.isOriginalCreator) {
    return {
      ...ownership,
      deletedGlobally: false,
      error: new Error('Only the first catcher can delete this cat from the map.'),
    };
  }

  if (ownership.otherCatchers > 0) {
    const { error } = await removeCatFromUserCollection(userId, catId);
    return {
      ...ownership,
      deletedGlobally: false,
      removedFromCollection: !error,
      error,
      blockedGlobalDelete: !error,
    };
  }

  const postsResult = await supabase
    .from('community_posts')
    .delete()
    .eq('user_id', userId)
    .eq('cat_id', catId);

  if (postsResult.error) {
    return {
      ...ownership,
      deletedGlobally: false,
      error: postsResult.error,
    };
  }

  const { error } = await supabase
    .from('cats')
    .delete()
    .eq('id', catId)
    .eq('created_by', userId);

  return {
    ...ownership,
    deletedGlobally: !error,
    removedFromCollection: !error,
    error,
  };
}

export async function handleDeleteCat(userId, catId) {
  if (!isSupabaseConfigured || !userId || !catId) {
    return {
      deletedGlobally: true,
      removedFromCollection: true,
      error: null,
    };
  }

  const ownership = await getCatOwnershipInfo(userId, catId);
  if (ownership.error) return { ...ownership, deletedGlobally: false };

  if (ownership.isOriginalCreator) {
    return deleteCatAsOriginalCreator(userId, catId);
  }

  const { error } = await removeCatFromUserCollection(userId, catId);
  return {
    ...ownership,
    deletedGlobally: false,
    removedFromCollection: !error,
    error,
  };
}

export async function updateCatDetailsInSupabase(catId, form) {
  if (!isSupabaseConfigured || !catId) return { data: null, error: new Error('Supabase is not configured.') };

  const user = await getSupabaseUser();
  if (!user) return { data: null, error: new Error('You need to be signed in to edit cat details.') };

  const { data, error } = await supabase
    .from('cats')
    .update({
      name: form.name?.trim() || 'Unnamed Cat',
      colour: form.color || null,
      breed: form.breed || null,
      weight: form.weight || null,
      behavior: form.behavior || null,
      gender: form.gender || null,
      fun_facts: form.fun_info || null,
      remarks: form.remarks || null,
      location_name: form.location_name || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', catId)
    .select()
    .single();

  if (!error && form.date_found) {
    await supabase
      .from('user_cats')
      .update({
        discovered_at: new Date(`${form.date_found}T12:00:00`).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)
      .eq('cat_id', catId);
  }

  return { data, error };
}

function createUserCatRecord({ userId, catId, capture, isUnlocked, userGivenName = '', userNotes = '', discoveredAt = '' }) {
  const approximate = getCaptureApproximateLocation(capture);

  return {
    id: `user-cat-${userId}-${catId}-${Date.now()}`,
    user_id: userId,
    cat_id: catId,
    discovered_at: discoveredAt ? new Date(`${discoveredAt}T12:00:00`).toISOString() : new Date().toISOString(),
    user_given_name: userGivenName || null,
    user_notes: userNotes || null,
    is_unlocked: isUnlocked,
    sighting_area_name: approximate.areaName,
    approximate_sighting_latitude: approximate.latitude,
    approximate_sighting_longitude: approximate.longitude,
  };
}

async function getSupabaseUser() {
  const session = await getCurrentSession();
  return session?.user || null;
}

async function createSupabaseUserCat({ userId, catId, capture, userGivenName = '', userNotes = '', discoveredAt = '' }) {
  const approximate = getCaptureApproximateLocation(capture);

  const { data, error } = await supabase
    .from('user_cats')
    .upsert(
      {
        user_id: userId,
        cat_id: catId,
        user_given_name: userGivenName || null,
        user_notes: userNotes || null,
        discovered_at: discoveredAt ? new Date(`${discoveredAt}T12:00:00`).toISOString() : new Date().toISOString(),
        is_unlocked: true,
        sighting_area_name: approximate.areaName,
        approximate_sighting_latitude: approximate.latitude,
        approximate_sighting_longitude: approximate.longitude,
      },
      { onConflict: 'user_id,cat_id' },
    )
    .select()
    .single();

  if (error) {
    console.warn('Supabase user_cats upsert failed', error);
    return null;
  }

  return data;
}

async function createSupabaseSighting({ userId, catId, capture, photoUrl = null, remarks = '' }) {
  const approximate = getCaptureApproximateLocation(capture);

  const { error } = await supabase
    .from('cat_sightings')
    .insert({
      user_id: userId,
      cat_id: catId,
      approximate_latitude: approximate.latitude,
      approximate_longitude: approximate.longitude,
      area_name: approximate.areaName,
      photo_url: photoUrl,
      remarks: remarks || null,
    });

  if (error) {
    console.warn('Supabase cat_sightings insert failed', error);
  }
}

function mapSupabaseCat(cat, uiUserId, caught, userCat = null) {
  const limitedInfo = !caught;
  const originalImageUrl = isPersistentImageUrl(cat.original_image_url) ? cat.original_image_url : '';
  const croppedImageUrl = isPersistentImageUrl(cat.cropped_image_url) ? cat.cropped_image_url : missingCatImageUrl;
  return {
    id: cat.id,
    name: cat.name || 'Unnamed Cat',
    image_url: originalImageUrl || croppedImageUrl,
    original_image_url: originalImageUrl,
    cropped_image_url: croppedImageUrl,
    color: limitedInfo ? '' : cat.colour || '',
    colour: limitedInfo ? '' : cat.colour || '',
    breed: limitedInfo ? '' : cat.breed || '',
    weight: limitedInfo ? '' : cat.weight || '',
    behavior: limitedInfo ? '' : cat.behavior || '',
    gender: limitedInfo ? '' : cat.gender || '',
    fun_info: limitedInfo ? '' : cat.fun_facts || '',
    fun_facts: limitedInfo ? '' : cat.fun_facts || '',
    remarks: limitedInfo ? '' : cat.remarks || '',
    tags: ['nearby'],
    discovered_by: cat.created_by || '',
    created_by: cat.created_by || '',
    caught_by_users: caught ? [uiUserId] : [],
    latitude: cat.latitude,
    longitude: cat.longitude,
    canonical_latitude: cat.latitude,
    canonical_longitude: cat.longitude,
    approximate_latitude: cat.approximate_latitude ?? cat.latitude,
    approximate_longitude: cat.approximate_longitude ?? cat.longitude,
    location_name: cat.location_name || cat.area_name || 'Approximate area',
    area_name: cat.area_name || 'Approximate area',
    city: cat.city || '',
    country: cat.country || '',
    sighting_count: cat.sighting_count || 0,
    discovered_at: userCat?.discovered_at || cat.discovered_at || cat.created_at,
    created_at: cat.created_at,
    updated_at: cat.updated_at,
    map: { x: 52, y: 48 },
  };
}

function getCaptureApproximateLocation(capture) {
  const fallback = capture
    ? getApproximateLocation(capture.latitude, capture.longitude)
    : getApproximateLocation(null, null);

  return {
    ...fallback,
    latitude: capture?.approximateLatitude ?? fallback.latitude,
    longitude: capture?.approximateLongitude ?? fallback.longitude,
    areaName: capture?.areaName || fallback.areaName,
    city: capture?.city || fallback.city,
    country: capture?.country || fallback.country,
    locationName: capture?.locationName || fallback.locationName,
  };
}

function isPersistentImageUrl(value = '') {
  return /^https?:/i.test(value) || /^data:image\//i.test(value);
}

async function persistCaptureImages(capture, userId) {
  if (!capture || !isSupabaseConfigured) return capture;

  const [croppedImage, originalImage] = await Promise.all([
    uploadCatPhotoFromUrl({
      userId,
      imageUrl: capture.croppedImage,
      filename: capture.originalFileName,
      variant: 'cropped',
    }),
    uploadCatPhotoFromUrl({
      userId,
      imageUrl: capture.originalImage,
      filename: capture.originalFileName,
      variant: 'original',
    }),
  ]);

  return {
    ...capture,
    croppedImage: croppedImage || missingCatImageUrl,
    originalImage: originalImage || croppedImage || missingCatImageUrl,
  };
}

async function uploadCatPhotoFromUrl({ userId, imageUrl, filename = 'cat-photo.jpg', variant }) {
  if (!imageUrl || isPersistentImageUrl(imageUrl)) return imageUrl;

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error('Could not read cat photo before upload.');
    const blob = await response.blob();
    const extension = getImageExtension(blob.type, filename);
    const cleanName = filename.replace(/\.[^.]+$/u, '').replace(/[^a-z0-9_-]+/giu, '-').replace(/^-|-$/gu, '') || 'cat-photo';
    const path = `${userId}/${Date.now()}-${variant}-${cleanName}.${extension}`;
    const { error } = await supabase.storage
      .from('cat-photos')
      .upload(path, blob, {
        cacheControl: '31536000',
        contentType: blob.type || 'image/jpeg',
        upsert: false,
      });

    if (error) throw error;

    const { data } = supabase.storage
      .from('cat-photos')
      .getPublicUrl(path);
    return data.publicUrl;
  } catch (error) {
    console.warn('Cat photo upload failed', error);
    return '';
  }
}

function getImageExtension(contentType = '', filename = '') {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  const match = filename.match(/\.([a-z0-9]+)$/iu);
  return match?.[1]?.toLowerCase() || 'jpg';
}

const missingCatImageUrl = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
  <rect width="400" height="400" rx="56" fill="#fff0e4"/>
  <path d="M116 154 88 102a16 16 0 0 1 24-19l48 34a116 116 0 0 1 80 0l48-34a16 16 0 0 1 24 19l-28 52a116 116 0 1 1-168 0Z" fill="#f6cdbd"/>
  <circle cx="154" cy="210" r="16" fill="#705247"/>
  <circle cx="246" cy="210" r="16" fill="#705247"/>
  <path d="M200 232c14 0 26 7 26 16s-12 16-26 16-26-7-26-16 12-16 26-16Z" fill="#e85f4b"/>
  <path d="M168 284c18 16 46 16 64 0" fill="none" stroke="#705247" stroke-width="14" stroke-linecap="round"/>
</svg>
`)}`;

function parseGoogleReverseGeocode(results) {
  const components = results.flatMap((result) => result.address_components || []);
  const areaName =
    findAddressComponent(components, ['sublocality_level_1']) ||
    findAddressComponent(components, ['neighborhood']) ||
    findAddressComponent(components, ['sublocality']) ||
    findAddressComponent(components, ['sublocality_level_2']) ||
    findAddressComponent(components, ['locality']) ||
    findAddressComponent(components, ['administrative_area_level_2']) ||
    findAddressComponent(components, ['administrative_area_level_1']);
  const city =
    findAddressComponent(components, ['locality']) ||
    findAddressComponent(components, ['administrative_area_level_2']) ||
    'Kuala Lumpur';
  const country = findAddressComponent(components, ['country']) || 'Malaysia';

  if (!areaName) return null;

  return {
    areaName,
    city,
    country,
    locationName: areaName === city ? `${areaName}, ${country}` : `${areaName}, ${city}`,
  };
}

function findAddressComponent(components, types) {
  return components.find((component) => types.every((type) => component.types.includes(type)))?.long_name || '';
}

function getAreaName(latitude, longitude) {
  if (latitude >= 3.19 && latitude <= 3.225 && longitude >= 101.715 && longitude <= 101.748) {
    return 'Wangsa Maju';
  }

  if (latitude >= 3.145 && latitude <= 3.151 && longitude >= 101.691 && longitude <= 101.699) {
    return 'Petaling Street area';
  }

  if (latitude >= 3.15 && latitude <= 3.158 && longitude >= 101.702 && longitude <= 101.71) {
    return 'Kampung Baru area';
  }

  if (latitude >= 3.116 && latitude <= 3.126 && longitude >= 101.648 && longitude <= 101.66) {
    return 'University Garden area';
  }

  if (latitude >= 3.205 && latitude <= 3.235 && longitude >= 101.748 && longitude <= 101.775) {
    return 'Melawati';
  }

  if (latitude >= 3.13 && latitude <= 3.18 && longitude >= 101.735 && longitude <= 101.79) {
    return 'Ampang area';
  }

  return 'Central Kuala Lumpur area';
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

async function createSquareCatCrop(imageUrl) {
  try {
    const image = await loadImageFromSource(imageUrl);
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    const cropSize = Math.min(imageWidth, imageHeight);
    const sourceX = (imageWidth - cropSize) / 2;
    const sourceY = (imageHeight - cropSize) / 2;
    const outputSize = 900;
    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    const context = canvas.getContext('2d');

    context.drawImage(
      image,
      sourceX,
      sourceY,
      cropSize,
      cropSize,
      0,
      0,
      outputSize,
      outputSize,
    );

    return canvas.toDataURL('image/jpeg', 0.9);
  } catch (error) {
    console.warn('Square cat crop failed, using original image.', error);
    return imageUrl;
  }
}

function loadImageFromSource(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
}
