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
  ImagePlus,
  Lock,
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
import { mockCats, mockComments, mockPosts, mockUsers } from './data/mockData';
import {
  approximateLocation,
  autoDetectCatCrop,
  getCurrentPosition,
  saveCatCatch,
} from './services/catServices';
import './styles/app.css';

const tabs = [
  { id: 'explore', label: 'Map', icon: MapIcon },
  { id: 'collection', label: 'Collection', icon: Cat },
  { id: 'catch', label: 'Catch', icon: Camera },
  { id: 'community', label: 'Community', icon: Users },
  { id: 'settings', label: 'Profile', icon: User },
];

const currentUserId = 'user-mira';

function App() {
  const [screen, setScreen] = useState('explore');
  const [cats, setCats] = useState(mockCats);
  const [posts, setPosts] = useState(mockPosts);
  const [capture, setCapture] = useState(null);
  const [draftCat, setDraftCat] = useState(null);
  const [selectedCatId, setSelectedCatId] = useState('cat-saffron');
  const [selectedUserId, setSelectedUserId] = useState('user-jules');
  const [toast, setToast] = useState('');

  const me = mockUsers.find((user) => user.id === currentUserId);
  const caughtCats = cats.filter((cat) => cat.caught_by_users.includes(currentUserId));
  const selectedCat = cats.find((cat) => cat.id === selectedCatId) || cats[0];
  const selectedUser = mockUsers.find((user) => user.id === selectedUserId) || me;
  const publicCats = cats.filter((cat) => cat.caught_by_users.includes(selectedUser.id));

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

  async function handlePhotoSelected(file) {
    const previewUrl = file ? URL.createObjectURL(file) : createSampleCatImage();
    const crop = await autoDetectCatCrop(previewUrl);
    const position = await getCurrentPosition();
    setCapture({
      originalImage: previewUrl,
      croppedImage: crop.croppedImageUrl,
      cropMode: crop.mode,
      latitude: position.latitude,
      longitude: position.longitude,
      locationName: approximateLocation(position.latitude, position.longitude),
    });
    navigate('confirm');
  }

  function handleConfirmCatch() {
    const base = {
      id: `cat-${Date.now()}`,
      name: 'Unnamed Cat',
      image_url: capture.originalImage,
      cropped_image_url: capture.croppedImage,
      color: '',
      fun_info: '',
      remarks: '',
      tags: ['new find'],
      discovered_by: currentUserId,
      caught_by_users: [currentUserId],
      latitude: capture.latitude,
      longitude: capture.longitude,
      location_name: capture.locationName,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      map: { x: 52, y: 48 },
    };
    setDraftCat(base);
    navigate('detailsForm');
  }

  function handleSaveDetails(form) {
    const saved = saveCatCatch({ ...draftCat, ...form, updated_at: new Date().toISOString() });
    setCats((items) => [saved, ...items]);
    setSelectedCatId(saved.id);
    showToast('Cat caught and saved.');
    navigate('collection');
  }

  function unlockExistingCat(catId) {
    setCats((items) =>
      items.map((cat) =>
        cat.id === catId && !cat.caught_by_users.includes(currentUserId)
          ? { ...cat, caught_by_users: [...cat.caught_by_users, currentUserId] }
          : cat,
      ),
    );
    setSelectedCatId(catId);
    showToast('Details unlocked for your collection.');
    navigate('detail');
  }

  function handleCreatePost(post) {
    setPosts((items) => [
      {
        id: `post-${Date.now()}`,
        user_id: currentUserId,
        image_url: post.imageUrl || caughtCats[0]?.cropped_image_url,
        body: post.body,
        location_name: post.locationName || 'Neighborhood stroll',
        created_at: 'Just now',
        reactions: { heart: 0, sparkle: 0 },
        comment_ids: [],
      },
      ...items,
    ]);
    showToast('Sighting posted.');
    navigate('community');
  }

  const commonProps = {
    cats,
    caughtCats,
    currentUserId,
    navigate,
    selectedCat,
    setSelectedCatId,
    unlockExistingCat,
  };

  return (
    <div className="app-shell">
      {toast && <div className="toast"><Sparkles size={16} />{toast}</div>}
      {screen !== 'welcome' && screen !== 'explore' && <TopBar user={me} stats={stats} />}

      <motion.main
        key={screen}
        className={screen === 'welcome' ? 'main main--welcome' : screen === 'explore' ? 'main main--map' : 'main'}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      >
        {screen === 'welcome' && <WelcomeScreen onStart={() => navigate('explore')} />}
        {screen === 'explore' && <ExploreScreen {...commonProps} />}
        {screen === 'catch' && <CatchScreen onPhotoSelected={handlePhotoSelected} />}
        {screen === 'confirm' && (
          <ConfirmScreen capture={capture} onBack={() => navigate('catch')} onConfirm={handleConfirmCatch} />
        )}
        {screen === 'detailsForm' && (
          <CatDetailsForm cat={draftCat} onSave={handleSaveDetails} onBack={() => navigate('confirm')} />
        )}
        {screen === 'collection' && <CollectionScreen {...commonProps} stats={stats} user={me} />}
        {screen === 'detail' && <CatDetailScreen {...commonProps} />}
        {screen === 'publicProfile' && (
          <PublicProfileScreen
            user={selectedUser}
            cats={publicCats}
            currentUserId={currentUserId}
            onBack={() => navigate('collection')}
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
            users={mockUsers}
            comments={mockComments}
            onCreate={() => navigate('createPost')}
            onOpenUser={(id) => {
              setSelectedUserId(id);
              navigate('publicProfile');
            }}
          />
        )}
        {screen === 'createPost' && (
          <CreatePostScreen onBack={() => navigate('community')} onCreate={handleCreatePost} />
        )}
        {screen === 'settings' && <SettingsScreen user={me} />}
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
    </div>
  );
}

function TopBar({ user, stats }) {
  return (
    <header className="top-bar">
      <div>
        <p className="eyebrow">Catmunity</p>
        <h1>Hi, {user.name}</h1>
      </div>
      <div className="top-actions">
        <span className="pill"><Cat size={15} />{stats.caught}</span>
        <button className="icon-button" aria-label="Notifications"><Bell size={20} /></button>
      </div>
    </header>
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

function ExploreScreen({ cats, currentUserId, navigate, setSelectedCatId, unlockExistingCat }) {
  const [activeCatId, setActiveCatId] = useState(cats[0]?.id);
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [hideCaught, setHideCaught] = useState(false);
  const [sortMode, setSortMode] = useState('Recent');
  const [sheetFocusSignal, setSheetFocusSignal] = useState(0);
  const activeCat = cats.find((cat) => cat.id === activeCatId) || cats[0];
  const activeLocked = activeCat && !activeCat.caught_by_users.includes(currentUserId);
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
          currentUserId={currentUserId}
          activeCatId={activeCatId}
          onSelect={selectCatOnMap}
        />
        <button className="capture-orb" onClick={() => navigate('catch')} aria-label="Catch a cat">
          <CatHeadShape className="cat-head-action" fill="action">
            <Camera size={32} />
          </CatHeadShape>
        </button>
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
              <strong>{nearbyCats.length || 18} cats nearby</strong>
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
        {activeCat && (
          <CatPreviewCard
            cat={activeCat}
            locked={activeLocked}
            currentUserId={currentUserId}
            onOpen={() => (activeLocked ? unlockExistingCat(activeCat.id) : openCat(activeCat))}
          />
        )}
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
              }}
              action={!cat.caught_by_users.includes(currentUserId) ? () => unlockExistingCat(cat.id) : () => openCat(cat)}
            />
          ))}
        </div>
      </DraggableBottomSheet>
      <CatchButton onClick={() => navigate('catch')} />
    </section>
  );
}

function CatchScreen({ onPhotoSelected }) {
  return (
    <section className="screen catch-screen">
      <ScreenHeader title="Catch a cat" subtitle="Use a photo, then confirm the cropped cat memory." icon={Camera} />
      <label className="upload-panel">
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => onPhotoSelected(event.target.files?.[0])}
        />
        <Camera size={38} />
        <strong>Take or upload a cat photo</strong>
        <span>Automatic crop will run first. Manual crop is available when detection needs help.</span>
      </label>
      <button className="secondary-button" onClick={() => onPhotoSelected(null)}>
        <ImagePlus size={18} /> Use sample cat photo
      </button>
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
        <span className="pill">{capture.cropMode === 'auto' ? 'Auto crop' : 'Manual crop ready'}</span>
      </div>
      <div className="confirm-actions">
        <button className="secondary-button" onClick={onBack}><X size={18} /> Retake</button>
        <button className="primary-button" onClick={onConfirm}><Check size={18} /> Cat caught!</button>
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

function CollectionScreen({ caughtCats, stats, user, navigate, setSelectedCatId }) {
  return (
    <section className="screen collection-screen">
      <div className="profile-hero">
        <img src={user.avatar_url} alt={user.name} />
        <div>
          <p className="eyebrow">Public profile</p>
          <h1>{user.name}</h1>
          <p>{user.bio}</p>
        </div>
        <span className="profile-status"><ShieldCheck size={14} /> Public</span>
      </div>
      <div className="metric-tabs" aria-label="Collection stats">
        <Stat label="Caught" value={stats.caught} icon={Cat} />
        <Stat label="Areas" value={stats.areas} icon={MapPin} />
      </div>
      <div className="section-title-row">
        <h2>Discovery map</h2>
        <span className="quiet-label">Approximate pins</span>
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
          <CatCard
            key={cat.id}
            cat={cat}
            locked={false}
            onOpen={() => {
              setSelectedCatId(cat.id);
              navigate('detail');
            }}
          />
        ))}
      </div>
    </section>
  );
}

function CatDetailScreen({ selectedCat, currentUserId, unlockExistingCat }) {
  const locked = !selectedCat.caught_by_users.includes(currentUserId);
  return (
    <section className="screen">
      <ScreenHeader title={selectedCat.name || 'Unnamed Cat'} subtitle={locked ? 'Catch this cat to unlock full details.' : selectedCat.location_name} icon={locked ? Lock : Cat} />
      <div className="detail-hero">
        <img src={selectedCat.cropped_image_url} alt={selectedCat.name || 'Cat'} />
        {locked && <div className="lock-overlay"><Lock size={30} /> Limited preview</div>}
      </div>
      <div className="detail-panel">
        <InfoRow label="Color" value={locked ? 'Locked' : selectedCat.color} />
        <InfoRow label="Fun info" value={locked ? 'Catch to reveal' : selectedCat.fun_info} />
        <InfoRow label="Remarks" value={locked ? 'Catch to reveal' : selectedCat.remarks} />
        <InfoRow label="Area" value={locked ? selectedCat.location_name.split(',')[0] : selectedCat.location_name} />
        <div className="tag-row">
          {(locked ? ['locked', 'nearby'] : selectedCat.tags).map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      </div>
      {locked && <button className="primary-button" onClick={() => unlockExistingCat(selectedCat.id)}><Camera size={18} /> I found this cat</button>}
    </section>
  );
}

function PublicProfileScreen({ user, cats, currentUserId, onBack, onSelectCat }) {
  return (
    <section className="screen">
      <BackButton onBack={onBack} />
      <div className="profile-header">
        <img src={user.avatar_url} alt={user.name} />
        <div>
          <p className="eyebrow">Public profile</p>
          <h1>{user.name}</h1>
          <p>{user.bio}</p>
        </div>
      </div>
      <MiniMap cats={cats} approximate />
      <div className="gallery-grid">
        {cats.map((cat) => (
          <CatCard
            key={cat.id}
            cat={cat}
            locked={!cat.caught_by_users.includes(currentUserId)}
            onOpen={() => onSelectCat(cat.id)}
          />
        ))}
      </div>
    </section>
  );
}

function CommunityScreen({ posts, cats, users, comments, onCreate, onOpenUser }) {
  return (
    <section className="screen">
      <ScreenHeader title="Community" subtitle="Sightings, reactions, and public collections." icon={Users} />
      <div className="section-title-row">
        <h2>Recent sightings</h2>
        <button className="text-button" onClick={onCreate}><Plus size={16} /> Post</button>
      </div>
      {posts.map((post) => {
        const user = users.find((item) => item.id === post.user_id);
        const cat = cats.find((item) => item.id === post.cat_id);
        return (
          <article className="post-card" key={post.id}>
            <button className="post-user" onClick={() => onOpenUser(user.id)}>
              <img src={user.avatar_url} alt={user.name} />
              <span><strong>{user.name}</strong><small>{post.created_at} · {post.location_name}</small></span>
            </button>
            <img className="post-image" src={post.image_url || cat?.cropped_image_url} alt="Community cat sighting" />
            <p>{post.body}</p>
            <div className="post-actions">
              <span><Heart size={16} /> {post.reactions.heart}</span>
              <span><Sparkles size={16} /> {post.reactions.sparkle}</span>
              <span><MessageCircle size={16} /> {post.comment_ids.length}</span>
            </div>
            {post.comment_ids.slice(0, 1).map((id) => {
              const comment = comments.find((item) => item.id === id);
              return <p className="comment" key={id}>{comment.body}</p>;
            })}
          </article>
        );
      })}
    </section>
  );
}

function CreatePostScreen({ onBack, onCreate }) {
  const [body, setBody] = useState('');
  const [locationName, setLocationName] = useState('');
  return (
    <section className="screen">
      <BackButton onBack={onBack} />
      <ScreenHeader title="Create post" subtitle="Share a gentle sighting with the community." icon={Plus} />
      <form
        className="details-form"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate({ body: body || 'Spotted a very cute cat today.', locationName });
        }}
      >
        <label>
          <span>Post text</span>
          <textarea value={body} placeholder="A calm cafe cat was sunbathing..." onChange={(event) => setBody(event.target.value)} />
        </label>
        <label>
          <span>General area</span>
          <input value={locationName} placeholder="Old Town cafes" onChange={(event) => setLocationName(event.target.value)} />
        </label>
        <button className="primary-button" type="submit"><Sparkles size={18} /> Share sighting</button>
      </form>
    </section>
  );
}

function SettingsScreen({ user }) {
  return (
    <section className="screen">
      <ScreenHeader title="Settings" subtitle="Privacy and safety defaults for cat discovering." icon={Settings} />
      <div className="settings-list">
        <ToggleRow title="Approximate public locations" text="Public maps show general areas unless you choose otherwise." checked />
        <ToggleRow title="Hide my live location" text="Community posts never expose real-time location." checked />
        <ToggleRow title="Friendly reminders" text="Show safety prompts before catch sessions." checked />
        <ToggleRow title="Public collection" text={`${user.name}'s caught cats are visible to followers.`} checked />
      </div>
      <div className="safety-strip"><ShieldCheck size={17} /> This app is for memories and sightings. Give every cat space and kindness.</div>
    </section>
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

function CatchButton({ onClick }) {
  return (
    <button className="floating-catch-button" onClick={onClick} aria-label="Catch a new cat">
      <CatHeadShape className="cat-head-action" fill="action">
        <Plus size={18} className="catch-plus" />
        <Camera size={23} />
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
        <CatStatusBadge locked={locked} />
        <h2>{cat.name || 'Unknown Cat'}</h2>
        <p>{locked ? 'Catch this cat to unlock full info' : cat.fun_info}</p>
        <small>{locked ? `${cat.location_name.split(',')[0]} area` : `${cat.color} · ${cat.location_name}`}</small>
      </div>
    </article>
  );
}

const defaultMapCenter = { lat: 3.1478, lng: 101.6953 };
const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const nearbyCatOffsets = [
  { lat: 0.0011, lng: -0.0012 },
  { lat: -0.001, lng: 0.0014 },
  { lat: 0.0017, lng: 0.001 },
  { lat: -0.0015, lng: -0.0008 },
];

function GoogleCatMap({ cats, currentUserId, activeCatId, centerSignal, onSelect }) {
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
      currentUserId={currentUserId}
      activeCatId={activeCatId}
      centerSignal={centerSignal}
      onSelect={onSelect}
    />
  );
}

function RealGoogleMap({ cats, currentUserId, activeCatId, centerSignal, onSelect }) {
  const [userPosition, setUserPosition] = useState(null);
  const [mapCenter, setMapCenter] = useState(defaultMapCenter);
  const [locationStatus, setLocationStatus] = useState('locating');
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

  const positionedCats = useMemo(() => {
    if (!userPosition) return cats;

    return cats.map((cat, index) => {
      const offset = nearbyCatOffsets[index % nearbyCatOffsets.length];
      return {
        ...cat,
        latitude: userPosition.lat + offset.lat,
        longitude: userPosition.lng + offset.lng,
      };
    });
  }, [cats, userPosition]);

  if (loadError) {
    return (
      <div className="mock-map immersive-map google-map-missing" role="img" aria-label="Google Maps loading error">
        <div className="map-fallback-message">
          <MapIcon size={22} />
          <strong>Google Map could not load.</strong>
          <span>Check the API key, Maps JavaScript API, billing, and referrer restrictions.</span>
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
            <div className="google-user-marker" aria-label="Your current location">
              <User size={20} />
            </div>
          </OverlayView>
        )}
        {positionedCats.map((cat, index) => {
          const locked = !cat.caught_by_users.includes(currentUserId);
          return (
            <OverlayView
              key={cat.id}
              position={{ lat: cat.latitude, lng: cat.longitude }}
              mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
              getPixelPositionOffset={(width, height) => ({ x: -width / 2, y: -height / 2 })}
            >
              <button
                className={`${locked ? 'map-pin google-map-pin locked' : 'map-pin google-map-pin'} ${cat.id === activeCatId ? 'active' : ''}`}
                onClick={() => onSelect(cat)}
                aria-label={`${cat.name}, ${locked ? 'locked' : 'caught'}`}
              >
                <CatHeadMarker image={cat.cropped_image_url} locked={locked} count={index + 1} />
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
  return (
    <div className="mini-map">
      <div>
        <strong>{approximate ? 'Public area map' : 'My caught map'}</strong>
        <small>{approximate ? 'Pins are fuzzed for privacy' : 'Tap a pin to view a cat'}</small>
      </div>
      {cats.map((cat) => (
        <button
          key={cat.id}
          className="mini-pin"
          style={{ left: `${cat.map?.x ?? 50}%`, top: `${cat.map?.y ?? 50}%` }}
          onClick={() => onSelect(cat)}
          aria-label={cat.name}
        >
          <CatHeadShape className="mini-cat-head" image={cat.cropped_image_url} />
        </button>
      ))}
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
        <p>{locked ? 'Catch this cat to unlock full info' : `${cat.color} · ${cat.fun_info}`}</p>
        <span>
          <MapPin size={13} />
          {locked ? `${cat.location_name.split(',')[0]} area` : cat.location_name}
          {cat.distance ? ` · ${cat.distance}` : ''}
        </span>
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

function createSampleCatImage() {
  return 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&w=900&q=80';
}

createRoot(document.getElementById('root')).render(<App />);
