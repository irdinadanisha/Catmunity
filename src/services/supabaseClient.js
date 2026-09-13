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

export function subscribeToUserNotifications(userId, callback) {
  if (!isSupabaseConfigured || !userId) return () => {};

  const channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      callback,
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToUserMessages(userId, callback) {
  if (!isSupabaseConfigured || !userId) return () => {};

  const channel = supabase
    .channel(`direct-messages:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'dm_messages',
      },
      callback,
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
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

export async function updateUserProfile({ username, name, avatarUrl, bio, publicProfile }, currentUserId = '') {
  if (!isSupabaseConfigured) {
    return { data: null, error: new Error('Supabase is not configured.') };
  }

  const cleanUsername = normalizeUsername(username);
  if (!cleanUsername) {
    return { data: null, error: new Error('Username cannot be empty.') };
  }

  const { available, error: usernameError } = await checkUsernameAvailability(cleanUsername, currentUserId);
  if (usernameError) return { data: null, error: usernameError };
  if (!available) {
    return { data: null, error: new Error('That username is already taken. Try another one.') };
  }

  const { data, error } = await supabase.auth.updateUser({
    data: {
      username: cleanUsername,
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
    .select('id, username, display_name, avatar_url, bio, public_profile, created_at')
    .ilike('username', `%${cleanQuery}%`)
    .eq('public_profile', true)
    .neq('id', currentUserId)
    .limit(8);

  return { data: data || [], error };
}

export async function searchMessageProfiles(query, currentUserId) {
  return searchCommunityProfilesByUsername(query, currentUserId);
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

export async function fetchFollowCounts(profileUserId) {
  if (!isSupabaseConfigured || !profileUserId) {
    return { data: { following: 0, followers: 0 }, error: null };
  }

  const [{ count: following = 0, error: followingError }, { count: followers = 0, error: followersError }] = await Promise.all([
    supabase
      .from('user_follows')
      .select('following_id', { count: 'exact', head: true })
      .eq('follower_id', profileUserId),
    supabase
      .from('user_follows')
      .select('follower_id', { count: 'exact', head: true })
      .eq('following_id', profileUserId),
  ]);

  return {
    data: {
      following: following || 0,
      followers: followers || 0,
    },
    error: followingError || followersError,
  };
}

export async function fetchFollowingList(profileUserId) {
  const { data: ids, error } = await loadFollowingIds(profileUserId);
  if (error) return { data: [], error };
  return loadProfilesByIds(ids);
}

export async function fetchFollowersList(profileUserId) {
  const { data: ids, error } = await loadFollowerIds(profileUserId);
  if (error) return { data: [], error };
  return loadProfilesByIds(ids);
}

export async function loadProfilesByIds(ids) {
  if (!isSupabaseConfigured || !ids.length) return { data: [], error: null };

  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, bio, public_profile, created_at')
    .in('id', ids);

  return { data: data || [], error };
}

export async function fetchFavoriteCatIds(userId) {
  if (!isSupabaseConfigured || !userId) return { data: [], error: null };

  const { data, error } = await supabase
    .from('user_favorite_cats')
    .select('cat_id, position')
    .eq('user_id', userId)
    .order('position', { ascending: true });

  if (error?.code === '42P01' || /user_favorite_cats/i.test(error?.message || '')) {
    return { data: [], error: null };
  }

  return { data: (data || []).map((item) => item.cat_id).filter(Boolean), error };
}

export async function fetchPublicCatStreaks(userIds = []) {
  const cleanIds = [...new Set(userIds.filter(Boolean))];
  if (!isSupabaseConfigured || !cleanIds.length) return { data: [], error: null };

  const { data, error } = await supabase
    .from('cat_streak_public')
    .select('user_id, current_streak, best_streak, last_qualified_date, updated_at')
    .in('user_id', cleanIds);

  if (error?.code === '42P01' || /cat_streak/i.test(error?.message || '')) {
    return { data: [], error: null };
  }

  return { data: data || [], error };
}

export async function fetchOwnCatStreak(userId) {
  if (!isSupabaseConfigured || !userId) return { data: null, error: null };

  const { data, error } = await supabase
    .from('cat_streaks')
    .select('user_id, current_streak, best_streak, last_qualified_date, paw_passes_used_this_month, paw_pass_month, updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error?.code === '42P01' || /cat_streak/i.test(error?.message || '')) {
    return { data: null, error: null };
  }

  return { data, error };
}

export async function saveFavoriteCatIds(userId, catIds = []) {
  if (!isSupabaseConfigured || !userId) return { data: [], error: null };

  const cleanCatIds = [...new Set(catIds.filter(Boolean))].slice(0, 3);
  const deleteResult = await supabase
    .from('user_favorite_cats')
    .delete()
    .eq('user_id', userId);

  if (deleteResult.error?.code === '42P01' || /user_favorite_cats/i.test(deleteResult.error?.message || '')) {
    return { data: [], error: null };
  }

  if (deleteResult.error) return { data: [], error: deleteResult.error };
  if (!cleanCatIds.length) return { data: [], error: null };

  const { data, error } = await supabase
    .from('user_favorite_cats')
    .insert(cleanCatIds.map((catId, position) => ({ user_id: userId, cat_id: catId, position })))
    .select('cat_id, position')
    .order('position', { ascending: true });

  return { data: (data || []).map((item) => item.cat_id).filter(Boolean), error };
}

export async function loadCommunityPosts(currentUserId) {
  if (!isSupabaseConfigured) return { data: { posts: [], comments: [], likes: [], profiles: [] }, error: null };

  async function loadPostsWithImages() {
    const result = await supabase
      .from('community_posts')
      .select('id, user_id, cat_id, caption, image_url, image_urls, location_name, capture_discovered_at, mentions, created_at')
      .order('created_at', { ascending: false });

    if (result.error?.code === 'PGRST204' || /image_urls/i.test(result.error?.message || '')) {
      return supabase
        .from('community_posts')
        .select('id, user_id, cat_id, caption, image_url, location_name, capture_discovered_at, mentions, created_at')
        .order('created_at', { ascending: false });
    }

    return result;
  }

  const [{ data: posts, error: postsError }, { data: comments, error: commentsError }, { data: likes, error: likesError }] = await Promise.all([
    loadPostsWithImages(),
    loadCommentsWithImages(),
    supabase
      .from('post_likes')
      .select('post_id, user_id'),
  ]);

  const error = postsError || commentsError || likesError;
  if (error) return { data: { posts: [], comments: [], likes: [], profiles: [] }, error };

  const postedCatIds = [...new Set((posts || []).map((post) => post.cat_id).filter(Boolean))];
  const postingUserIds = [...new Set((posts || []).map((post) => post.user_id).filter(Boolean))];
  let captureRows = [];
  if (postedCatIds.length && postingUserIds.length) {
    const { data: sightingRows, error: sightingRowsError } = await supabase
      .from('cat_sightings')
      .select('user_id, cat_id, discovered_at')
      .in('cat_id', postedCatIds)
      .in('user_id', postingUserIds)
      .order('discovered_at', { ascending: false });

    if (sightingRowsError) {
      console.warn('Supabase community post sighting time load failed', sightingRowsError);
    } else {
      captureRows = sightingRows || [];
    }
  }

  const profileIds = [
    ...new Set([
      ...(posts || []).map((post) => post.user_id),
      ...(comments || []).map((comment) => comment.user_id),
    ].filter(Boolean)),
  ];
  const { data: profiles, error: profilesError } = await loadProfilesByIds(profileIds);

  return {
    data: {
      posts: posts || [],
      comments: comments || [],
      likes: likes || [],
      captures: captureRows,
      profiles: profiles || [],
      currentUserId,
    },
    error: profilesError,
  };
}

async function loadCommentsWithImages() {
  const result = await supabase
    .from('comments')
    .select('id, post_id, user_id, body, image_urls, mentions, created_at')
    .order('created_at', { ascending: true });

  if (result.error?.code === 'PGRST204' || /image_urls/i.test(result.error?.message || '')) {
    return supabase
      .from('comments')
      .select('id, post_id, user_id, body, mentions, created_at')
      .order('created_at', { ascending: true });
  }

  return result;
}

export async function createCommunityPost({ userId, catId, caption, imageUrl, imageUrls = [], locationName, captureDiscoveredAt = null, mentions = [] }) {
  if (!isSupabaseConfigured) return { data: null, error: new Error('Supabase is not configured.') };

  const payload = {
    user_id: userId,
    cat_id: catId || null,
    caption,
    image_url: imageUrl || imageUrls[0] || null,
    image_urls: imageUrls.filter(Boolean),
    location_name: locationName || null,
    capture_discovered_at: catId ? captureDiscoveredAt : null,
    mentions,
  };

  const { data, error } = await supabase
    .from('community_posts')
    .insert(payload)
    .select()
    .single();

  if (error?.code === 'PGRST204' || /image_urls/i.test(error?.message || '')) {
    const { image_urls: _imageUrls, ...legacyPayload } = payload;
    return supabase
      .from('community_posts')
      .insert(legacyPayload)
      .select()
      .single();
  }

  return { data, error };
}

export async function deleteCommunityPost(postId, userId) {
  if (!isSupabaseConfigured) return { error: new Error('Supabase is not configured.') };

  const { error } = await supabase
    .from('community_posts')
    .delete()
    .eq('id', postId)
    .eq('user_id', userId);

  return { error };
}

export async function likeCommunityPost(postId, userId) {
  if (!isSupabaseConfigured) return { error: new Error('Supabase is not configured.') };

  const { error } = await supabase
    .from('post_likes')
    .upsert({ post_id: postId, user_id: userId }, { onConflict: 'post_id,user_id' });

  return { error };
}

export async function unlikeCommunityPost(postId, userId) {
  if (!isSupabaseConfigured) return { error: new Error('Supabase is not configured.') };

  const { error } = await supabase
    .from('post_likes')
    .delete()
    .eq('post_id', postId)
    .eq('user_id', userId);

  return { error };
}

export async function createCommunityComment({ postId, userId, body, imageUrls = [], mentions = [] }) {
  if (!isSupabaseConfigured) return { data: null, error: new Error('Supabase is not configured.') };

  const payload = {
    post_id: postId,
    user_id: userId,
    body,
    image_urls: imageUrls.filter(Boolean),
    mentions,
  };

  const { data, error } = await supabase
    .from('comments')
    .insert(payload)
    .select()
    .single();

  if (error?.code === 'PGRST204' || /image_urls/i.test(error?.message || '')) {
    const { image_urls: _imageUrls, ...legacyPayload } = payload;
    return supabase
      .from('comments')
      .insert(legacyPayload)
      .select()
      .single();
  }

  return { data, error };
}

export async function deleteCommunityComment(commentId) {
  if (!isSupabaseConfigured) return { error: new Error('Supabase is not configured.') };

  const { error } = await supabase
    .from('comments')
    .delete()
    .eq('id', commentId);

  return { error };
}

export async function fetchNotifications(userId) {
  if (!isSupabaseConfigured || !userId) return { data: [], error: null };

  const { data, error } = await supabase
    .from('notifications')
    .select('id, user_id, actor_user_id, type, title, body, related_post_id, related_cat_id, is_read, created_at, read_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(40);

  return { data: data || [], error };
}

export async function fetchUnreadNotificationCount(userId) {
  if (!isSupabaseConfigured || !userId) return { count: 0, error: null };

  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  return { count: count || 0, error };
}

export async function markNotificationsAsRead(userId) {
  if (!isSupabaseConfigured || !userId) return { error: null };

  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('is_read', false);

  return { error };
}

export async function createNotification(notificationData) {
  if (!isSupabaseConfigured || !notificationData?.userId) return { data: null, error: null };

  const { error } = await supabase
    .from('notifications')
    .insert({
      user_id: notificationData.userId,
      actor_user_id: notificationData.actorUserId || null,
      type: notificationData.type,
      title: notificationData.title,
      body: notificationData.body || '',
      related_post_id: notificationData.relatedPostId || null,
      related_cat_id: notificationData.relatedCatId || null,
    });

  return { data: null, error };
}

function getConversationKey(firstUserId, secondUserId) {
  return [firstUserId, secondUserId].sort().join(':');
}

function getOtherUserIdFromConversationKey(conversationKey = '', currentUserId = '') {
  return conversationKey.split(':').find((id) => id && id !== currentUserId) || '';
}

export async function openOrCreateConversation(currentUserId, otherUserId) {
  if (!isSupabaseConfigured || !currentUserId || !otherUserId || currentUserId === otherUserId) {
    return { data: null, error: currentUserId === otherUserId ? new Error('You cannot message yourself.') : null };
  }

  const conversationKey = getConversationKey(currentUserId, otherUserId);
  const { data: existing, error: existingError } = await supabase
    .from('dm_conversations')
    .select('id, conversation_key, created_by, created_at, updated_at')
    .eq('conversation_key', conversationKey)
    .maybeSingle();

  if (existingError) return { data: null, error: existingError };
  if (existing) return { data: existing, error: null };

  const { data: conversation, error: conversationError } = await supabase
    .from('dm_conversations')
    .insert({
      conversation_key: conversationKey,
      created_by: currentUserId,
    })
    .select('id, conversation_key, created_by, created_at, updated_at')
    .single();

  if (conversationError) return { data: null, error: conversationError };

  const { error: participantsError } = await supabase
    .from('dm_participants')
    .insert([
      { conversation_id: conversation.id, user_id: currentUserId, last_read_at: new Date().toISOString() },
      { conversation_id: conversation.id, user_id: otherUserId },
    ]);

  if (participantsError) return { data: null, error: participantsError };
  return { data: conversation, error: null };
}

export async function fetchUnreadMessageCount(currentUserId) {
  if (!isSupabaseConfigured || !currentUserId) return { count: 0, error: null };

  const { data: participants, error: participantsError } = await supabase
    .from('dm_participants')
    .select('conversation_id, last_read_at')
    .eq('user_id', currentUserId);

  if (participantsError || !participants?.length) {
    return { count: 0, error: participantsError || null };
  }

  const conversationIds = participants.map((item) => item.conversation_id);
  const { data: messages, error: messagesError } = await supabase
    .from('dm_messages')
    .select('id, conversation_id, sender_id, created_at')
    .in('conversation_id', conversationIds)
    .neq('sender_id', currentUserId);

  if (messagesError) return { count: 0, error: messagesError };

  const readByConversation = new Map(participants.map((item) => [
    item.conversation_id,
    item.last_read_at ? new Date(item.last_read_at).getTime() : 0,
  ]));
  const count = (messages || []).filter((message) => {
    const readAt = readByConversation.get(message.conversation_id) || 0;
    return new Date(message.created_at).getTime() > readAt;
  }).length;

  return { count, error: null };
}

export async function fetchMessageConversations(currentUserId) {
  if (!isSupabaseConfigured || !currentUserId) return { data: [], error: null };

  const { data: participants, error: participantsError } = await supabase
    .from('dm_participants')
    .select('conversation_id, last_read_at')
    .eq('user_id', currentUserId);

  if (participantsError || !participants?.length) {
    return { data: [], error: participantsError || null };
  }

  const conversationIds = participants.map((item) => item.conversation_id);
  const [{ data: conversations, error: conversationsError }, { data: messages, error: messagesError }] = await Promise.all([
    supabase
      .from('dm_conversations')
      .select('id, conversation_key, created_by, created_at, updated_at')
      .in('id', conversationIds),
    supabase
      .from('dm_messages')
      .select('id, conversation_id, sender_id, body, created_at')
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: false })
      .limit(300),
  ]);

  const error = conversationsError || messagesError;
  if (error) return { data: [], error };

  const participantByConversation = new Map(participants.map((item) => [item.conversation_id, item]));
  const latestByConversation = new Map();
  const unreadByConversation = new Map();
  (messages || []).forEach((message) => {
    if (!latestByConversation.has(message.conversation_id)) {
      latestByConversation.set(message.conversation_id, message);
    }
    const participant = participantByConversation.get(message.conversation_id);
    const readAt = participant?.last_read_at ? new Date(participant.last_read_at).getTime() : 0;
    const isUnread = message.sender_id !== currentUserId && new Date(message.created_at).getTime() > readAt;
    if (isUnread) {
      unreadByConversation.set(message.conversation_id, (unreadByConversation.get(message.conversation_id) || 0) + 1);
    }
  });

  const otherUserIds = [...new Set((conversations || [])
    .map((conversation) => getOtherUserIdFromConversationKey(conversation.conversation_key, currentUserId))
    .filter(Boolean))];
  const { data: profiles, error: profilesError } = await loadProfilesByIds(otherUserIds);
  if (profilesError) return { data: [], error: profilesError };

  const rows = (conversations || []).map((conversation) => {
    const otherUserId = getOtherUserIdFromConversationKey(conversation.conversation_key, currentUserId);
    const latestMessage = latestByConversation.get(conversation.id);
    return {
      ...conversation,
      otherUserId,
      otherUser: (profiles || []).find((profile) => profile.id === otherUserId) || null,
      latestMessage,
      unreadCount: unreadByConversation.get(conversation.id) || 0,
    };
  }).sort((first, second) => {
    const firstTime = new Date(first.latestMessage?.created_at || first.updated_at || first.created_at).getTime();
    const secondTime = new Date(second.latestMessage?.created_at || second.updated_at || second.created_at).getTime();
    return secondTime - firstTime;
  });

  return { data: rows, error: null };
}

export async function fetchConversationMessages(conversationId) {
  if (!isSupabaseConfigured || !conversationId) return { data: [], error: null };

  const { data, error } = await supabase
    .from('dm_messages')
    .select('id, conversation_id, sender_id, body, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  return { data: data || [], error };
}

export async function sendDirectMessage({ conversationId, senderId, body }) {
  if (!isSupabaseConfigured || !conversationId || !senderId || !body.trim()) {
    return { data: null, error: null };
  }

  const { data, error } = await supabase
    .from('dm_messages')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      body: body.trim(),
    })
    .select('id, conversation_id, sender_id, body, created_at')
    .single();

  if (!error) {
    await supabase
      .from('dm_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);
  }

  return { data, error };
}

export async function markConversationMessagesAsRead(conversationId, currentUserId) {
  if (!isSupabaseConfigured || !conversationId || !currentUserId) return { error: null };

  const { error } = await supabase
    .from('dm_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', currentUserId);

  return { error };
}

export async function fetchSuggestedMessageProfiles(currentUserId, limit = 7) {
  if (!isSupabaseConfigured || !currentUserId) return { data: [], error: null };

  const [{ data: following = [], error: followingError }, { data: followers = [], error: followersError }] = await Promise.all([
    loadFollowingIds(currentUserId),
    loadFollowerIds(currentUserId),
  ]);

  const error = followingError || followersError;
  if (error) return { data: [], error };

  const followerSet = new Set(followers);
  const orderedIds = [
    ...following.filter((id) => followerSet.has(id)),
    ...following,
    ...followers,
  ].filter((id, index, ids) => id && id !== currentUserId && ids.indexOf(id) === index).slice(0, limit);

  return loadProfilesByIds(orderedIds);
}

export async function loadProfilesByUsernames(usernames) {
  if (!isSupabaseConfigured || !usernames.length) return { data: [], error: null };

  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, bio, public_profile, created_at')
    .in('username', usernames);

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
