import { isSupabaseConfigured, supabase } from './supabaseClient';

export const duplicateLocationRadiusMeters = 200;

const defaultAccurateLocation = {
  latitude: 3.1478,
  longitude: 101.6953,
  accuracyMeters: 280,
};

export async function autoDetectCatCrop(imageUrl) {
  const cutout = await createCatCutoutImage(imageUrl);

  return {
    croppedImageUrl: cutout.imageUrl,
    backgroundColor: cutout.backgroundColor,
    confidence: cutout.mode === 'cutout' ? 0.88 : 0.62,
    mode: cutout.mode,
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
    latitude: capture.latitude,
    longitude: capture.longitude,
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
      .select('cat_id')
      .eq('user_id', user.id),
  ]);

  if (catsError || userCatsError) {
    console.warn('Supabase cat load failed', catsError || userCatsError);
    return null;
  }

  const caughtIds = new Set((userCats || []).map((item) => item.cat_id));
  return (publicCats || []).map((cat) => mapSupabaseCat(cat, uiUserId, caughtIds.has(cat.id)));
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
  if (!isSupabaseConfigured) return false;

  const user = await getSupabaseUser();
  if (!user) return false;

  const userCatResult = await createSupabaseUserCat({
    userId: user.id,
    catId,
    capture,
  });

  if (!userCatResult) return false;

  await createSupabaseSighting({
    userId: user.id,
    catId,
    capture,
  });

  return true;
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

async function getSupabaseUser() {
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session?.user) return sessionData.session.user;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.warn('Supabase anonymous auth failed. Enable anonymous sign-ins or add a signed-in user.', error);
    return null;
  }

  return data.user;
}

async function createSupabaseUserCat({ userId, catId, capture, userGivenName = '', userNotes = '' }) {
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

function mapSupabaseCat(cat, uiUserId, caught) {
  return {
    id: cat.id,
    name: cat.name || 'Unnamed Cat',
    image_url: cat.cropped_image_url,
    cropped_image_url: cat.cropped_image_url,
    color: cat.colour || '',
    colour: cat.colour || '',
    breed: cat.breed || '',
    fun_info: cat.fun_facts || 'A neighborhood cat waiting to be discovered.',
    fun_facts: cat.fun_facts || '',
    remarks: '',
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
    created_at: cat.created_at,
    updated_at: cat.updated_at,
    map: { x: 52, y: 48 },
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

function toRadians(value) {
  return (value * Math.PI) / 180;
}

async function createCatCutoutImage(imageUrl) {
  try {
    const { removeBackground } = await import('@imgly/background-removal');
    const foregroundBlob = await removeBackground(imageUrl);
    const foregroundImage = await loadImageFromSource(URL.createObjectURL(foregroundBlob));
    const backgroundColor = sampleDominantForegroundColor(foregroundImage);

    return {
      imageUrl: await compositeCutoutOnColor(foregroundImage, backgroundColor),
      backgroundColor,
      mode: 'cutout',
    };
  } catch (error) {
    console.warn('Cat cutout failed, using centered color backdrop fallback.', error);
    const fallbackImage = await loadImageFromSource(imageUrl);
    const backgroundColor = sampleDominantImageColor(fallbackImage);

    return {
      imageUrl: await compositeFallbackOnColor(fallbackImage, backgroundColor),
      backgroundColor,
      mode: 'fallback-cutout',
    };
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

async function compositeCutoutOnColor(foregroundImage, backgroundColor) {
  const canvas = document.createElement('canvas');
  const size = 900;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const bounds = getOpaqueBounds(foregroundImage);
  const scale = Math.min((size * 0.78) / bounds.width, (size * 0.72) / bounds.height);
  const width = bounds.width * scale;
  const height = bounds.height * scale;
  const x = (size - width) / 2;
  const y = (size - height) / 2 + size * 0.02;

  paintPlainBackdrop(context, size, backgroundColor);
  context.save();
  context.shadowColor = 'rgba(38, 29, 24, 0.28)';
  context.shadowBlur = 30;
  context.shadowOffsetY = 18;
  context.drawImage(foregroundImage, bounds.x, bounds.y, bounds.width, bounds.height, x, y, width, height);
  context.restore();

  drawCutoutOutline(context, foregroundImage, bounds, x, y, width, height);
  context.drawImage(foregroundImage, bounds.x, bounds.y, bounds.width, bounds.height, x, y, width, height);

  return canvas.toDataURL('image/jpeg', 0.9);
}

async function compositeFallbackOnColor(image, backgroundColor) {
  const canvas = document.createElement('canvas');
  const size = 900;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const scale = Math.min((size * 0.82) / image.naturalWidth, (size * 0.82) / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const x = (size - width) / 2;
  const y = (size - height) / 2;

  paintPlainBackdrop(context, size, backgroundColor);
  context.save();
  context.shadowColor = 'rgba(38, 29, 24, 0.22)';
  context.shadowBlur = 24;
  context.shadowOffsetY = 14;
  context.drawImage(image, x, y, width, height);
  context.restore();

  return canvas.toDataURL('image/jpeg', 0.9);
}

function paintPlainBackdrop(context, size, backgroundColor) {
  context.fillStyle = softenColor(backgroundColor);
  context.fillRect(0, 0, size, size);
}

function drawCutoutOutline(context, image, bounds, x, y, width, height) {
  const mask = document.createElement('canvas');
  mask.width = context.canvas.width;
  mask.height = context.canvas.height;
  const maskContext = mask.getContext('2d');
  maskContext.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height, x, y, width, height);
  maskContext.globalCompositeOperation = 'source-in';
  maskContext.fillStyle = '#fff8ee';
  maskContext.fillRect(0, 0, mask.width, mask.height);

  context.save();
  context.filter = 'blur(4px)';
  for (const [offsetX, offsetY] of [[0, -7], [7, 0], [0, 7], [-7, 0], [5, 5], [-5, 5], [5, -5], [-5, -5]]) {
    context.drawImage(mask, offsetX, offsetY);
  }
  context.restore();
}

function getOpaqueBounds(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const alpha = data[(y * canvas.width + x) * 4 + 3];
      if (alpha > 20) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (minX > maxX || minY > maxY) {
    return { x: 0, y: 0, width: canvas.width, height: canvas.height };
  }

  const padding = 18;
  return {
    x: Math.max(0, minX - padding),
    y: Math.max(0, minY - padding),
    width: Math.min(canvas.width, maxX - minX + padding * 2),
    height: Math.min(canvas.height, maxY - minY + padding * 2),
  };
}

function sampleDominantForegroundColor(image) {
  const canvas = document.createElement('canvas');
  const sampleSize = 120;
  canvas.width = sampleSize;
  canvas.height = sampleSize;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, sampleSize, sampleSize);
  const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
  return quantizedDominantColor(pixels, true);
}

function sampleDominantImageColor(image) {
  const canvas = document.createElement('canvas');
  const sampleSize = 90;
  canvas.width = sampleSize;
  canvas.height = sampleSize;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, sampleSize, sampleSize);
  const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
  return quantizedDominantColor(pixels, false);
}

function quantizedDominantColor(pixels, requireAlpha) {
  const buckets = new Map();

  for (let index = 0; index < pixels.length; index += 16) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const alpha = pixels[index + 3];
    if (requireAlpha && alpha < 80) continue;
    if (red + green + blue > 700 || red + green + blue < 80) continue;

    const key = `${Math.round(red / 24) * 24},${Math.round(green / 24) * 24},${Math.round(blue / 24) * 24}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  const [dominant = '208,142,74'] = [...buckets.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  const [red, green, blue] = dominant.split(',').map(Number);
  return { red, green, blue };
}

function softenColor({ red, green, blue }) {
  const mix = (value) => Math.round(value * 0.68 + 255 * 0.32);
  return `rgb(${mix(red)}, ${mix(green)}, ${mix(blue)})`;
}
