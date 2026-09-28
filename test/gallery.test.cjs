const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync('docs/nextcloud-folder-gallery.user.js', 'utf8');
const origin = 'https://example.invalid';
const root = '/remote.php/dav/files/test/assets';
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const encode = path => path.split('/').map(encodeURIComponent).join('/');
function xml(parent, entries) {
  return `<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">${[
    { href: parent, folder: true }, ...entries.map(e => ({ ...e, href: e.href || `${parent}/${encode(e.name)}` })),
  ].map(e => `<d:response><d:href>${escape(e.href)}</d:href><d:propstat><d:prop><d:resourcetype>${e.folder ? '<d:collection/>' : ''}</d:resourcetype><oc:fileid>123</oc:fileid><nc:hide-download>${e.hidden || false}</nc:hide-download></d:prop><d:status>HTTP/1.1 ${e.status || 200} OK</d:status></d:propstat></d:response>`).join('')}</d:multistatus>`;
}
function setup(t, { dir = '/assets', keywords = ['assets'], handler, uid = 'test', route = '/apps/files/files', base = '' } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main id="app-content-vue"><div class="files-list">Native files</div></main></body></html>', {
    url: `${origin}${route}?dir=${encodeURIComponent(dir)}`, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window;
  w.document.head.dataset.user = uid;
  w.document.head.dataset.requesttoken = 'synthetic-token';
  const storage = new Map();
  if (keywords !== null) storage.set(`folder-gallery:${origin}:${base}:${uid}`, keywords);
  w.GM_getValue = (key, fallback) => storage.has(key) ? storage.get(key) : fallback;
  w.GM_setValue = (key, value) => storage.set(key, value);
  const menus = [];
  w.GM_registerMenuCommand = (label, fn) => menus.push(fn);
  const calls = [];
  w.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    const result = await (handler ? handler(new URL(url), options) : { status: 207, body: xml(root, []) });
    return { status: result.status, text: async () => result.body };
  };
  w.eval(source);
  t.after(() => w.close());
  return { w, doc: w.document, calls, storage, menus };
}
async function until(fn) {
  const end = Date.now() + 2500;
  while (!fn()) {
    if (Date.now() > end) throw new Error('Timed out waiting for UI');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
const finished = s => until(() => s.doc.querySelector('.fg-status')?.textContent.includes('previews /'));

test('fresh install automatically shows previews in case-insensitive poliigon paths without saving settings', async t => {
  const s = setup(t, { keywords: null, dir: '/Library/Poliigon/Free', handler: url => {
    const parent = url.pathname.replace(/\/$/, '');
    return { status: 207, body: xml(parent, parent.endsWith('/Free') ? [{ name: 'Example', folder: true }] : [{ name: 'preview.png' }]) };
  } });
  await finished(s);
  assert.ok(s.doc.querySelector('.fg-cover img'));
  assert.equal(s.doc.querySelector('button').textContent, 'Show normal files');
  assert.equal(s.storage.size, 0);
});

test('fresh install leaves unrelated paths untouched without showing setup', t => {
  const s = setup(t, { keywords: null });
  assert.equal(s.calls.length, 0);
  assert.equal(s.doc.querySelector('#nc-folder-gallery'), null);
});

test('optional manager menu can override default keywords privately', async t => {
  const s = setup(t, { keywords: null });
  s.w.prompt = () => ' ASSETS, assets, Materials ';
  s.menus[0]();
  await finished(s);
  assert.deepEqual(Array.from(s.storage.values())[0].join(','), 'assets,materials');
});

test('sphere names support PNG, JPG and JPEG case-insensitively with natural ordering', async t => {
  for (const extension of ['PNG', 'JpG', 'JPEG']) {
    const s = setup(t, { handler: url => {
      const parent = url.pathname.replace(/\/$/, '');
      return { status: 207, body: xml(parent, parent === root ? [{ name: 'Example', folder: true }] : [
        { name: 'example_sphere1.svg' }, { name: 'example_sphere1.png.txt' },
        { name: `example_SPHERE10.${extension}` }, { name: `example_Sphere2.${extension}` },
        { name: `example_sphere1.${extension}`, folder: true }, { name: 'basecolor.png' },
      ]) };
    } });
    await finished(s);
    assert.ok(s.doc.querySelector('.fg-cover img').src.endsWith(`example_Sphere2.${extension}`));
  }
});

test('unmatched paths, disabled config, unsigned pages, and special views do not read folders', t => {
  for (const options of [{ dir: '/documents' }, { keywords: [] }, { uid: '' }, { route: '/apps/files/trashbin' }, { route: '/apps/files/recent' }]) {
    const s = setup(t, options);
    assert.equal(s.calls.length, 0);
    assert.equal(s.doc.querySelector('#nc-folder-gallery'), null);
  }
});

test('case-insensitive matching, immediate previews, natural selection and ZIP links', async t => {
  const s = setup(t, { dir: '/ASSETS', handler: url => {
    const parent = url.pathname.replace(/\/$/, '');
    if (parent.endsWith('/ASSETS')) return { status: 207, body: xml(parent, [{ name: 'Stone & Metal #1', folder: true }, { name: 'file.png' }]) };
    return { status: 207, body: xml(parent, [
      { name: 'basecolor.png' }, { name: 'nested', folder: true }, { name: 'PREVIEW10.PNG' },
      { name: 'PREVIEW2.JPEG' }, { name: 'preview.svg' }, { name: 'preview1.png', folder: true },
    ]) };
  } });
  await finished(s);
  assert.equal(s.doc.querySelectorAll('.fg-card').length, 1);
  assert.match(s.doc.querySelector('.fg-cover img').src, /PREVIEW2\.JPEG$/);
  const zip = new URL(s.doc.querySelector('.fg-download').href);
  assert.equal(zip.searchParams.get('accept'), 'zip');
  assert.match(zip.pathname, /Stone%20%26%20Metal%20%231\/$/);
  assert.equal(new URL(s.doc.querySelector('.fg-name').href).searchParams.get('dir'), '/ASSETS/Stone & Metal #1');
  assert.equal(s.calls.length, 2);
  assert.ok(s.doc.querySelector('.files-list').classList.contains('fg-native-hidden'));
  for (const call of s.calls) {
    assert.equal(new URL(call.url).origin, origin);
    assert.equal(call.options.method, 'PROPFIND');
    assert.equal(call.options.headers.Depth, '1');
    assert.equal(call.options.credentials, 'same-origin');
    assert.equal(call.options.redirect, 'error');
  }
});

test('bad hrefs, failed property blocks, and hidden-download previews are ignored', async t => {
  const s = setup(t, { handler: url => {
    const parent = url.pathname.replace(/\/$/, '');
    return { status: 207, body: xml(parent, parent === root ? [{ name: 'Asset', folder: true, hidden: true }] : [
      { name: 'preview1.png', href: 'https://other.invalid/preview1.png' },
      { name: 'preview2.png', href: `${root}/different/preview2.png` },
      { name: 'preview3.png', href: `${parent}/nested/preview3.png` },
      { name: 'preview4.png', hidden: true }, { name: 'preview5.png', status: 404 },
      { name: 'preview6.png', href: `${parent}/preview6.png?secret=bad` },
      { name: 'preview7.png', href: `${parent}/bad%encoding.png` },
    ]) };
  } });
  await finished(s);
  assert.equal(s.doc.querySelector('.fg-cover img'), null);
  assert.equal(s.doc.querySelector('.fg-download'), null);
  assert.equal(s.doc.querySelector('.files-list').classList.contains('fg-native-hidden'), false);
});

test('search, manual file-view toggle, and image failure keep usable UI', async t => {
  const s = setup(t, { handler: url => {
    const parent = url.pathname.replace(/\/$/, '');
    return { status: 207, body: xml(parent, parent === root ? [{ name: '<Asset>', folder: true }, { name: 'Other', folder: true }] : [{ name: 'preview.png' }]) };
  } });
  await finished(s);
  assert.equal(s.doc.querySelector('asset'), null);
  const input = s.doc.querySelector('input');
  input.value = '<asset>';
  input.dispatchEvent(new s.w.Event('input'));
  assert.equal([...s.doc.querySelectorAll('.fg-card')].filter(e => !e.hidden).length, 1);
  const img = s.doc.querySelector('img');
  img.dispatchEvent(new s.w.Event('error'));
  assert.equal(s.doc.querySelector('.fg-placeholder').textContent, 'Preview unavailable');
  s.doc.querySelector('button').click();
  assert.equal(s.doc.querySelector('.files-list').classList.contains('fg-native-hidden'), false);
  input.value = 'nothing';
  input.dispatchEvent(new s.w.Event('input'));
  assert.equal(s.doc.querySelector('.fg-grid p').hidden, false);
});

test('bounded concurrency and partial listing failure', async t => {
  let active = 0, maximum = 0;
  const s = setup(t, { handler: async url => {
    const parent = url.pathname.replace(/\/$/, '');
    if (parent === root) return { status: 207, body: xml(parent, Array.from({ length: 9 }, (_, i) => ({ name: `Asset${i}`, folder: true }))) };
    active++; maximum = Math.max(active, maximum);
    await new Promise(resolve => setTimeout(resolve, 15));
    active--;
    return parent.endsWith('Asset8') ? { status: 403, body: '' } : { status: 207, body: xml(parent, [{ name: 'preview.png' }]) };
  } });
  await finished(s);
  assert.equal(maximum, 4);
  assert.match(s.doc.querySelector('.fg-status').textContent, /8 previews \/ 9 folders; 1 could not be read/);
});

test('expired session and malformed XML report errors and retain native files', async t => {
  for (const result of [{ status: 401, body: '' }, { status: 207, body: '<html>Login</html>' }]) {
    const s = setup(t, { handler: () => result });
    await until(() => s.doc.querySelector('.fg-icon')?.disabled === false);
    assert.match(s.doc.querySelector('.fg-status').textContent, /session expired|invalid folder listing/);
    assert.equal(s.doc.querySelector('.files-list').classList.contains('fg-native-hidden'), false);
  }
});

test('navigation aborts outstanding work and removes all gallery UI', async t => {
  const s = setup(t, { handler: (_url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
  assert.equal(s.calls.length, 1);
  s.w.history.pushState({}, '', '/apps/files/files?dir=/documents');
  s.w.dispatchEvent(new s.w.PopStateEvent('popstate'));
  assert.equal(s.calls[0].options.signal.aborted, true);
  assert.equal(s.doc.querySelector('#nc-folder-gallery'), null);
});

test('refresh discovers newly uploaded previews without persistent caching', async t => {
  let present = false;
  const s = setup(t, { handler: url => {
    const parent = url.pathname.replace(/\/$/, '');
    return { status: 207, body: xml(parent, parent === root ? [{ name: 'Asset', folder: true }] : present ? [{ name: 'preview.jpg' }] : []) };
  } });
  await finished(s);
  assert.equal(s.doc.querySelector('img'), null);
  present = true;
  s.doc.querySelector('.fg-icon').click();
  await finished(s);
  assert.ok(s.doc.querySelector('img'));
});

test('subdirectory installations and index.php routes retain the proper API root', async t => {
  const s = setup(t, { base: '/cloud', route: '/cloud/index.php/apps/files/' });
  await finished(s);
  assert.match(s.calls[0].url, /\/cloud\/remote\.php\/dav\/files\/test\/assets\/$/);
});

test('Nextcloud file-id routes retain query-path matching after native navigation', async t => {
  const s = setup(t, { route: '/apps/files/files/1234' });
  await finished(s);
  assert.equal(s.calls.length, 1);
});

test('manager configuration is namespaced and can disable an active gallery', async t => {
  const s = setup(t);
  await finished(s);
  s.w.prompt = () => '';
  s.menus[0]();
  assert.equal(s.doc.querySelector('#nc-folder-gallery'), null);
  assert.equal(s.storage.size, 1);
  assert.deepEqual([...s.storage.keys()], [`folder-gallery:${origin}::test`]);
});
