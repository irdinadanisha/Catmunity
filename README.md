# Catmunity

Catch your neighbourhood cats! Catmunity is a mobile-first React concept app for discovering and collecting real-world cats. It uses mock data and local React state so the product flow can be tested before adding a backend, database, object storage, map SDK, authentication, geolocation, or cat-detection model.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:5173/`.

## Environment Variables

```bash
VITE_GOOGLE_MAPS_API_KEY=
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=
```

Use the Supabase project URL only for `VITE_SUPABASE_URL`. Do not paste URLs that end in `/auth/v1`, `/rest/v1`, `/storage/v1`, or any SQL/API page URL.

`VITE_SUPABASE_ANON_KEY` can be Supabase's newer publishable key. When Supabase variables are present, Catmunity shows an email/password sign-up and login screen before users can save cats. If Supabase variables are missing, the app stays in mock mode for UI work.

In Supabase, enable **Authentication > Providers > Email**. For quick MVP testing, you can temporarily turn off email confirmation in **Authentication > Sign In / Providers > Email**, or keep it on and confirm the account from the email before logging in.

If confirmation emails do not arrive, check spam/promotions, try the app's **Resend confirmation email** action, and inspect **Authentication > Logs** in Supabase. Supabase's default email sender is meant for testing and can be delayed or rate-limited; for more reliable production delivery, configure a custom SMTP provider in Supabase Auth settings.

In **Authentication > URL Configuration**, set **Site URL** to your deployed Vercel URL, for example:

```bash
https://catmunity.vercel.app
```

Also add these redirect URLs:

```bash
https://catmunity.vercel.app/**
http://localhost:5173/**
```

Replace `catmunity.vercel.app` with your real Vercel domain. Do not leave the production Site URL as `http://localhost:3000`.

## Included MVP Flow

- Full-screen explore map with caught and locked nearby cats
- Email/password sign-up and login with Supabase Auth
- Draggable bottom sheet with search, filter chips, preview cards, and nearby list
- Catch flow with photo upload/sample image, crop confirmation, and success copy
- New-cat vs existing-cat registration choice to avoid duplicate nearby pins
- Add/edit cat details form with name, color, fun info, remarks, tags, date, and location
- Personal collection gallery and caught-location map
- Cat detail screen with locked/unlocked detail behavior
- Public user profile with privacy-aware map pins
- Community feed, post creation, comments, and reactions
- Settings/profile screen with privacy and safety defaults

## Data Models

Mock structures for `User`, `Cat`, `user_cats` style ownership via `caught_by_users`, privacy-aware cat locations, `CommunityPost`, `Comment`, and reactions live in `src/data/mockData.js`.

Service helpers live in `src/services/catServices.js` for:

- Cat detection/cropping
- Accurate current location capture for brand-new cats
- Accurate original coordinates for stable map pins
- Approximate coordinates for later sightings and area labels
- Creating one canonical cat record
- Linking existing cats to a user collection without creating duplicate pins
- 200m duplicate cutoff from the original cat pin
- TODO automatic duplicate detection with image similarity and nearby approximate-cell matching

Signed-in users are stored in Supabase Auth. Cat ownership is saved in `user_cats`, new cats are saved in `cats`, and extra sightings are saved in `cat_sightings`, all linked to the authenticated user id.

The Supabase schema lives in `supabase/schema.sql` and uses normalized `cats`, `user_cats`, and `cat_sightings` tables plus a public-safe `cat_public_map` view. The app reads live cats from Supabase when the environment variables are present, and falls back to mock data if Supabase is unavailable.

## Safety And Privacy Defaults

Public map labels use approximate location copy, settings emphasize hiding live location, and the catch flow includes reminders not to chase, harm, disturb, or trespass while photographing cats.
