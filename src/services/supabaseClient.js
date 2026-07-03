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

export async function signUpWithEmail({ name, email, password }) {
  if (!isSupabaseConfigured) {
    return { data: null, error: new Error('Supabase is not configured.') };
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
        full_name: name,
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

export async function signOutUser() {
  if (!isSupabaseConfigured) return;
  await supabase.auth.signOut();
}
