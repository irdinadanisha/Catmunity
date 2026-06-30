# Cat Quest MVP

A mobile-first React concept app for discovering and collecting real-world cats. It uses mock data and local React state so the product flow can be tested before adding a backend, database, object storage, map SDK, authentication, geolocation, or cat-detection model.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:5173/`.

## Included MVP Flow

- Welcome/login-style entry screen
- Explore map with caught and locked nearby cats
- Catch flow with photo upload/sample image, crop confirmation, and success copy
- Add/edit cat details form with name, color, fun info, remarks, tags, and location
- Personal collection gallery and caught-location map
- Cat detail screen with locked/unlocked detail behavior
- Public user profile with privacy-aware map pins
- Community feed, post creation, comments, and reactions
- Settings screen with privacy and safety defaults

## Data Models

Mock structures for `User`, `Cat`, `CatCatch` style ownership via `caught_by_users`, `CatLocation`, `CommunityPost`, `Comment`, and reactions live in `src/data/mockData.js`.

Placeholder service functions live in `src/services/catServices.js` and are marked with TODO comments for:

- Cat detection/cropping
- Manual crop fallback routing
- GPS/geolocation permissions
- Privacy-preserving reverse geocoding
- Backend persistence

## Safety And Privacy Defaults

Public map labels use approximate location copy, settings emphasize hiding live location, and the catch flow includes reminders not to chase, harm, disturb, or trespass while photographing cats.
