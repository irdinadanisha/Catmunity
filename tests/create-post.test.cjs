const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const services = fs.readFileSync(path.join(root, 'src/services/catServices.js'), 'utf8');
function functionSource(source, name) {
  const start = source.search(new RegExp(`(?:export )?(?:async )?function ${name}\\(`));
  const next = source.slice(start + 1).search(/\n(?:export )?(?:async )?function /);
  return source.slice(start, next < 0 ? undefined : start + 1 + next).replace(/^export /, '');
}
test('fresh coordinates, global reverse geocoding, and failure without fallback', async () => {
  let calls = 0;
  const context = vm.createContext({ setTimeout, clearTimeout, navigator: { geolocation: { getCurrentPosition(ok, fail, options) {
    calls++;
    assert.equal(options.maximumAge, 0);
    assert.equal(options.enableHighAccuracy, true);
    ok({ coords: { latitude: 37.5665, longitude: 126.978, accuracy: 12 } });
  } } }, reverseGeocodeLocation: async (lat, lng) => {
    assert.equal(lat, 37.5665); assert.equal(lng, 126.978);
    return { locationName: 'Seoul, South Korea' };
  } });
  vm.runInContext(functionSource(services, 'getCurrentPostLocation'), context);
  assert.equal((await context.getCurrentPostLocation()).locationName, 'Seoul, South Korea');
  await context.getCurrentPostLocation(); assert.equal(calls, 2);
  context.reverseGeocodeLocation = async () => null;
  await assert.rejects(context.getCurrentPostLocation(), /area name could not be loaded/);
  context.navigator.geolocation.getCurrentPosition = (ok, fail) => fail({ code: 3 });
  await assert.rejects(context.getCurrentPostLocation(), /could not detect/);
  context.navigator.geolocation.getCurrentPosition = (ok, fail) => fail({ code: 1 });
  await assert.rejects(context.getCurrentPostLocation(), /permission was denied/);
  context.navigator.geolocation = undefined;
  await assert.rejects(context.getCurrentPostLocation(), /not available/);
});
test('reverse geocoder never invents Malaysia when address components are missing', () => {
  const context = vm.createContext({});
  vm.runInContext(functionSource(services, 'parseGoogleReverseGeocode') + '\n' + functionSource(services, 'findAddressComponent'), context);
  const result = context.parseGoogleReverseGeocode([{ address_components: [
    { long_name: 'Seoul', types: ['administrative_area_level_1'] },
    { long_name: 'South Korea', types: ['country'] },
  ] }]);
  assert.equal(result.locationName, 'Seoul, South Korea');
});
test('Create Post layout, selection context, failure, and stale request protection', async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
  const esbuild = require('esbuild');
  const main = fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8');
  const component = main.slice(main.indexOf('function CreatePostScreen('), main.indexOf('\nfunction SettingsScreen('));
  const build = await esbuild.build({ stdin: { contents: `
    import React, { useState, useEffect, useRef } from 'react';
    import { createRoot } from 'react-dom/client';
    import { ChevronLeft, Image as ImageIcon, MapPin, X } from 'lucide-react';
    const useJsApiLoader = () => ({}); const googleMapsApiKey = '';
    const formatCaptureDateTime = value => value;
    const readImageFileAsDataUrl = file => Promise.resolve('data:image/png;base64,AA==');
    const getCurrentPostLocation = () => window.locationMode === 'denied'
      ? Promise.reject(new Error('Location permission was denied.'))
      : window.locationMode === 'pending' ? new Promise(resolve => window.resolveLocation = resolve)
      : Promise.resolve({locationName: 'Seoul, South Korea'});
    const getRelatedCatCatch = async (user, catId) => ({catId, locationName: catId === 'a' ? 'Busan' : 'Incheon', discoveredAt: '2026-08-01T09:00:00Z'});
    ${component}
    createRoot(document.getElementById('root')).render(<CreatePostScreen currentUserId="user" cats={[{id:'a',name:'Andre'}, {id:'b',name:'Golden'}]} onBack={() => {}} onCreate={post => window.posts.push(post)} />);
  `, loader: 'jsx', resolveDir: root }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'src/styles/app.css'), 'utf8') });
    await page.evaluate(() => window.posts = []);
    await page.addScriptTag({ content: build.outputFiles[0].text });
    await page.locator('textarea').fill('Hello');
    const picture = await page.locator('.post-extra-upload').boundingBox();
    const location = await page.getByRole('button', {name: 'Add location', exact:true}).boundingBox();
    assert.ok(Math.abs(picture.y - location.y) < 3);
    assert.ok(picture.width < 180 && location.width < 180);
    assert.ok((await page.getByRole('button', {name:'Post',exact:true}).boundingBox()).width < 100);
    await page.getByRole('button', {name:'Post',exact:true}).click();
    assert.equal(await page.evaluate(() => window.posts[0].includeLocation), false);
    await page.getByRole('button', {name:'Add location',exact:true}).click();
    await page.getByText('Seoul, South Korea', {exact:true}).waitFor();
    await page.getByRole('button', {name:'Golden',exact:true}).click();
    await page.getByText('Incheon', {exact:true}).waitFor();
    assert.equal(await page.getByRole('button', {name:'Add location',exact:true}).isDisabled(), true);
    const geometry = await page.locator('.related-cat-options').evaluate(el => {
      const img = el.querySelector('.selected img'); const style = getComputedStyle(img);
      return { gap: img.getBoundingClientRect().top - el.getBoundingClientRect().top, ring: parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset), width: img.getBoundingClientRect().width };
    });
    assert.ok(geometry.gap >= geometry.ring); assert.equal(geometry.width, 48);
    await page.getByRole('button', {name:'Post',exact:true}).click();
    assert.equal(await page.evaluate(() => window.posts[1].catchContext.locationName), 'Incheon');
    await page.getByRole('button', {name:'Clear',exact:true}).click();
    await page.evaluate(() => window.locationMode = 'denied');
    await page.getByRole('button', {name:'Add location',exact:true}).click();
    await page.getByText('Location permission was denied.', {exact:true}).waitFor();
    await page.evaluate(() => window.locationMode = 'pending');
    await page.getByRole('button', {name:'Add location',exact:true}).click();
    await page.getByRole('button', {name:'Andre',exact:true}).click();
    await page.getByText('Busan', {exact:true}).waitFor();
    await page.evaluate(() => window.resolveLocation({locationName:'Seoul, South Korea'}));
    assert.equal(await page.getByText('Seoul, South Korea', {exact:true}).count(), 0);
    await page.getByRole('button', {name:'Clear',exact:true}).click();
    assert.equal(await page.getByText('Seoul, South Korea', {exact:true}).count(), 0);
    await page.getByRole('button', {name:'Golden',exact:true}).click();
    await page.getByText('Incheon', {exact:true}).waitFor();
    await page.screenshot({path:path.join(os.tmpdir(), 'catmunity-create-post.png'), fullPage:true});
  } finally { await browser.close(); }
});

test('catch lookup scopes both owner and cat; post persists catch time without backdating publication', async () => {
  const filters = {};
  let payload;
  const query = {
    select() { return this; },
    eq(key, value) { filters[key] = value; return this; },
    insert(value) { payload = value; return this; },
    async single() { return { data: { cat_id: 'cat-b', discovered_at: '2026-08-01T09:00:00Z', sighting_area_name: 'Busan' }, error: null }; },
  };
  const context = vm.createContext({ isSupabaseConfigured: true, supabase: { from() { return query; } } });
  vm.runInContext(functionSource(services, 'getRelatedCatCatch'), context);
  const catchData = await context.getRelatedCatCatch('owner-a', 'cat-b');
  assert.deepEqual(filters, {user_id:'owner-a', cat_id:'cat-b', is_unlocked:true});
  assert.equal(catchData.locationName, 'Busan');
  const source = fs.readFileSync(path.join(root, 'src/services/supabaseClient.js'), 'utf8');
  vm.runInContext(functionSource(source, 'createCommunityPost'), context);
  await context.createCommunityPost({ userId:'owner-a', catId:'cat-b', caption:'Hello', locationName:catchData.locationName, captureDiscoveredAt:catchData.discoveredAt });
  assert.equal(payload.capture_discovered_at, catchData.discoveredAt);
  assert.equal(payload.location_name, 'Busan');
  assert.equal('created_at' in payload, false);
  await context.createCommunityPost({userId:'owner-a', caption:'Normal post'});
  assert.equal(payload.cat_id, null);
  assert.equal(payload.capture_discovered_at, null);
  assert.equal(payload.location_name, null);
});
