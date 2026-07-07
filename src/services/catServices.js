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

  const localCat = createNewCatWithCanonicalLocation({ capture, form, currentUserId: uiUserId });
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

  const userCatResult = await createSupabaseUserCat({
    userId,
    catId,
    capture,
  });

  if (!userCatResult) return false;

  await createSupabaseSighting({
    userId,
    catId,
    capture,
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
  const approximate = capture
    ? getApproximateLocation(capture.latitude, capture.longitude)
    : getApproximateLocation(null, null);

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
  const approximate = capture
    ? getApproximateLocation(capture.latitude, capture.longitude)
    : getApproximateLocation(null, null);

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
  const approximate = capture
    ? getApproximateLocation(capture.latitude, capture.longitude)
    : getApproximateLocation(null, null);

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
  return {
    id: cat.id,
    name: cat.name || 'Unnamed Cat',
    image_url: originalImageUrl || cat.cropped_image_url,
    original_image_url: originalImageUrl,
    cropped_image_url: cat.cropped_image_url,
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
    discovered_by: '',
    created_by: '',
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

function isPersistentImageUrl(value = '') {
  return /^https?:/i.test(value) || /^data:image\//i.test(value);
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

  if (latitude >= 3.195 && latitude <= 3.235 && longitude >= 101.725 && longitude <= 101.775) {
    return 'Melawati area';
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
