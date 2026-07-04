import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleMap, OverlayView, useJsApiLoader } from '@react-google-maps/api';
import { animate, motion, useMotionValue } from 'framer-motion';
import {
  Bell,
  Camera,
  Cat,
  Check,
  ChevronLeft,
  Compass,
  EyeOff,
  Heart,
  Home,
  Lock,
  LogOut,
  Map as MapIcon,
  MapPin,
  MessageCircle,
  PawPrint,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UnlockKeyhole,
  User,
  Users,
  X,
} from 'lucide-react';
import {
  addExistingCatToUserCollection,
  addExistingCatToSupabase,
  approximateLocation,
  autoDetectCatCrop,
  createNewCatInSupabase,
  createNewCatWithCanonicalLocation,
  duplicateLocationRadiusMeters,
  fetchPublicUserCollection,
  getCatMapPosition,
  getDistanceMeters,
  getCurrentAccurateLocation,
  getApproximateLocation,
  isWithinDuplicateRadius,
  loadCatsFromSupabase,
  removeCatFromUserCollection,
} from './services/catServices';
import {
  createCommunityComment,
  createCommunityPost,
  createNotification,
  deleteCommunityPost,
  fetchNotifications,
  fetchUnreadNotificationCount,
  followUserById,
  getCurrentSession,
  isSupabaseConfigured,
  likeCommunityPost,
  loadCommunityPosts,
  loadFollowerIds,
  loadFollowingIds,
  loadProfilesByIds,
  loadProfilesByUsernames,
  markNotificationsAsRead,
  normalizeUsername,
  resendSignupConfirmation,
  searchCommunityProfilesByUsername,
  signInWithEmail,
  signOutUser,
  signUpWithEmail,
  subscribeToAuthChanges,
  unfollowUserById,
  unlikeCommunityPost,
  updateUserProfile,
  upsertCommunityProfile,
  uploadProfilePhoto,
} from './services/supabaseClient';
import './styles/app.css';

const tabs = [
  { id: 'explore', label: 'Map', icon: MapIcon },
  { id: 'collection', label: 'Collection', icon: Cat },
  { id: 'catch', label: 'Catch', icon: Camera },
  { id: 'community', label: 'Community', icon: Users },
  { id: 'settings', label: 'Profile', icon: User },
];

const fallbackUserId = 'local-user';

function App() {
  const [screen, setScreen] = useState('explore');
  const [cats, setCats] = useState([]);
  const [posts, setPosts] = useState([]);
  const [capture, setCapture] = useState(null);
  const [draftCat, setDraftCat] = useState(null);
  const [selectedCatId, setSelectedCatId] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [publicProfileCats, setPublicProfileCats] = useState([]);
  const [postCatId, setPostCatId] = useState('');
  const [isProcessingCatPhoto, setIsProcessingCatPhoto] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);
  const [followingIds, setFollowingIds] = useState([]);
  const [followingProfiles, setFollowingProfiles] = useState([]);
  const [followerProfiles, setFollowerProfiles] = useState([]);
  const [socialUsers, setSocialUsers] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthLoading(false);
      return undefined;
    }

    let mounted = true;

    getCurrentSession().then((session) => {
      if (!mounted) return;
      setAuthUser(session?.user || null);
      setAuthLoading(false);
    });

    const unsubscribe = subscribeToAuthChanges((session) => {
      setAuthUser(session?.user || null);
      setScreen('explore');
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const currentUserId = authUser?.id || fallbackUserId;
  const me = createAppUser(authUser);

  useEffect(() => {
    if (!authUser) return;

    upsertCommunityProfile({
      id: currentUserId,
      username: me.username,
      name: me.name,
      avatarUrl: me.avatar_url,
      bio: me.bio,
      publicProfile: me.public_profile,
    });
  }, [authUser, currentUserId, me.username, me.name, me.avatar_url, me.bio, me.public_profile]);

  useEffect(() => {
    if (!authUser) {
      setFollowingIds([]);
      setFollowingProfiles([]);
      setFollowerProfiles([]);
      setSocialUsers([]);
      return undefined;
    }

    let cancelled = false;

    async function loadSocialGraph() {
      const [{ data: following = [] }, { data: followers = [] }] = await Promise.all([
        loadFollowingIds(currentUserId),
        loadFollowerIds(currentUserId),
      ]);
      const profileIds = [...new Set([...following, ...followers])];
      const { data: profiles = [] } = await loadProfilesByIds(profileIds);
      if (cancelled) return;

      const mappedProfiles = profiles.map(mapCommunityProfile);
      setFollowingIds(following);
      setFollowingProfiles(mappedProfiles.filter((profile) => following.includes(profile.id)));
      setFollowerProfiles(mappedProfiles.filter((profile) => followers.includes(profile.id)));
      setSocialUsers(mappedProfiles);
    }

    loadSocialGraph();

    return () => {
      cancelled = true;
    };
  }, [authUser, currentUserId]);

  useEffect(() => {
    if (!authUser) {
      setNotifications([]);
      setUnreadNotificationCount(0);
      return undefined;
    }

    let cancelled = false;

    async function loadNotifications() {
      const [{ data = [] }, { count = 0 }] = await Promise.all([
        fetchNotifications(currentUserId),
        fetchUnreadNotificationCount(currentUserId),
      ]);
      const actorIds = [...new Set(data.map((item) => item.actor_user_id).filter(Boolean))];
      const { data: actorProfiles = [] } = await loadProfilesByIds(actorIds);
      const actors = actorProfiles.map(mapCommunityProfile);
      if (cancelled) return;
      setSocialUsers((users) => mergeUsers([...users, ...actors]));
      setNotifications(data.map((item) => mapNotification(item, actors)));
      setUnreadNotificationCount(count);
    }

    loadNotifications();

    return () => {
      cancelled = true;
    };
  }, [authUser, currentUserId]);

  useEffect(() => {
    if (isSupabaseConfigured && !authUser) return undefined;

    let cancelled = false;

    async function loadLiveCats() {
      const liveCats = await loadCatsFromSupabase(currentUserId);
      if (cancelled) return;

      setCats(liveCats || []);
      setSelectedCatId((current) => current || liveCats?.[0]?.id || '');
    }

    loadLiveCats();

    return () => {
      cancelled = true;
    };
  }, [authUser, currentUserId]);

  useEffect(() => {
    if (isSupabaseConfigured && !authUser) return undefined;

    let cancelled = false;

    async function loadPosts() {
      const { data, error } = await loadCommunityPosts(currentUserId);
      if (cancelled) return;
      if (error) {
        showToast(error.message || 'Community posts could not load.');
        return;
      }
      const mapped = mapCommunityData(data, currentUserId);
      setPosts(mapped.posts);
      setSocialUsers((users) => mergeUsers([...users, ...mapped.users]));
    }

    loadPosts();

    return () => {
      cancelled = true;
    };
  }, [authUser, currentUserId]);

  const caughtCats = cats.filter((cat) => cat.caught_by_users.includes(currentUserId));
  const selectedCat = cats.find((cat) => cat.id === selectedCatId) || cats[0] || null;
  const communityUsers = useMemo(
    () => mergeUsers([me, ...socialUsers]),
    [me, socialUsers],
  );
  const selectedUser = communityUsers.find((user) => user.id === selectedUserId) || me;
  const publicCats = selectedUser.id === currentUserId ? caughtCats : publicProfileCats;

  const stats = useMemo(
    () => ({
      caught: caughtCats.length,
      locked: cats.length - caughtCats.length,
      areas: new Set(caughtCats.map((cat) => cat.location_name)).size,
    }),
    [cats, caughtCats],
  );

  function navigate(nextScreen) {
    setScreen(nextScreen);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showToast(message) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
  }

  async function openNotifications() {
    setNotificationsOpen(true);
    setUnreadNotificationCount(0);
    setNotifications((items) => items.map((item) => ({ ...item, isRead: true })));
    await markNotificationsAsRead(currentUserId);
  }

  async function refreshNotifications() {
    const [{ data = [] }, { count = 0 }] = await Promise.all([
      fetchNotifications(currentUserId),
      fetchUnreadNotificationCount(currentUserId),
    ]);
    const actorIds = [...new Set(data.map((item) => item.actor_user_id).filter(Boolean))];
    const { data: actorProfiles = [] } = await loadProfilesByIds(actorIds);
    const actors = actorProfiles.map(mapCommunityProfile);
    setSocialUsers((users) => mergeUsers([...users, ...actors]));
    setNotifications(data.map((item) => mapNotification(item, actors)));
    setUnreadNotificationCount(count);
  }

  async function handleAuthSubmit({ mode, username, email, password }) {
    const authAction = mode === 'signup' ? signUpWithEmail : signInWithEmail;
    const { data, error } = await authAction({ username, email, password });

    if (error) {
      throw error;
    }

    if (data.session?.user) {
      setAuthUser(data.session.user);
      showToast(mode === 'signup' ? 'Account created. Welcome to Catmunity.' : 'Welcome back.');
      return;
    }

    showToast('Check your email to confirm your Catmunity account.');
  }

  async function handleSignOut() {
    await signOutUser();
    setAuthUser(null);
    setCats([]);
    setPosts([]);
    setSelectedCatId('');
    showToast('Signed out.');
  }

  async function handleProfileSave(profile) {
    const { data, error } = await updateUserProfile(profile, currentUserId);
    if (error) {
      showToast(error.message || 'Profile update failed.');
      return;
    }

    if (data.user) {
      setAuthUser(data.user);
      await upsertCommunityProfile({
        id: data.user.id,
        username: data.user.user_metadata?.username,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        bio: profile.bio,
        publicProfile: profile.publicProfile,
      });
    }
    showToast('Profile updated.');
  }

  async function handleSearchFriends(query) {
    if (!isSupabaseConfigured) {
      return [];
    }

    const { data, error } = await searchCommunityProfilesByUsername(query, currentUserId);
    if (error) {
      showToast(error.message || 'Friend search failed.');
      return [];
    }

    const results = data.map(mapCommunityProfile);
    setSocialUsers((users) => mergeUsers([...users, ...results]));
    return results;
  }

  async function handleToggleFollow(userId) {
    const isFollowing = followingIds.includes(userId);
    const { error } = isFollowing
      ? await unfollowUserById(currentUserId, userId)
      : await followUserById(currentUserId, userId);

    if (error) {
      showToast(error.message || 'Could not update follow.');
      return;
    }

    setFollowingIds((ids) =>
      isFollowing ? ids.filter((id) => id !== userId) : [...new Set([...ids, userId])],
    );
    const user = communityUsers.find((item) => item.id === userId);
    if (user) {
      setFollowingProfiles((profiles) =>
        isFollowing ? profiles.filter((item) => item.id !== userId) : mergeUsers([...profiles, user]),
      );
    }
    if (!isFollowing) {
      await createNotification({
        userId,
        actorUserId: currentUserId,
        type: 'follow',
        title: `${me.name} followed you`,
        body: 'Tap to view their Catmunity profile.',
      });
    }
    showToast(isFollowing ? 'Friend unfollowed.' : 'Friend followed.');
  }

  async function handlePhotoSelected(file) {
    if (!file) return;
    setIsProcessingCatPhoto(true);
    const previewUrl = URL.createObjectURL(file);
    try {
      const crop = await autoDetectCatCrop(previewUrl);
      const position = await getCurrentAccurateLocation();
      setCapture({
        originalImage: previewUrl,
        croppedImage: crop.croppedImageUrl,
        cropMode: crop.mode,
        latitude: position.latitude,
        longitude: position.longitude,
        locationName: approximateLocation(position.latitude, position.longitude),
      });
      navigate('confirm');
    } finally {
      setIsProcessingCatPhoto(false);
    }
  }

  function handleConfirmCatch() {
    navigate('registrationChoice');
  }

  function startNewCatRegistration() {
    setDraftCat({
      name: 'Unnamed Cat',
      color: '',
      fun_info: '',
      remarks: '',
      tags: ['new find'],
      location_name: capture.locationName,
      cropped_image_url: capture.croppedImage,
    });
    navigate('detailsForm');
  }

  async function handleExistingCatRegistration(catId) {
    const existingCat = cats.find((cat) => cat.id === catId);
    if (!isWithinDuplicateRadius(existingCat, capture)) {
      showToast(`This sighting is more than ${duplicateLocationRadiusMeters}m from the original pin. Register it as a new cat.`);
      return;
    }

    await addExistingCatToSupabase({ catId, capture });
    const liveCats = await loadCatsFromSupabase(currentUserId);
    setCats(liveCats || ((items) => addExistingCatToUserCollection(items, catId, currentUserId, capture)));
    setSelectedCatId(catId);
    showToast('Existing cat added to your collection.');
    navigate('detail');
  }

  async function handleSaveDetails(form) {
    const localCat = createNewCatWithCanonicalLocation({
      capture,
      form: { ...draftCat, ...form },
      currentUserId,
    });
    const saved = await createNewCatInSupabase({
      capture,
      form: { ...draftCat, ...form },
      uiUserId: currentUserId,
    }) || localCat;

    setCats((items) => [saved, ...items]);
    setSelectedCatId(saved.id);
    showToast('New cat saved with one map pin.');
    navigate('collection');
  }

  function startCommunityPost(catId) {
    setPostCatId(catId);
    navigate('createPost');
  }

  async function refreshCommunityPosts() {
    const { data, error } = await loadCommunityPosts(currentUserId);
    if (error) {
      showToast(error.message || 'Community posts could not refresh.');
      return;
    }
    const mapped = mapCommunityData(data, currentUserId);
    setPosts(mapped.posts);
    setSocialUsers((users) => mergeUsers([...users, ...mapped.users]));
  }

  async function handleCreatePost(post) {
    const cat = cats.find((item) => item.id === post.catId);
    if (!cat || !cat.caught_by_users.includes(currentUserId)) {
      showToast('Only unlocked cats can be posted.');
      return;
    }

    const { data: createdPost, error } = await createCommunityPost({
      userId: currentUserId,
      catId: cat.id,
      caption: post.body,
      imageUrl: cat.cropped_image_url,
      locationName: cat.area_name || cat.location_name,
      mentions: extractMentions(post.body),
    });

    if (error) {
      showToast(error.message || 'Post could not be shared.');
      return;
    }

    await refreshCommunityPosts();
    await notifyMentionedUsers({
      text: post.body,
      type: 'mention',
      title: `${me.name} mentioned you`,
      body: post.body,
      relatedPostId: createdPost?.id,
      relatedCatId: cat.id,
    });
    showToast('Sighting posted.');
    navigate('community');
  }

  async function handleTogglePostLike(post) {
    const { error } = post.likedByMe
      ? await unlikeCommunityPost(post.id, currentUserId)
      : await likeCommunityPost(post.id, currentUserId);
    if (error) {
      showToast(error.message || 'Could not update like.');
      return;
    }
    if (!post.likedByMe && post.user_id !== currentUserId) {
      await createNotification({
        userId: post.user_id,
        actorUserId: currentUserId,
        type: 'like',
        title: `${me.name} liked your post`,
        body: post.body,
        relatedPostId: post.id,
        relatedCatId: post.cat_id,
      });
    }
    await refreshCommunityPosts();
  }

  async function handleCreateComment(postId, body) {
    const text = body.trim();
    if (!text) return;

    const { error } = await createCommunityComment({
      postId,
      userId: currentUserId,
      body: text,
      mentions: extractMentions(text),
    });
    if (error) {
      showToast(error.message || 'Comment could not be posted.');
      return;
    }
    const post = posts.find((item) => item.id === postId);
    if (post && post.user_id !== currentUserId) {
      await createNotification({
        userId: post.user_id,
        actorUserId: currentUserId,
        type: 'comment',
        title: `${me.name} commented on your post`,
        body: text,
        relatedPostId: post.id,
        relatedCatId: post.cat_id,
      });
    }
    await notifyMentionedUsers({
      text,
      type: 'mention',
      title: `${me.name} mentioned you`,
      body: text,
      relatedPostId: postId,
      relatedCatId: post?.cat_id,
    });
    await refreshCommunityPosts();
  }

  async function handleDeletePost(postId) {
    const { error } = await deleteCommunityPost(postId, currentUserId);
    if (error) {
      showToast(error.message || 'Post could not be deleted.');
      return;
    }
    await refreshCommunityPosts();
    showToast('Post deleted.');
  }

  async function handleRemoveCatFromCollection(catId) {
    const { error } = await removeCatFromUserCollection(currentUserId, catId);
    if (error) {
      showToast(error.message || 'Cat could not be removed.');
      return;
    }
    const liveCats = await loadCatsFromSupabase(currentUserId);
    setCats(liveCats || []);
    setSelectedCatId('');
    showToast('Cat removed from your collection.');
  }

  async function openPublicProfile(userId) {
    setSelectedUserId(userId);
    const collection = await fetchPublicUserCollection(userId, currentUserId);
    setPublicProfileCats(collection);
    navigate('publicProfile');
  }

  async function notifyMentionedUsers({ text, type, title, body, relatedPostId, relatedCatId }) {
    const mentions = extractMentions(text);
    if (!mentions.length) return;
    const { data: mentionedProfiles = [] } = await loadProfilesByUsernames(mentions);
    await Promise.all(
      mentionedProfiles
        .filter((profile) => profile.id !== currentUserId)
        .map((profile) =>
          createNotification({
            userId: profile.id,
            actorUserId: currentUserId,
            type,
            title,
            body,
            relatedPostId,
            relatedCatId,
          }),
        ),
    );
  }

  const commonProps = {
    cats,
    caughtCats,
    currentUser: me,
    currentUserId,
    navigate,
    selectedCat,
    setSelectedCatId,
  };


  if (authLoading) {
    return (
      <div className="app-shell">
        <main className="main auth-loading">
          <Sparkles size={26} />
          <p>Loading Catmunity...</p>
        </main>
      </div>
    );
  }

  if (isSupabaseConfigured && !authUser) {
    return (
      <div className="app-shell">
        {toast && <div className="toast"><Sparkles size={16} />{toast}</div>}
        <AuthScreen onSubmit={handleAuthSubmit} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      {toast && <div className="toast"><Sparkles size={16} />{toast}</div>}
      {screen !== 'welcome' && screen !== 'explore' && (
        <TopBar
          user={me}
          stats={stats}
          notificationCount={unreadNotificationCount}
          onOpenNotifications={openNotifications}
        />
      )}
      {notificationsOpen && (
        <NotificationCenter
          notifications={notifications}
          onClose={() => setNotificationsOpen(false)}
          onOpenUser={(id) => {
            setNotificationsOpen(false);
            openPublicProfile(id);
          }}
        />
      )}

      <motion.main
        key={screen}
        className={screen === 'welcome' ? 'main main--welcome' : screen === 'explore' ? 'main main--map' : 'main'}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      >
        {screen === 'welcome' && <WelcomeScreen onStart={() => navigate('explore')} />}
        {screen === 'explore' && <ExploreScreen {...commonProps} />}
        {screen === 'catch' && <CatchScreen onPhotoSelected={handlePhotoSelected} processing={isProcessingCatPhoto} />}
        {screen === 'confirm' && (
          <ConfirmScreen capture={capture} onBack={() => navigate('catch')} onConfirm={handleConfirmCatch} />
        )}
        {screen === 'registrationChoice' && (
          <RegistrationChoiceScreen
            cats={cats}
            capture={capture}
            currentUserId={currentUserId}
            onBack={() => navigate('confirm')}
            onNewCat={startNewCatRegistration}
            onExistingCat={handleExistingCatRegistration}
          />
        )}
        {screen === 'detailsForm' && (
          <CatDetailsForm cat={draftCat} onSave={handleSaveDetails} onBack={() => navigate('confirm')} />
        )}
        {screen === 'collection' && (
          <CollectionScreen
            {...commonProps}
            stats={stats}
            user={me}
            onPostCat={startCommunityPost}
            onRemoveCat={handleRemoveCatFromCollection}
          />
        )}
        {screen === 'detail' && <CatDetailScreen {...commonProps} />}
        {screen === 'publicProfile' && (
          <PublicProfileScreen
            user={selectedUser}
            cats={publicCats}
            currentUserId={currentUserId}
            onBack={() => navigate('collection')}
            onPostCat={startCommunityPost}
            onSelectCat={(id) => {
              setSelectedCatId(id);
              navigate('detail');
            }}
          />
        )}
        {screen === 'community' && (
          <CommunityScreen
            posts={posts}
            cats={cats}
            users={communityUsers}
            currentUser={me}
            currentUserId={currentUserId}
            followingIds={followingIds}
            followingProfiles={followingProfiles}
            followerProfiles={followerProfiles}
            onSearchFriends={handleSearchFriends}
            onToggleFollow={handleToggleFollow}
            onCreate={() => {
              if (!caughtCats.length) {
                showToast('Catch your first cat to get started!');
                return;
              }
              startCommunityPost(caughtCats[0].id);
            }}
            onToggleLike={handleTogglePostLike}
            onComment={handleCreateComment}
            onDeletePost={handleDeletePost}
            onOpenUser={(id) => {
              openPublicProfile(id);
            }}
          />
        )}
        {screen === 'createPost' && (
          <CreatePostScreen
            cat={caughtCats.find((item) => item.id === postCatId)}
            onBack={() => navigate('collection')}
            onCreate={handleCreatePost}
          />
        )}
        {screen === 'settings' && (
          <SettingsScreen
            user={me}
            userId={currentUserId}
            signedIn={Boolean(authUser)}
            onProfileSave={handleProfileSave}
            onSignOut={handleSignOut}
          />
        )}
      </motion.main>

      {screen !== 'welcome' && (
        <nav className={screen === 'explore' ? 'bottom-nav bottom-nav--map' : 'bottom-nav'} aria-label="Main navigation">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = screen === tab.id || (tab.id === 'collection' && ['detail', 'publicProfile'].includes(screen));
            return (
              <button className={active ? 'nav-item active' : 'nav-item'} key={tab.id} onClick={() => navigate(tab.id)}>
                <Icon size={20} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      )}
      {screen !== 'welcome' && <CatchButton onClick={() => navigate('catch')} />}
    </div>
  );
}

function createAppUser(authUser) {
  if (!authUser) {
    return {
      id: fallbackUserId,
      username: 'guest',
      name: 'Catmunity Friend',
      avatar_url: '',
      bio: 'Saving neighborhood cat memories with Catmunity.',
      public_profile: true,
      email: '',
    };
  }

  const displayName =
    authUser.user_metadata?.full_name ||
    authUser.user_metadata?.name ||
    authUser.user_metadata?.username ||
    authUser.email?.split('@')[0] ||
    'Catmunity Friend';
  const username = normalizeUsername(authUser.user_metadata?.username || authUser.email?.split('@')[0] || displayName);

  return {
    id: authUser.id,
    username,
    name: displayName,
    avatar_url: authUser.user_metadata?.avatar_url || '',
    bio: authUser.user_metadata?.bio || 'Saving neighborhood cat memories with Catmunity.',
    public_profile: authUser.user_metadata?.public_profile ?? true,
    email: authUser.email,
  };
}

function mapCommunityProfile(profile) {
  return {
    id: profile.id,
    username: profile.username || '',
    name: profile.display_name || profile.username || 'Catmunity Friend',
    avatar_url: profile.avatar_url || '',
    bio: profile.bio || '',
    public_profile: profile.public_profile,
  };
}

function mapNotification(notification, actors = []) {
  const actor = actors.find((user) => user.id === notification.actor_user_id);
  return {
    id: notification.id,
    type: notification.type,
    user: actor || (notification.actor_user_id ? { id: notification.actor_user_id, name: 'Catmunity friend' } : null),
    title: notification.title,
    text: notification.body || '',
    isRead: notification.is_read,
    relatedPostId: notification.related_post_id,
    relatedCatId: notification.related_cat_id,
  };
}

function mergeUsers(users) {
  const byId = new Map();
  users.filter(Boolean).forEach((user) => byId.set(user.id, user));
  return [...byId.values()];
}

function mapCommunityData(data, currentUserId) {
  const users = (data.profiles || []).map(mapCommunityProfile);
  const commentsByPost = new Map();
  const likesByPost = new Map();

  (data.likes || []).forEach((like) => {
    const likes = likesByPost.get(like.post_id) || [];
    likes.push(like.user_id);
    likesByPost.set(like.post_id, likes);
  });

  (data.comments || []).forEach((comment) => {
    const comments = commentsByPost.get(comment.post_id) || [];
    const author = users.find((user) => user.id === comment.user_id);
    comments.push({
      id: comment.id,
      post_id: comment.post_id,
      user_id: comment.user_id,
      body: comment.body,
      mentions: comment.mentions || [],
      created_at: formatPostTime(comment.created_at),
      user: author,
    });
    commentsByPost.set(comment.post_id, comments);
  });

  const posts = (data.posts || []).map((post) => {
    const likeUsers = likesByPost.get(post.id) || [];
    return {
      id: post.id,
      user_id: post.user_id,
      cat_id: post.cat_id,
      image_url: post.image_url,
      body: post.caption,
      location_name: post.location_name || 'Catmunity',
      mentions: post.mentions || [],
      created_at: formatPostTime(post.created_at),
      likeCount: likeUsers.length,
      likedByMe: likeUsers.includes(currentUserId),
      comments: commentsByPost.get(post.id) || [],
    };
  });

  return { posts, users };
}

function extractMentions(text = '') {
  return [...new Set((text.match(/@([a-z0-9_]+)/giu) || []).map((mention) => normalizeUsername(mention)))];
}

function formatPostTime(value) {
  if (!value) return 'Just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Just now';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function renderMentionText(text = '') {
  const pieces = text.split(/(@[a-z0-9_]+)/giu);
  return pieces.map((piece, index) => (
    /^@[a-z0-9_]+$/iu.test(piece)
      ? <strong className="mention" key={`${piece}-${index}`}>{piece}</strong>
      : <React.Fragment key={`${piece}-${index}`}>{piece}</React.Fragment>
  ));
}

function UserHandle({ user }) {
  if (!user?.username) return null;
  return <small className="username-line">@{user.username}</small>;
}

function AuthScreen({ onSubmit }) {
  const [mode, setMode] = useState('signup');
  const [username, setUsername] = useState('irdina');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [canResendConfirmation, setCanResendConfirmation] = useState(false);
  const isSignup = mode === 'signup';

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setStatus('');

    try {
      await onSubmit({ mode, username, email, password });
      setStatus(isSignup ? 'If email confirmation is enabled, check your inbox before signing in.' : '');
      setCanResendConfirmation(isSignup);
    } catch (error) {
      setStatus(error.message || 'Authentication failed. Please try again.');
      setCanResendConfirmation(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResendConfirmation() {
    if (!email) {
      setStatus('Enter your email first, then resend the confirmation.');
      return;
    }

    setSubmitting(true);
    setStatus('');

    const { error } = await resendSignupConfirmation(email);
    setSubmitting(false);

    if (error) {
      setStatus(error.message || 'Could not resend confirmation email.');
      return;
    }

    setStatus('Confirmation email resent. Check inbox, spam, and promotions folders.');
  }

  return (
    <main className="auth-screen">
      <div className="auth-brand">
        <span className="auth-paw-mark"><PawPrint size={25} /></span>
        <p className="eyebrow auth-wordmark">Catmunity</p>
        <h1>{isSignup ? 'Create your cat hunt profile!' : 'Welcome back.'}</h1>
        <p>Sign in so your caught cats, map pins, and collection data stay attached to you.</p>
      </div>

      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-toggle" aria-label="Authentication mode">
          <button type="button" className={isSignup ? 'active' : ''} onClick={() => setMode('signup')}>
            Sign up
          </button>
          <button type="button" className={!isSignup ? 'active' : ''} onClick={() => setMode('signin')}>
            Log in
          </button>
        </div>

        {isSignup && (
          <label>
            <span>Username</span>
            <input
              value={username}
              placeholder="irdina"
              autoComplete="username"
              required
              onChange={(event) => setUsername(normalizeUsername(event.target.value))}
            />
          </label>
        )}
        <label>
          <span>Email</span>
          <input
            type="email"
            value={email}
            placeholder="you@email.com"
            autoComplete="email"
            required
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            value={password}
            placeholder="At least 6 characters"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            minLength={6}
            required
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {status && <p className="auth-status">{status}</p>}

        <button className="primary-button" type="submit" disabled={submitting}>
          <ShieldCheck size={18} /> {submitting ? 'Please wait...' : isSignup ? 'Create account' : 'Log in'}
        </button>
        {canResendConfirmation && (
          <button className="auth-resend-button" type="button" disabled={submitting} onClick={handleResendConfirmation}>
            Resend confirmation email
          </button>
        )}
      </form>
    </main>
  );
}

function TopBar({ user, stats, notificationCount = 0, onOpenNotifications }) {
  return (
    <header className="top-bar">
      <div>
        <p className="eyebrow top-brand"><PawPrint size={13} /> Catmunity</p>
        <h1>Hi, {user.name}</h1>
      </div>
      <div className="top-actions">
        <span className="pill"><Cat size={15} />{stats.caught}</span>
        <button className="icon-button notification-button" aria-label="Notifications" onClick={onOpenNotifications}>
          <Bell size={20} />
          {notificationCount > 0 && <span>{notificationCount}</span>}
        </button>
      </div>
    </header>
  );
}

function NotificationCenter({ notifications, onClose, onOpenUser }) {
  return (
    <div className="notification-overlay" role="dialog" aria-modal="true" aria-label="Notifications">
      <section className="notification-panel">
        <div className="section-title-row">
          <h2>Notifications</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close notifications"><X size={18} /></button>
        </div>
        <div className="notification-list">
          {notifications.map((item) => (
            <button
              className="notification-item"
              key={item.id}
              type="button"
              onClick={() => item.user && onOpenUser(item.user.id)}
            >
              {item.user ? <UserAvatar user={item.user} className="post-user-avatar" /> : <span className="notification-icon"><Sparkles size={18} /></span>}
              <span>
                <strong>{item.title}</strong>
                <small>{item.text}</small>
              </span>
            </button>
          ))}
          {notifications.length === 0 && (
            <p className="empty-community-copy">No notifications yet. New follows and post interactions will appear here.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function WelcomeScreen({ onStart }) {
  return (
    <section className="welcome">
      <div className="welcome-art" aria-hidden="true">
        <div className="moon" />
        <div className="cat-face">
          <span className="ear left" />
          <span className="ear right" />
          <span className="eye left" />
          <span className="eye right" />
          <span className="nose" />
          <span className="whisker one" />
          <span className="whisker two" />
        </div>
      </div>
      <p className="eyebrow">Cute real-world sightings</p>
      <h1>Collect neighborhood cats with kindness.</h1>
      <p>Spot a cat, save the memory, unlock gentle local discoveries, and share the sweetest sightings with friends.</p>
      <button className="primary-button" onClick={onStart}><Compass size={18} /> Start exploring</button>
      <div className="safety-strip"><ShieldCheck size={17} /> Photograph from a respectful distance. No chasing, trespassing, or disturbing cats.</div>
    </section>
  );
}

function ExploreScreen({ cats, currentUser, currentUserId, navigate, setSelectedCatId }) {
  const [activeCatId, setActiveCatId] = useState(cats[0]?.id);
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [hideCaught, setHideCaught] = useState(false);
  const [sortMode, setSortMode] = useState('Recent');
  const [sheetFocusSignal, setSheetFocusSignal] = useState(0);
  const filters = ['All', 'Nearby', 'Unlocked', 'Locked', 'Friendly', 'Sleepy', 'Food Spots'];
  const nearbyCats = cats.filter((cat) => {
    const caught = cat.caught_by_users.includes(currentUserId);
    const matchesQuery = `${cat.name} ${cat.location_name} ${cat.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase());
    const matchesCaught = !hideCaught || !caught;
    const matchesFilter =
      activeFilter === 'All' ||
      activeFilter === 'Nearby' ||
      (activeFilter === 'Unlocked' && caught) ||
      (activeFilter === 'Locked' && !caught) ||
      cat.tags.some((tag) => tag.toLowerCase().includes(activeFilter.toLowerCase().replace(' spots', '')));
    return matchesQuery && matchesCaught && matchesFilter;
  });

  function openCat(cat) {
    setSelectedCatId(cat.id);
    navigate('detail');
  }

  function selectCatOnMap(cat) {
    setActiveCatId(cat.id);
    setSelectedCatId(cat.id);
    setSheetFocusSignal((signal) => signal + 1);
  }

  return (
    <section className="explore-live">
      <div className="map-brand">
        <PawPrint size={18} />
        <span>Catmunity</span>
      </div>
      <div className="live-map-shell has-google-map">
        <GoogleCatMap
          cats={cats}
          currentUser={currentUser}
          currentUserId={currentUserId}
          activeCatId={activeCatId}
          onSelect={selectCatOnMap}
        />
      </div>

      <DraggableBottomSheet
        focusSignal={sheetFocusSignal}
        header={(
          <>
            <div className="sheet-search-row">
              <Search size={18} />
              <input
                value={query}
                placeholder="Search cats around you..."
                onChange={(event) => setQuery(event.target.value)}
              />
              <button aria-label="Filters"><SlidersHorizontal size={17} /></button>
            </div>
            <div className="filter-rail" aria-label="Cat filters">
              {filters.map((filter) => (
                <FilterChip
                  key={filter}
                  active={activeFilter === filter}
                  label={filter}
                  onClick={() => setActiveFilter(filter)}
                />
              ))}
            </div>
            <div className="sheet-meta-row">
              <strong>{nearbyCats.length} {nearbyCats.length === 1 ? 'cat' : 'cats'} nearby</strong>
              <div className="sheet-toggles">
                <button className={hideCaught ? 'mini-chip active' : 'mini-chip'} onClick={() => setHideCaught(!hideCaught)}>
                  <EyeOff size={14} /> Hide caught
                </button>
                <button className="mini-chip" onClick={() => setSortMode(sortMode === 'Recent' ? 'Nearest' : 'Recent')}>
                  {sortMode}
                </button>
              </div>
            </div>
          </>
        )}
      >
        <div className="sheet-expanded-tools">
          <span><MapPin size={14} /> Within 2 km</span>
          <span><Sparkles size={14} /> Updated now</span>
          <span><ShieldCheck size={14} /> Safe distance</span>
        </div>
        <div className="sheet-list">
          {nearbyCats.map((cat, index) => (
            <CatCard
              key={cat.id}
              cat={{ ...cat, distance: `${(index * 0.16 + 0.08).toFixed(2)} km` }}
              locked={!cat.caught_by_users.includes(currentUserId)}
              onOpen={() => {
                setActiveCatId(cat.id);
                setSelectedCatId(cat.id);
                navigate('detail');
              }}
              action={() => openCat(cat)}
            />
          ))}
          {nearbyCats.length === 0 && (
            <p className="empty-community-copy">No cats discovered yet. Catch your first cat to get started!</p>
          )}
        </div>
      </DraggableBottomSheet>
    </section>
  );
}

function CatchScreen({ onPhotoSelected, processing = false }) {
  return (
    <section className="screen catch-screen">
      <div className="catch-hero-copy">
        <span className="header-icon"><Camera size={22} /></span>
        <h1>Catch the cat!</h1>
        <p>Ask the cat to pose for the gram!</p>
      </div>
      <label className={processing ? 'upload-panel processing' : 'upload-panel'}>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={processing}
          onChange={(event) => onPhotoSelected(event.target.files?.[0])}
        />
        <Camera size={38} />
        <strong>{processing ? 'Preparing square crop...' : 'Click here to catch!'}</strong>
        <span>{processing ? 'Standardizing the photo into a square cat image.' : 'Make sure they’re looking cute!'}</span>
      </label>
      <div className="safety-strip"><ShieldCheck size={17} /> Keep paws, people, and private spaces respected.</div>
    </section>
  );
}

function ConfirmScreen({ capture, onBack, onConfirm }) {
  if (!capture) return null;
  return (
    <section className="screen">
      <BackButton onBack={onBack} />
      <ScreenHeader title="Catch this cat?" subtitle={`Location saved as ${capture.locationName}.`} icon={Sparkles} />
      <div className="confirm-frame">
        <img src={capture.croppedImage} alt="Cropped cat preview" />
        <span className="pill">{capture.cropMode === 'square-crop' ? 'Square crop ready' : 'Photo ready'}</span>
      </div>
      <div className="confirm-actions">
        <button className="secondary-button" onClick={onBack}><X size={18} /> Retake</button>
        <button className="primary-button" onClick={onConfirm}><Check size={18} /> Cat caught!</button>
      </div>
    </section>
  );
}

function RegistrationChoiceScreen({ cats, capture, currentUserId, onBack, onNewCat, onExistingCat }) {
  const nearbyCats = cats
    .map((cat) => ({
      cat,
      distance: Math.round(getDistanceMeters({
        latitude: cat.canonical_latitude ?? cat.latitude,
        longitude: cat.canonical_longitude ?? cat.longitude,
      }, capture)),
    }))
    .filter(({ distance }) => Number.isFinite(distance) && distance <= duplicateLocationRadiusMeters);

  return (
    <section className="screen registration-choice-screen">
      <BackButton onBack={onBack} />
      <ScreenHeader
        title="Is this one of the cats already discovered nearby?"
        subtitle="Choose a nearby cat to avoid duplicate pins, or continue as a new cat."
        icon={ShieldCheck}
      />
      <button className="new-cat-choice" onClick={onNewCat}>
        <Plus size={20} />
        <span>
          <strong>No, this is a new cat</strong>
          <small>Create one canonical map pin for this cat.</small>
        </span>
      </button>
      <div className="section-title-row">
        <h2>Nearby matches</h2>
        <span className="quiet-label">{nearbyCats.length} within {duplicateLocationRadiusMeters}m</span>
      </div>
      <div className="existing-cat-list">
        {nearbyCats.map(({ cat, distance }) => {
          const caught = cat.caught_by_users.includes(currentUserId);
          return (
            <button
              key={cat.id}
              className="existing-cat-choice"
              onClick={() => onExistingCat(cat.id)}
            >
              <img src={cat.cropped_image_url} alt={cat.name || 'Cat'} />
              <span>
                <strong>{cat.name || 'Unnamed Cat'}</strong>
                <small>
                  {distance}m from original pin
                </small>
              </span>
              <em>{caught ? 'Already yours' : 'Yes, this is the same cat'}</em>
            </button>
          );
        })}
        {nearbyCats.length === 0 && (
          <p className="empty-community-copy">No cats found within {duplicateLocationRadiusMeters}m. Continue as a new cat.</p>
        )}
      </div>
      <div className="safety-strip">
        <ShieldCheck size={17} />
        Existing cats can be linked only within {duplicateLocationRadiusMeters}m and never move their original map pin.
      </div>
    </section>
  );
}

function CatDetailsForm({ cat, onSave, onBack }) {
  const [form, setForm] = useState({
    name: cat?.name || '',
    color: cat?.color || '',
    fun_info: cat?.fun_info || '',
    remarks: cat?.remarks || '',
    tags: cat?.tags?.join(', ') || '',
    location_name: cat?.location_name || '',
    date_found: new Date().toISOString().slice(0, 10),
  });

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <section className="screen">
      <BackButton onBack={onBack} />
      <ScreenHeader title="Add cat details" subtitle="A few notes make your collection feel personal." icon={Cat} />
      <form
        className="details-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            ...form,
            name: form.name.trim() || 'Unnamed Cat',
            tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
          });
        }}
      >
        <img className="form-photo" src={cat?.cropped_image_url} alt="Newly caught cat" />
        <Field label="Cat name" value={form.name} placeholder="Unnamed Cat" onChange={(value) => update('name', value)} />
        <Field label="Color" value={form.color} placeholder="Orange, black, tabby..." onChange={(value) => update('color', value)} />
        <Field label="Personality / fun info" value={form.fun_info} placeholder="Sleepy window watcher" onChange={(value) => update('fun_info', value)} />
        <Field label="Your remarks" value={form.remarks} placeholder="Seen near the cafe steps" onChange={(value) => update('remarks', value)} />
        <Field label="Tags" value={form.tags} placeholder="sleepy, friendly, fluffy" onChange={(value) => update('tags', value)} />
        <Field label="Location found" value={form.location_name} onChange={(value) => update('location_name', value)} />
        <Field label="Date found" type="date" value={form.date_found} onChange={(value) => update('date_found', value)} />
        <button className="primary-button" type="submit"><Check size={18} /> Save to collection</button>
      </form>
    </section>
  );
}

function CollectionScreen({ caughtCats, stats, user, navigate, setSelectedCatId, onPostCat, onRemoveCat }) {
  return (
    <section className="screen collection-screen">
      <div className="profile-hero">
        <UserAvatar user={user} className="profile-hero-avatar" />
        <div>
          <p className="eyebrow">Public profile</p>
          <h1>{user.name}</h1>
          <UserHandle user={user} />
          <p>{user.bio}</p>
        </div>
        <span className="profile-status"><ShieldCheck size={14} /> {user.public_profile ? 'Public' : 'Private'}</span>
      </div>
      <div className="metric-tabs" aria-label="Collection stats">
        <Stat label="Caught" value={stats.caught} icon={Cat} />
        <Stat label="Areas" value={stats.areas} icon={MapPin} />
      </div>
      <div className="section-title-row">
        <h2>Discovery map</h2>
        <span className="quiet-label">Original pins</span>
      </div>
      <MiniMap cats={caughtCats} onSelect={(cat) => {
        setSelectedCatId(cat.id);
        navigate('detail');
      }} />
      <div className="section-title-row">
        <h2>Discovered cats</h2>
        <span className="quiet-label">{caughtCats.length} profiles</span>
      </div>
      <div className="profile-cat-grid">
        {caughtCats.map((cat) => (
          <DiscoveredCatCard
            key={cat.id}
            cat={cat}
            viewerHasUnlocked
            isOwnProfile
            onOpen={() => {
              setSelectedCatId(cat.id);
              navigate('detail');
            }}
            onPostToCommunity={() => onPostCat(cat.id)}
            onRemoveFromCollection={() => onRemoveCat(cat.id)}
          />
        ))}
        {caughtCats.length === 0 && (
          <p className="empty-community-copy">No cats discovered yet. Catch your first cat to get started!</p>
        )}
      </div>
    </section>
  );
}

function CatDetailScreen({ selectedCat, currentUserId }) {
  if (!selectedCat) {
    return (
      <section className="screen">
        <ScreenHeader title="No cat selected" subtitle="Catch your first cat to get started!" icon={Cat} />
      </section>
    );
  }

  const locked = !selectedCat.caught_by_users.includes(currentUserId);
  const estimatedCat = getEstimatedMapCat(selectedCat);
  return (
    <section className="screen">
      <ScreenHeader title={selectedCat.name || 'Unnamed Cat'} subtitle={locked ? 'Estimated discovery area' : selectedCat.location_name} icon={locked ? Lock : Cat} />
      <div className="detail-hero">
        <img src={selectedCat.cropped_image_url} alt={selectedCat.name || 'Cat'} />
        {locked && <div className="lock-overlay"><Lock size={30} /> Limited preview</div>}
      </div>
      {locked && (
        <div className="locked-location-panel">
          <div className="section-title-row">
            <h2>Estimated location</h2>
            <span className="quiet-label">{selectedCat.area_name || 'Approximate area'}</span>
          </div>
          <MiniMap cats={[estimatedCat]} approximate />
        </div>
      )}
      {!locked && (
        <div className="detail-panel">
          <InfoRow label="Color" value={selectedCat.color} />
          <InfoRow label="Fun info" value={selectedCat.fun_info} />
          <InfoRow label="Remarks" value={selectedCat.remarks} />
          <InfoRow label="Area" value={selectedCat.location_name} />
          <div className="tag-row">
            {selectedCat.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        </div>
      )}
    </section>
  );
}

function getEstimatedMapCat(cat) {
  const latitude = cat.approximate_latitude ?? cat.latitude;
  const longitude = cat.approximate_longitude ?? cat.longitude;

  return {
    ...cat,
    latitude,
    longitude,
    canonical_latitude: latitude,
    canonical_longitude: longitude,
    location_name: cat.area_name || 'Approximate area',
  };
}

function PublicProfileScreen({ user, cats, currentUserId, onBack, onSelectCat, onPostCat }) {
  return (
    <section className="screen">
      <BackButton onBack={onBack} />
      <div className="profile-header">
        <UserAvatar user={user} className="profile-header-avatar" />
        <div>
          <p className="eyebrow">Public profile</p>
          <h1>{user.name}</h1>
          <UserHandle user={user} />
          <p>{user.bio}</p>
        </div>
      </div>
      <MiniMap cats={cats} approximate />
      <div className="gallery-grid">
        {cats.map((cat) => {
          const viewerHasUnlocked = cat.caught_by_users.includes(currentUserId);
          return (
            <DiscoveredCatCard
              key={cat.id}
              cat={cat}
              viewerHasUnlocked={viewerHasUnlocked}
              isOwnProfile={false}
              onOpen={() => onSelectCat(cat.id)}
              onPostToCommunity={viewerHasUnlocked ? () => onPostCat(cat.id) : null}
            />
          );
        })}
        {cats.length === 0 && (
          <p className="empty-community-copy">No cats discovered yet.</p>
        )}
      </div>
    </section>
  );
}

function DiscoveredCatCard({
  cat,
  isOwnProfile,
  viewerHasUnlocked,
  onOpen,
  onPostToCommunity,
  onRemoveFromCollection,
}) {
  const locked = !viewerHasUnlocked;

  return (
    <article className={locked ? 'discovered-cat-card locked-card' : 'discovered-cat-card'} onClick={onOpen}>
      <img className={locked ? 'dimmed-cat' : ''} src={cat.cropped_image_url} alt={cat.name || 'Cat'} />
      <div className="discovered-cat-body">
        <div className="card-title-row">
          <h3>{cat.name || 'Unknown Cat'}</h3>
          {!locked && <CatStatusBadge locked={false} />}
        </div>
        {!locked && (
          <>
            <p>{cat.color} · {cat.fun_info}</p>
            <span className="discovered-location">
              <MapPin size={13} />
              {cat.location_name}
            </span>
          </>
        )}
        {(onPostToCommunity || (isOwnProfile && onRemoveFromCollection)) && (
          <div className="discovered-card-actions">
            {onPostToCommunity && (
              <button
                className="text-button post-cat-button"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onPostToCommunity();
                }}
              >
                <Plus size={14} /> Post to Community
              </button>
            )}
            {isOwnProfile && onRemoveFromCollection && (
              <button
                className="text-button danger-text-button post-cat-button"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemoveFromCollection();
                }}
              >
                <X size={14} /> Remove from collection
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function CommunityScreen({
  posts,
  cats,
  users,
  currentUser,
  currentUserId,
  followingIds,
  followingProfiles,
  followerProfiles,
  onSearchFriends,
  onToggleFollow,
  onCreate,
  onToggleLike,
  onComment,
  onDeletePost,
  onOpenUser,
}) {
  const [currentArea, setCurrentArea] = useState('Finding your area...');
  const [friendQuery, setFriendQuery] = useState('');
  const [friendResults, setFriendResults] = useState([]);
  const [searchingFriends, setSearchingFriends] = useState(false);
  const [friendTab, setFriendTab] = useState('following');

  useEffect(() => {
    let cancelled = false;

    async function detectArea() {
      const position = await getCurrentAccurateLocation();
      if (cancelled) return;
      setCurrentArea(getApproximateLocation(position.latitude, position.longitude).areaName);
    }

    detectArea();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleFriendSearch(event) {
    event.preventDefault();
    setSearchingFriends(true);
    const results = await onSearchFriends(friendQuery);
    setFriendResults(results);
    setSearchingFriends(false);
  }

  const visibleUsers = useMemo(() => {
    const byId = new Map(users.map((user) => [user.id, user]));
    friendResults.forEach((user) => byId.set(user.id, user));
    return [...byId.values()];
  }, [users, friendResults]);

  const activeFriendList = friendTab === 'followers' ? followerProfiles : followingProfiles;

  const localPosts = posts.filter((post) => post.location_name === currentArea);
  const friendPosts = posts.filter((post) => followingIds.includes(post.user_id) || post.user_id === currentUserId);
  const timelinePosts = [...friendPosts, ...localPosts.filter((post) => !friendPosts.some((item) => item.id === post.id))];

  return (
    <section className="screen">
      <ScreenHeader title="Community" subtitle="Follow friends and see cats near your current place." icon={Users} />
      <section className="friend-finder">
        <div className="section-title-row">
          <h2>Find friends</h2>
          <span className="quiet-label">{followingProfiles.length} following · {followerProfiles.length} followers</span>
        </div>
        <form className="friend-search-row" onSubmit={handleFriendSearch}>
          <Search size={18} />
          <input
            value={friendQuery}
            placeholder="Search by username"
            onChange={(event) => setFriendQuery(event.target.value)}
          />
          <button type="submit">{searchingFriends ? '...' : 'Search'}</button>
        </form>
        <div className="social-tabs" aria-label="Friend lists">
          <button type="button" className={friendTab === 'following' ? 'active' : ''} onClick={() => setFriendTab('following')}>
            Following
          </button>
          <button type="button" className={friendTab === 'followers' ? 'active' : ''} onClick={() => setFriendTab('followers')}>
            Followers
          </button>
        </div>
        <div className="friend-result-list">
          {activeFriendList.map((user) => (
            <article className="friend-result" key={user.id}>
              <button className="friend-profile-link" type="button" onClick={() => onOpenUser(user.id)}>
                <UserAvatar user={user} className="post-user-avatar" />
                <span>
                  <strong>{user.name}</strong>
                  <UserHandle user={user} />
                  <small>{user.bio || 'Catmunity friend'}</small>
                </span>
              </button>
              <button type="button" onClick={() => onToggleFollow(user.id)}>
                {followingIds.includes(user.id) ? 'Following' : 'Follow'}
              </button>
            </article>
          ))}
          {activeFriendList.length === 0 && (
            <p className="empty-community-copy">
              {friendTab === 'following' ? 'You are not following anyone yet.' : 'No followers yet.'}
            </p>
          )}
        </div>
        <div className="friend-result-list">
          {friendResults.map((user) => {
            const following = followingIds.includes(user.id);
            return (
              <article className="friend-result" key={user.id}>
                <button className="friend-profile-link" type="button" onClick={() => onOpenUser(user.id)}>
                  <UserAvatar user={user} className="post-user-avatar" />
                  <span>
                    <strong>{user.name}</strong>
                    <UserHandle user={user} />
                    <small>{user.bio || 'Catmunity friend'}</small>
                  </span>
                </button>
                <button type="button" onClick={() => onToggleFollow(user.id)}>
                  {following ? 'Following' : 'Follow'}
                </button>
              </article>
            );
          })}
          {friendQuery && !searchingFriends && friendResults.length === 0 && (
            <p className="empty-community-copy">No public users found with that username yet.</p>
          )}
        </div>
      </section>
      <div className="section-title-row">
        <div>
          <h2>Timeline</h2>
          <span className="quiet-label">{currentArea}</span>
        </div>
        <button className="text-button" onClick={onCreate}><Plus size={16} /> Post</button>
      </div>
      {timelinePosts.map((post) => {
        const user = visibleUsers.find((item) => item.id === post.user_id) || currentUser;
        const cat = cats.find((item) => item.id === post.cat_id);
        const isFriendPost = followingIds.includes(post.user_id) || post.user_id === currentUserId;
        return (
          <CommunityPostCard
            key={post.id}
            post={post}
            user={user}
            cat={cat}
            isFriendPost={isFriendPost}
            onOpenUser={onOpenUser}
            onToggleLike={() => onToggleLike(post)}
            onComment={(body) => onComment(post.id, body)}
            onDelete={post.user_id === currentUserId ? () => onDeletePost(post.id) : null}
          />
        );
      })}
      {timelinePosts.length === 0 && (
        <p className="empty-community-copy">No community posts yet. Catch your first cat to get started!</p>
      )}
    </section>
  );
}

function CommunityPostCard({ post, user, cat, isFriendPost, onOpenUser, onToggleLike, onComment, onDelete }) {
  const [commentText, setCommentText] = useState('');

  function submitComment(event) {
    event.preventDefault();
    onComment(commentText);
    setCommentText('');
  }

  return (
    <article className="post-card">
      <button className="post-user" onClick={() => onOpenUser(user.id)}>
        <UserAvatar user={user} className="post-user-avatar" />
        <span>
          <strong>{user.name}</strong>
          <UserHandle user={user} />
          <small>{isFriendPost ? 'Friend post' : 'Nearby'} · {post.created_at} · {post.location_name}</small>
        </span>
      </button>
      {(post.image_url || cat?.cropped_image_url) && (
        <img className="post-image" src={post.image_url || cat?.cropped_image_url} alt="Community cat sighting" />
      )}
      <p>{renderMentionText(post.body)}</p>
      <div className="post-actions">
        <button className={post.likedByMe ? 'post-action-button active' : 'post-action-button'} type="button" onClick={onToggleLike}>
          <Heart size={16} /> {post.likedByMe ? 'Liked' : 'Like'}
        </button>
        <span>{post.likeCount} {post.likeCount === 1 ? 'like' : 'likes'}</span>
        <span><MessageCircle size={16} /> {post.comments.length}</span>
        {onDelete && (
          <button className="post-action-button danger" type="button" onClick={onDelete}>
            <X size={16} /> Delete
          </button>
        )}
      </div>
      <div className="comment-list">
        {post.comments.map((comment) => (
          <p className="comment" key={comment.id}>
            <strong>@{comment.user?.username || 'catmunity'}</strong> {renderMentionText(comment.body)}
            <small>{comment.created_at}</small>
          </p>
        ))}
      </div>
      <form className="comment-form" onSubmit={submitComment}>
        <input
          value={commentText}
          placeholder="Add a comment with @username"
          onChange={(event) => setCommentText(event.target.value)}
        />
        <button type="submit">Post</button>
      </form>
    </article>
  );
}

function CreatePostScreen({ cat, onBack, onCreate }) {
  const [body, setBody] = useState('');
  return (
    <section className="screen">
      <BackButton onBack={onBack} />
      <ScreenHeader title="Create post" subtitle="Share this discovered cat with the community." icon={Plus} />
      {cat ? (
        <div className="post-preview-card">
          <img src={cat.cropped_image_url} alt={cat.name || 'Discovered cat'} />
          <span>
            <strong>{cat.name || 'Unnamed Cat'}</strong>
            <small>{cat.location_name}</small>
          </span>
        </div>
      ) : (
        <p className="empty-community-copy">Choose an unlocked cat from your collection before posting.</p>
      )}
      <form
        className="details-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!cat) return;
          onCreate({ catId: cat.id, body: body || 'Spotted a very cute cat today.' });
        }}
      >
        <label>
          <span>Caption</span>
          <textarea value={body} placeholder="A calm cafe cat was sunbathing... @friend" onChange={(event) => setBody(event.target.value)} />
        </label>
        <button className="primary-button" type="submit" disabled={!cat}><Sparkles size={18} /> Share sighting</button>
      </form>
    </section>
  );
}

function SettingsScreen({ user, userId, signedIn, onProfileSave, onSignOut }) {
  const [form, setForm] = useState({
    username: user.username || '',
    name: user.name || '',
    avatarUrl: user.avatar_url || '',
    bio: user.bio || '',
    publicProfile: user.public_profile ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoStatus, setPhotoStatus] = useState('');
  const [cropPhoto, setCropPhoto] = useState(null);
  const [cropSettings, setCropSettings] = useState({ zoom: 1.15, x: 50, y: 50 });

  useEffect(() => {
    setForm({
      username: user.username || '',
      name: user.name || '',
      avatarUrl: user.avatar_url || '',
      bio: user.bio || '',
      publicProfile: user.public_profile ?? true,
    });
  }, [user]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    await onProfileSave(form);
    setSaving(false);
  }

  function handlePhotoSelect(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setPhotoStatus('Profile photo must be an image file.');
      return;
    }

    setCropPhoto({
      file,
      previewUrl: URL.createObjectURL(file),
    });
    setCropSettings({ zoom: 1.15, x: 50, y: 50 });
    setPhotoStatus('');
    event.target.value = '';
  }

  async function handleCropUpload() {
    if (!cropPhoto) return;

    setUploadingPhoto(true);
    setPhotoStatus('');
    const croppedFile = await createCroppedProfilePhoto(cropPhoto.previewUrl, cropPhoto.file.name, cropSettings);
    const localPreviewUrl = URL.createObjectURL(croppedFile);
    update('avatarUrl', localPreviewUrl);

    const { publicUrl, error } = await uploadProfilePhoto(croppedFile, userId);
    setUploadingPhoto(false);

    if (error) {
      setPhotoStatus(error.message || 'Profile photo upload failed.');
      return;
    }

    update('avatarUrl', publicUrl);
    setPhotoStatus('Profile photo uploaded. Save profile to keep it.');
    setCropPhoto(null);
  }

  return (
    <section className="screen">
      <ScreenHeader title="Profile settings" subtitle="Update how your Catmunity account appears." icon={Settings} />
      <form className="profile-settings-card" onSubmit={handleSubmit}>
        <div className="profile-settings-preview">
          <UserAvatar
            user={{ ...user, name: form.name || user.name, avatar_url: form.avatarUrl || user.avatar_url }}
            className="profile-settings-avatar"
          />
          <span>
            <strong>{form.name || 'Catmunity Friend'}</strong>
            <UserHandle user={{ ...user, username: form.username }} />
            <small>{form.publicProfile ? 'Public collection' : 'Private collection'}</small>
          </span>
        </div>
        <Field
          label="Username"
          value={form.username}
          placeholder="irdina"
          onChange={(value) => update('username', normalizeUsername(value))}
        />
        <Field label="Display name" value={form.name} placeholder="Irdina" onChange={(value) => update('name', value)} />
        <label className="profile-photo-upload">
          <span>Profile picture</span>
          <input type="file" accept="image/*" disabled={!signedIn || uploadingPhoto} onChange={handlePhotoSelect} />
          <em>{uploadingPhoto ? 'Uploading photo...' : 'Choose image'}</em>
        </label>
        {photoStatus && <p className="profile-photo-status">{photoStatus}</p>}
        <label className="field">
          <span>Bio</span>
          <textarea
            value={form.bio}
            placeholder="Weekend cat spotter and cafe-map maker."
            onChange={(event) => update('bio', event.target.value)}
          />
        </label>
        <label className="privacy-switch">
          <input
            type="checkbox"
            checked={form.publicProfile}
            onChange={(event) => update('publicProfile', event.target.checked)}
          />
          <span>
            <strong>Public account</strong>
            <small>Let others see your public profile and caught-cat collection.</small>
          </span>
        </label>
        {signedIn && (
          <button className="primary-button" type="submit" disabled={saving}>
            <Check size={18} /> {saving ? 'Saving...' : 'Save profile'}
          </button>
        )}
      </form>
      <div className="settings-list">
        <ToggleRow title="Approximate public locations" text="Public maps show general areas unless you choose otherwise." checked />
        <ToggleRow title="Hide my live location" text="Community posts never expose real-time location." checked />
        <ToggleRow title="Friendly reminders" text="Show safety prompts before catch sessions." checked />
        <ToggleRow title="Public collection" text={`${user.name}'s caught cats are ${user.public_profile ? 'visible' : 'hidden'} to others.`} checked={user.public_profile} />
      </div>
      {signedIn && (
        <button className="secondary-button" onClick={onSignOut}>
          <LogOut size={18} /> Sign out
        </button>
      )}
      <div className="safety-strip"><ShieldCheck size={17} /> This app is for memories and sightings. Give every cat space and kindness.</div>
      {cropPhoto && (
        <ProfilePhotoCropper
          imageUrl={cropPhoto.previewUrl}
          settings={cropSettings}
          uploading={uploadingPhoto}
          onChange={setCropSettings}
          onCancel={() => setCropPhoto(null)}
          onConfirm={handleCropUpload}
        />
      )}
    </section>
  );
}

function ProfilePhotoCropper({ imageUrl, settings, uploading, onChange, onCancel, onConfirm }) {
  function update(field, value) {
    onChange({ ...settings, [field]: Number(value) });
  }

  return (
    <div className="crop-overlay" role="dialog" aria-modal="true" aria-label="Crop profile picture">
      <div className="crop-panel">
        <div className="crop-preview">
          <img
            src={imageUrl}
            alt="Crop preview"
            style={{
              objectPosition: `${settings.x}% ${settings.y}%`,
              transform: `scale(${settings.zoom})`,
            }}
          />
        </div>
        <div className="crop-controls">
          <label>
            <span>Zoom</span>
            <input type="range" min="1" max="2.5" step="0.01" value={settings.zoom} onChange={(event) => update('zoom', event.target.value)} />
          </label>
          <label>
            <span>Move side to side</span>
            <input type="range" min="0" max="100" step="1" value={settings.x} onChange={(event) => update('x', event.target.value)} />
          </label>
          <label>
            <span>Move up and down</span>
            <input type="range" min="0" max="100" step="1" value={settings.y} onChange={(event) => update('y', event.target.value)} />
          </label>
        </div>
        <div className="crop-actions">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={uploading}>
            Cancel
          </button>
          <button className="primary-button" type="button" onClick={onConfirm} disabled={uploading}>
            {uploading ? 'Uploading...' : 'Use this crop'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DraggableBottomSheet({ header, children, focusSignal = 0 }) {
  const viewportHeight = typeof window === 'undefined' ? 760 : window.innerHeight;
  // Snap points are heights, not translate offsets: collapsed leaves the map mostly visible,
  // half keeps cards and map in balance, and expanded behaves like a full list panel.
  const snapPoints = useMemo(
    () => ({
      collapsed: 138,
      half: Math.round(viewportHeight * 0.48),
      expanded: Math.round(viewportHeight - 112),
    }),
    [viewportHeight],
  );
  const sheetHeight = useMotionValue(snapPoints.half);
  const dragStartRef = useRef({ y: 0, height: snapPoints.half });
  const scrollRef = useRef(null);
  const [state, setState] = useState('half');
  const [isDragging, setIsDragging] = useState(false);
  const [canDragSheet, setCanDragSheet] = useState(true);

  useEffect(() => {
    if (!focusSignal) return;
    if (sheetHeight.get() < snapPoints.half) {
      animateToSnap(snapPoints.half);
    }
  }, [focusSignal, snapPoints.half, sheetHeight]);

  function getStateForHeight(height) {
    if (height > (snapPoints.half + snapPoints.expanded) / 2) return 'expanded';
    if (height < (snapPoints.collapsed + snapPoints.half) / 2) return 'collapsed';
    return 'half';
  }

  function clampHeight(height) {
    return Math.min(snapPoints.expanded, Math.max(snapPoints.collapsed, height));
  }

  function nearestSnap(height) {
    return Object.values(snapPoints).reduce((nearest, point) =>
      Math.abs(point - height) < Math.abs(nearest - height) ? point : nearest,
    );
  }

  function animateToSnap(targetHeight) {
    if (targetHeight === snapPoints.collapsed) {
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      setCanDragSheet(true);
    }
    // Spring animation keeps the final snap smooth instead of a sudden jump.
    animate(sheetHeight, targetHeight, {
      type: 'spring',
      stiffness: 420,
      damping: 42,
      mass: 0.9,
      onUpdate: (value) => setState(getStateForHeight(value)),
      onComplete: () => setState(getStateForHeight(targetHeight)),
    });
  }

  function chooseSnap(height, velocityY) {
    // Velocity-based snapping: a fast upward drag expands, a fast downward drag collapses.
    // Slower gestures settle to the nearest snap point based on current height.
    if (velocityY < -520) {
      return height > snapPoints.half ? snapPoints.expanded : snapPoints.half;
    }
    if (velocityY > 520) {
      return height < snapPoints.half ? snapPoints.collapsed : snapPoints.half;
    }
    return nearestSnap(height);
  }

  function handleDragStart(_, info) {
    dragStartRef.current = { y: info.point.y, height: sheetHeight.get() };
    setIsDragging(true);
  }

  function handleDrag(event, info) {
    const fromPinnedControls = event.target.closest?.('.sheet-drag-zone, .sheet-header');
    if (!canDragSheet && !fromPinnedControls) return;
    // The sheet follows the finger continuously: dragging up increases height,
    // dragging down decreases height. No fixed-state jump during the gesture.
    const deltaY = dragStartRef.current.y - info.point.y;
    const nextHeight = clampHeight(dragStartRef.current.height + deltaY);
    sheetHeight.set(nextHeight);
    setState(getStateForHeight(nextHeight));
  }

  function handleDragEnd(_, info) {
    setIsDragging(false);
    animateToSnap(chooseSnap(sheetHeight.get(), info.velocity.y));
  }

  function handleScroll(event) {
    const target = event.currentTarget;
    // Scroll conflict handling: when content is scrolled down, list scroll owns the gesture.
    // Once the list is back at top, downward drags can move the whole sheet.
    setCanDragSheet(target.scrollTop <= 0);
  }

  function cycleSheet() {
    const target =
      state === 'collapsed'
        ? snapPoints.half
        : state === 'half'
          ? snapPoints.expanded
          : snapPoints.collapsed;
    animateToSnap(target);
  }

  return (
    <motion.section
      className={`draggable-sheet sheet-${state}`}
      style={{ height: sheetHeight }}
      aria-label="Nearby cats bottom sheet"
      onPanStart={handleDragStart}
      onPan={handleDrag}
      onPanEnd={handleDragEnd}
    >
      <div
        className={isDragging ? 'sheet-drag-zone dragging' : 'sheet-drag-zone'}
        onClick={cycleSheet}
      >
        <span className="sheet-handle" />
      </div>
      <div className="sheet-content">
        <div className="sheet-header">{header}</div>
        <div ref={scrollRef} className="sheet-scroll-content" onScroll={handleScroll}>{children}</div>
      </div>
    </motion.section>
  );
}

function FilterChip({ label, active, onClick }) {
  return (
    <button className={active ? 'filter-chip active' : 'filter-chip'} onClick={onClick}>
      {label}
    </button>
  );
}

function UserAvatar({ user, className = '' }) {
  if (user?.avatar_url) {
    return <img className={className} src={user.avatar_url} alt={user.name || 'User'} />;
  }

  return (
    <span className={`user-avatar-placeholder ${className}`} aria-label={user?.name || 'User'}>
      <User size={20} />
    </span>
  );
}

function CatchButton({ onClick }) {
  return (
    <button className="floating-catch-button" onClick={onClick} aria-label="Catch a new cat">
      <CatHeadShape className="cat-head-action" fill="action">
        <Plus size={18} className="catch-plus" />
        <Camera size={22} className="catch-camera" />
      </CatHeadShape>
    </button>
  );
}

function CatStatusBadge({ locked }) {
  return (
    <span className={locked ? 'status-badge locked' : 'status-badge unlocked'}>
      {locked ? <Lock size={12} /> : <UnlockKeyhole size={12} />}
      {locked ? 'Locked' : 'Unlocked'}
    </span>
  );
}

function CatPreviewCard({ cat, locked, onOpen }) {
  return (
    <article className="cat-preview-card" onClick={onOpen}>
      <img className={locked ? 'dimmed-cat' : ''} src={cat.cropped_image_url} alt={cat.name || 'Cat'} />
      <div>
        {!locked && <CatStatusBadge locked={false} />}
        <h2>{cat.name || 'Unknown Cat'}</h2>
        {!locked && <p>{cat.fun_info}</p>}
        {!locked && <small>{cat.color} · {cat.location_name}</small>}
      </div>
    </article>
  );
}

const defaultMapCenter = { lat: 3.1478, lng: 101.6953 };
const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

if (typeof window !== 'undefined') {
  window.gm_authFailure = () => {
    window.dispatchEvent(new Event('catmunity-google-map-auth-failure'));
  };
}

function useGoogleMapsAuthFailure() {
  const [authFailed, setAuthFailed] = useState(false);

  useEffect(() => {
    function handleAuthFailure() {
      setAuthFailed(true);
    }

    window.addEventListener('catmunity-google-map-auth-failure', handleAuthFailure);
    return () => window.removeEventListener('catmunity-google-map-auth-failure', handleAuthFailure);
  }, []);

  return authFailed;
}

function GoogleCatMap({ cats, currentUser, currentUserId, activeCatId, centerSignal, onSelect }) {
  if (!googleMapsApiKey) {
    return (
      <div className="mock-map immersive-map google-map-missing" role="img" aria-label="Google Maps API key missing">
        <div className="map-fallback-message">
          <MapIcon size={22} />
          <strong>Google Maps API key missing.</strong>
          <span>Add `VITE_GOOGLE_MAPS_API_KEY` to `.env.local`, then restart the dev server.</span>
        </div>
      </div>
    );
  }

  return (
    <RealGoogleMap
      cats={cats}
      currentUser={currentUser}
      currentUserId={currentUserId}
      activeCatId={activeCatId}
      centerSignal={centerSignal}
      onSelect={onSelect}
    />
  );
}

function RealGoogleMap({ cats, currentUser, currentUserId, activeCatId, centerSignal, onSelect }) {
  const [userPosition, setUserPosition] = useState(null);
  const [mapCenter, setMapCenter] = useState(defaultMapCenter);
  const [locationStatus, setLocationStatus] = useState('locating');
  const googleAuthFailed = useGoogleMapsAuthFailure();
  const mapRef = useRef(null);
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey,
    id: 'catmunity-google-map',
  });

  function requestCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationStatus('unsupported');
      setMapCenter(defaultMapCenter);
      return;
    }

    setLocationStatus('locating');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const nextPosition = { lat: coords.latitude, lng: coords.longitude };
        setUserPosition(nextPosition);
        setMapCenter(nextPosition);
        mapRef.current?.panTo(nextPosition);
        mapRef.current?.setZoom(16);
        setLocationStatus('ready');
      },
      () => {
        setMapCenter(defaultMapCenter);
        setLocationStatus('denied');
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  }

  useEffect(() => {
    requestCurrentLocation();
  }, []);

  useEffect(() => {
    const target = userPosition || mapCenter || defaultMapCenter;
    mapRef.current?.panTo(target);
    mapRef.current?.setZoom(userPosition ? 15 : 13);
  }, [centerSignal, userPosition, mapCenter]);

  if (loadError || googleAuthFailed) {
    return (
      <div className="mock-map immersive-map google-map-missing" role="img" aria-label="Google Maps loading error">
        <div className="map-fallback-message">
          <MapIcon size={22} />
          <strong>Google Map could not load.</strong>
          <span>Check the API key, Maps JavaScript API, billing, and allowed website referrers for this Vercel domain.</span>
        </div>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="mock-map immersive-map google-map-missing" role="img" aria-label="Google Map loading">
        <div className="map-fallback-message">
          <MapIcon size={22} />
          <strong>Loading Google Map...</strong>
        </div>
      </div>
    );
  }

  return (
    <div className="mock-map immersive-map google-map-layer" aria-label="Live cat discovery map">
      <GoogleMap
        mapContainerClassName="google-map-canvas"
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={mapCenter}
        zoom={userPosition ? 16 : 14}
        options={{
          clickableIcons: false,
          disableDefaultUI: true,
          fullscreenControl: false,
          gestureHandling: 'greedy',
          mapTypeControl: false,
          streetViewControl: false,
          zoomControl: false,
        }}
        onLoad={(map) => {
          mapRef.current = map;
          map.panTo(mapCenter);
          map.setZoom(userPosition ? 16 : 14);
        }}
      >
        {userPosition && (
          <OverlayView
            position={userPosition}
            mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
            getPixelPositionOffset={(width, height) => ({ x: -width / 2, y: -height / 2 })}
          >
            <div className={currentUser?.avatar_url ? 'google-user-marker has-photo' : 'google-user-marker'} aria-label="Your current location">
              <UserAvatar user={currentUser} className="google-user-avatar" />
            </div>
          </OverlayView>
        )}
        {cats.map((cat, index) => {
          const locked = !cat.caught_by_users.includes(currentUserId);
          const position = getCatMapPosition(cat);
          return (
            <OverlayView
              key={cat.id}
              position={position}
              mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
              getPixelPositionOffset={(width, height) => ({ x: -width / 2, y: -height / 2 })}
            >
              <button
                className={`${locked ? 'map-pin google-map-pin locked' : 'map-pin google-map-pin'} ${cat.id === activeCatId ? 'active' : ''}`}
                onClick={() => onSelect(cat)}
                aria-label={`${cat.name}, ${locked ? 'locked' : 'caught'}`}
              >
                <CatHeadMarker image={cat.cropped_image_url} locked={locked} count={cat.sighting_count || cat.caught_by_users.length || index + 1} />
              </button>
            </OverlayView>
          );
        })}
      </GoogleMap>
      <div className="map-location-status">
        <span>
          {locationStatus === 'ready' && 'Using your current location'}
          {locationStatus === 'locating' && 'Finding your current location...'}
          {locationStatus === 'denied' && 'Location blocked, showing Kuala Lumpur'}
          {locationStatus === 'unsupported' && 'Location unavailable, showing Kuala Lumpur'}
        </span>
        <button type="button" onClick={requestCurrentLocation}>Locate me</button>
      </div>
    </div>
  );
}

function MockMap({ cats, currentUserId, activeCatId, onSelect }) {
  return (
    <div className="mock-map immersive-map" role="img" aria-label="Live cat discovery map">
      <div className="sky-layer">
        <span className="cloud cloud-one" />
        <span className="cloud cloud-two" />
      </div>
      <div className="street-grid">
        <span className="road road-one" />
        <span className="road road-two" />
        <span className="road road-three" />
      </div>
      <div className="map-label">Live cat radar</div>
      {cats.map((cat, index) => {
        const locked = !cat.caught_by_users.includes(currentUserId);
        return (
          <button
            key={cat.id}
            className={`${locked ? 'map-pin locked' : 'map-pin'} ${cat.id === activeCatId ? 'active' : ''}`}
            style={{ left: `${cat.map?.x ?? 50}%`, top: `${cat.map?.y ?? 50}%` }}
            onClick={() => onSelect(cat)}
            aria-label={`${cat.name}, ${locked ? 'locked' : 'caught'}`}
          >
            <CatHeadMarker image={cat.cropped_image_url} locked={locked} count={index + 1} />
          </button>
        );
      })}
    </div>
  );
}

function CatHeadMarker({ image, locked = false, count }) {
  return (
    <>
      <CatHeadShape className="cat-head-photo" image={image} />
      <small>{locked ? <Lock size={11} /> : count}</small>
    </>
  );
}

const catHeadPath =
  'M50 15 C43 15 38 17 34 21 L19 8 C16 6 13 8 14 13 L18 34 C12 42 10 53 12 64 C15 83 31 94 50 94 C69 94 85 83 88 64 C90 53 88 42 82 34 L86 13 C87 8 84 6 81 8 L66 21 C62 17 57 15 50 15 Z';

function CatHeadShape({ image, fill = 'rgba(232, 95, 75, 0.95)', className = '', children }) {
  const patternId = `cat-head-pattern-${useId().replaceAll(':', '')}`;
  const gradientId = `cat-head-gradient-${useId().replaceAll(':', '')}`;
  const shapeFill = fill === 'action' ? `url(#${gradientId})` : fill;

  return (
    <span className={`cat-head-shape ${className}`}>
      <svg className="cat-head-svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <defs>
          {image && (
            <pattern id={patternId} patternUnits="userSpaceOnUse" width="100" height="100">
              <image
                href={image}
                width="100"
                height="100"
                preserveAspectRatio="xMidYMid slice"
              />
            </pattern>
          )}
          <linearGradient id={gradientId} x1="15" y1="14" x2="88" y2="90" gradientUnits="userSpaceOnUse">
            <stop stopColor="#e85f4b" />
            <stop offset="1" stopColor="#f08a59" />
          </linearGradient>
        </defs>
        <path d={catHeadPath} fill={image ? `url(#${patternId})` : shapeFill} />
        <path className="cat-head-outline" d={catHeadPath} />
      </svg>
      {children && <span className="cat-head-content">{children}</span>}
    </span>
  );
}

function MiniMap({ cats, onSelect = () => {}, approximate = false }) {
  const firstCatPosition = cats[0] ? getCatMapPosition(cats[0]) : defaultMapCenter;
  const googleAuthFailed = useGoogleMapsAuthFailure();
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey,
    id: 'catmunity-google-map',
  });

  if (!googleMapsApiKey || loadError || googleAuthFailed) {
    return (
      <div className="mini-map google-map-missing">
        <div className="mini-map-label">
          <strong>{!googleMapsApiKey ? 'Google Maps API key missing.' : 'Google Map could not load.'}</strong>
          <small>{!googleMapsApiKey ? 'Add the key to show discovery pins.' : 'Check key, billing, and Vercel referrer.'}</small>
        </div>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="mini-map google-map-missing">
        <div className="mini-map-label">
          <strong>Loading Google Map...</strong>
        </div>
      </div>
    );
  }

  return (
    <div className="mini-map google-mini-map">
      <GoogleMap
        mapContainerClassName="google-map-canvas"
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={firstCatPosition}
        zoom={cats.length > 1 ? 12 : 15}
        options={{
          clickableIcons: false,
          disableDefaultUI: true,
          fullscreenControl: false,
          gestureHandling: 'cooperative',
          mapTypeControl: false,
          streetViewControl: false,
          zoomControl: false,
        }}
      >
        {cats.map((cat) => {
          const position = getCatMapPosition(cat);
          return (
            <OverlayView
              key={cat.id}
              position={position}
              mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
              getPixelPositionOffset={(width, height) => ({ x: -width / 2, y: -height / 2 })}
            >
              <button
                className="mini-pin"
                onClick={() => onSelect(cat)}
                aria-label={cat.name}
              >
                <CatHeadShape className="mini-cat-head" image={cat.cropped_image_url} />
              </button>
            </OverlayView>
          );
        })}
      </GoogleMap>
      <div className="mini-map-label">
        <strong>{approximate ? 'Public area map' : 'My caught map'}</strong>
        <small>{approximate ? 'Original cat pins' : 'Tap a pin to view a cat'}</small>
      </div>
    </div>
  );
}

function CatCard({ cat, locked, onOpen, action }) {
  return (
    <article className={locked ? 'cat-card locked-card' : 'cat-card'} onClick={onOpen}>
      <img className={locked ? 'dimmed-cat' : ''} src={cat.cropped_image_url} alt={cat.name || 'Cat'} />
      <div>
        <div className="card-title-row">
          <h3>{locked ? cat.name || 'Unknown Cat' : cat.name || 'Unnamed Cat'}</h3>
          <CatStatusBadge locked={locked} />
        </div>
        {!locked && <p>{cat.color} · {cat.fun_info}</p>}
        {!locked && (
          <span>
            <MapPin size={13} />
            {cat.location_name}
            {cat.distance ? ` · ${cat.distance}` : ''}
          </span>
        )}
      </div>
      {action && <button aria-label={locked ? 'Unlock cat' : 'Open cat'} onClick={(event) => { event.stopPropagation(); action(); }}>
        {locked ? <Lock size={16} /> : <Cat size={16} />}
      </button>}
    </article>
  );
}

function ScreenHeader({ title, subtitle, icon: Icon }) {
  return (
    <div className="screen-header">
      <span className="header-icon"><Icon size={21} /></span>
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function BackButton({ onBack }) {
  return <button className="back-button" onClick={onBack}><ChevronLeft size={18} /> Back</button>;
}

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <label>
      <span>{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Stat({ label, value, icon: Icon }) {
  return (
    <div className="stat">
      {Icon && <Icon size={17} />}
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function InfoRow({ label, value }) {
  return <div className="info-row"><span>{label}</span><strong>{value}</strong></div>;
}

function ToggleRow({ title, text, checked }) {
  return (
    <div className="toggle-row">
      <div><strong>{title}</strong><span>{text}</span></div>
      <input type="checkbox" checked={checked} readOnly aria-label={title} />
    </div>
  );
}

async function createCroppedProfilePhoto(imageUrl, filename, settings) {
  const image = await loadImageElement(imageUrl);
  const outputSize = 900;
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const context = canvas.getContext('2d');
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  const baseScale = Math.max(outputSize / imageWidth, outputSize / imageHeight);
  const scale = baseScale * settings.zoom;
  const drawnWidth = imageWidth * scale;
  const drawnHeight = imageHeight * scale;
  const maxOffsetX = Math.min(0, outputSize - drawnWidth);
  const maxOffsetY = Math.min(0, outputSize - drawnHeight);
  const offsetX = maxOffsetX * (settings.x / 100);
  const offsetY = maxOffsetY * (settings.y / 100);

  context.fillStyle = '#fff0c8';
  context.fillRect(0, 0, outputSize, outputSize);
  context.drawImage(image, offsetX, offsetY, drawnWidth, drawnHeight);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) {
    throw new Error('Could not crop profile photo.');
  }
  return new File([blob], getCroppedFilename(filename), { type: 'image/jpeg' });
}

function loadImageElement(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
}

function getCroppedFilename(filename) {
  const baseName = filename.replace(/\.[^.]+$/u, '') || 'profile-photo';
  return `${baseName}-cropped.jpg`;
}

createRoot(document.getElementById('root')).render(<App />);
