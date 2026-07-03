import { createClient } from '@supabase/supabase-js';

const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const supabaseUrl = normalizeSupabaseProjectUrl(rawSupabaseUrl);

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey)
  : null;

function normalizeSupabaseProjectUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    url.pathname = url.pathname
      .replace(/\/(auth|rest|storage|functions)\/v1\/?$/u, '')
      .replace(/\/+$/u, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/u, '');
  } catch {
    return trimmed.replace(/\/(auth|rest|storage|functions)\/v1\/?$/u, '').replace(/\/+$/u, '');
  }
}

function getAuthError(error) {
  if (!error) return null;

  if (error.message?.toLowerCase().includes('invalid path specified')) {
    return new Error(
      'Supabase URL should be your project URL only, like https://your-project-ref.supabase.co. Remove /auth/v1, /rest/v1, or any extra path from VITE_SUPABASE_URL.',
    );
  }

  return error;
}

export async function getCurrentSession() {
  if (!isSupabaseConfigured) return null;

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.warn('Supabase session lookup failed', error);
    return null;
  }

  return data.session;
}

export function subscribeToAuthChanges(callback) {
  if (!isSupabaseConfigured) return () => {};

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });

  return () => data.subscription.unsubscribe();
}

export async function signUpWithEmail({ username, email, password }) {
  if (!isSupabaseConfigured) {
    return { data: null, error: new Error('Supabase is not configured.') };
  }

  const cleanUsername = normalizeUsername(username);
  if (!cleanUsername) {
    return { data: null, error: new Error('Choose a username using letters, numbers, or underscores.') };
  }

  const { available, error: usernameError } = await checkUsernameAvailability(cleanUsername);
  if (usernameError) return { data: null, error: usernameError };
  if (!available) {
    return { data: null, error: new Error('That username is already taken. Try another one.') };
  }

  const emailRedirectTo = typeof window === 'undefined'
    ? undefined
    : window.location.origin;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo,
      data: {
        username: cleanUsername,
        full_name: cleanUsername,
        name: cleanUsername,
      },
    },
  });

  return { data, error: getAuthError(error) };
}

export async function signInWithEmail({ email, password }) {
  if (!isSupabaseConfigured) {
    return { data: null, error: new Error('Supabase is not configured.') };
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error: getAuthError(error) };
}

export async function resendSignupConfirmation(email) {
  if (!isSupabaseConfigured) {
    return { data: null, error: new Error('Supabase is not configured.') };
  }

  const emailRedirectTo = typeof window === 'undefined'
    ? undefined
    : window.location.origin;

  const { data, error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: {
      emailRedirectTo,
    },
  });

  return { data, error: getAuthError(error) };
}

export async function updateUserProfile({ name, avatarUrl, bio, publicProfile }) {
  if (!isSupabaseConfigured) {
    return { data: null, error: new Error('Supabase is not configured.') };
  }

  const { data, error } = await supabase.auth.updateUser({
    data: {
      full_name: name,
      name,
      avatar_url: avatarUrl,
      bio,
      public_profile: publicProfile,
    },
  });

  return { data, error: getAuthError(error) };
}

export async function checkUsernameAvailability(username, currentUserId = '') {
  if (!isSupabaseConfigured || !username.trim()) return { available: false, error: null };

  const cleanUsername = normalizeUsername(username);
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', cleanUsername)
    .maybeSingle();

  if (error) {
    if (error.message?.toLowerCase().includes('username')) {
      return {
        available: false,
        error: new Error('Username checking needs the latest Supabase schema. Please run supabase/schema.sql again.'),
      };
    }
    return { available: false, error };
  }

  return { available: !data || data.id === currentUserId, error: null };
}

export async function upsertCommunityProfile({ id, username, name, avatarUrl = '', bio = '', publicProfile = true }) {
  if (!isSupabaseConfigured || !id) return { data: null, error: null };

  const row = {
    id,
    display_name: name,
    avatar_url: avatarUrl,
    bio,
    public_profile: publicProfile,
    updated_at: new Date().toISOString(),
  };

  if (username) {
    row.username = normalizeUsername(username);
  }

  const { data, error } = await supabase
    .from('profiles')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single();

  return { data, error };
}

export async function searchCommunityProfilesByUsername(query, currentUserId) {
  if (!isSupabaseConfigured || !query.trim()) return { data: [], error: null };

  const cleanQuery = normalizeUsername(query);
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, bio, public_profile')
    .ilike('username', `%${cleanQuery}%`)
    .eq('public_profile', true)
    .neq('id', currentUserId)
    .limit(8);

  return { data: data || [], error };
}

export async function loadFollowingIds(userId) {
  if (!isSupabaseConfigured || !userId) return { data: [], error: null };

  const { data, error } = await supabase
    .from('user_follows')
    .select('following_id')
    .eq('follower_id', userId);

  return { data: (data || []).map((item) => item.following_id), error };
}

export async function loadFollowerIds(userId) {
  if (!isSupabaseConfigured || !userId) return { data: [], error: null };

  const { data, error } = await supabase
    .from('user_follows')
    .select('follower_id')
    .eq('following_id', userId);

  return { data: (data || []).map((item) => item.follower_id), error };
}

export async function loadProfilesByIds(ids) {
  if (!isSupabaseConfigured || !ids.length) return { data: [], error: null };

  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, bio, public_profile')
    .in('id', ids);

  return { data: data || [], error };
}

export function normalizeUsername(value = '') {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@/u, '')
    .replace(/[^a-z0-9_]/gu, '');
}

export async function followUserById(followerId, followingId) {
  if (!isSupabaseConfigured || !followerId || !followingId || followerId === followingId) {
    return { error: null };
  }

  const { error } = await supabase
    .from('user_follows')
    .upsert(
      {
        follower_id: followerId,
        following_id: followingId,
      },
      { onConflict: 'follower_id,following_id' },
    );

  return { error };
}

export async function unfollowUserById(followerId, followingId) {
  if (!isSupabaseConfigured || !followerId || !followingId) return { error: null };

  const { error } = await supabase
    .from('user_follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('following_id', followingId);

  return { error };
}

export async function uploadProfilePhoto(file, userId) {
  if (!isSupabaseConfigured) {
    return { publicUrl: '', error: new Error('Supabase is not configured.') };
  }

  if (!file) {
    return { publicUrl: '', error: new Error('Choose an image first.') };
  }

  if (!file.type.startsWith('image/')) {
    return { publicUrl: '', error: new Error('Profile photo must be an image file.') };
  }

  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${userId}/avatar-${Date.now()}.${extension}`;
  const { error } = await supabase.storage
    .from('profile-photos')
    .upload(path, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: true,
    });

  if (error) {
    return { publicUrl: '', error: getAuthError(error) };
  }

  const { data } = supabase.storage
    .from('profile-photos')
    .getPublicUrl(path);

  return { publicUrl: data.publicUrl, error: null };
}

export async function signOutUser() {
  if (!isSupabaseConfigured) return;
  await supabase.auth.signOut();
}
