// ==UserScript==
// @name         Nextcloud Folder Gallery
// @namespace    https://github.com/advanced4/nextcloud-folder-gallery
// @version      0.2.0
// @description  Browse Nextcloud folders using their existing preview images.
// @match        https://*/apps/files/*
// @match        https://*/index.php/apps/files/*
// @match        https://*/*/apps/files/*
// @match        https://*/*/index.php/apps/files/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @inject-into  content
// @noframes
// @license      MIT
// @homepageURL  https://advanced4.github.io/nextcloud-folder-gallery/
// @supportURL   https://github.com/advanced4/nextcloud-folder-gallery/issues
// @downloadURL  https://advanced4.github.io/nextcloud-folder-gallery/nextcloud-folder-gallery.user.js
// @updateURL    https://advanced4.github.io/nextcloud-folder-gallery/nextcloud-folder-gallery.user.js
// ==/UserScript==

/* Icon notices (Lucide / Feather):
 * Copyright (c) 2026 Lucide Icons and Contributors
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 * Copyright (c) 2013-present Cole Bemis
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

(() => {
  'use strict';

  const DEFAULT_KEYWORDS = ['poliigon'];
  const PREVIEW_MATCH = /(?:preview|sphere).*\.(png|jpe?g)$/i;
  const ID = 'nc-folder-gallery';
  const CONCURRENCY = 4;
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const EMPTY_TTL = 5 * 60 * 1000;
  const CACHE_LIMIT = 5000;
  const DAV = 'DAV:';
  const OC = 'http://owncloud.org/ns';
  const NC = 'http://nextcloud.org/ns';
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const listingBody = `<?xml version="1.0"?>
    <d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
      <d:prop><d:resourcetype/><d:getetag/><oc:fileid/><nc:hide-download/></d:prop>
    </d:propfind>`;

  function context() {
    const url = new URL(location.href);
    const route = url.pathname.match(/^(.*?)(?:\/index\.php)?\/apps\/files(?:\/(files|personal)(?:\/\d+)?)?\/?$/);
    const uid = document.head.dataset.user;
    const dir = url.searchParams.get('dir') || '/';
    if (!route || !uid || !dir.startsWith('/')) return null;
    const settingsKey = `folder-gallery:${url.origin}:${route[1]}:${uid}`;
    const stored = GM_getValue(settingsKey, null);
    const keywords = Array.isArray(stored) ? stored.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim().toLowerCase()) : DEFAULT_KEYWORDS;
    const eligible = keywords.some(word => dir.toLowerCase().includes(word));
    return { base: route[1], uid, dir: dir.replace(/\/+$/, '') || '/', settingsKey, keywords, eligible,
      key: JSON.stringify([uid, url.pathname, dir, keywords]) };
  }

  function encodedPath(path) {
    return path.split('/').map(encodeURIComponent).join('/');
  }

  function directoryUrl(ctx, path) {
    return new URL(`${ctx.base}/remote.php/dav/files/${encodeURIComponent(ctx.uid)}${encodedPath(path)}/`, location.origin);
  }

  function openUrl(ctx, path) {
    const url = new URL(`${ctx.base}/index.php/apps/files/`, location.origin);
    url.searchParams.set('dir', path);
    return url.href;
  }

  function thumbnailUrl(ctx, preview) {
    if (!/^[1-9]\d*$/.test(preview.id)) throw new Error('Preview has no valid Nextcloud file ID.');
    const url = new URL(`${ctx.base}/index.php/core/preview`, location.origin);
    // Nextcloud rounds to powers of four: 512 would produce a 1024px preview.
    url.search = new URLSearchParams({ fileId: preview.id, x: '256', y: '256', a: 'true',
      forceIcon: '0', c: preview.etag, user: ctx.uid }).toString();
    return url.href;
  }

  // Store only discovery metadata locally, not image bodies or login details.
  function previewCache(ctx) {
    const key = `${ctx.settingsKey}:previews:v1`;
    let entries = new Map(), timer, dirty = false, unavailable = false;
    function valid(record) {
      return record && typeof record.etag === 'string' && record.etag
        && Number.isFinite(record.time) && record.time <= Date.now()
        && Date.now() - record.time < (record.preview === null ? EMPTY_TTL : CACHE_TTL)
        && (record.preview === null || (record.preview && /^[1-9]\d*$/.test(record.preview.id)
          && typeof record.preview.etag === 'string'));
    }
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '[]');
      if (Array.isArray(saved)) entries = new Map(saved.filter(pair => Array.isArray(pair)
        && typeof pair[0] === 'string' && valid(pair[1])).slice(-CACHE_LIMIT));
    } catch { unavailable = true; }
    const cacheKey = item => JSON.stringify([item.folder.id, item.path]);
    function flush() {
      clearTimeout(timer);
      if (!dirty) return;
      entries = new Map([...entries].filter(([, record]) => valid(record))
        .sort((a, b) => a[1].time - b[1].time).slice(-CACHE_LIMIT));
      try { localStorage.setItem(key, JSON.stringify([...entries])); unavailable = false; }
      catch { unavailable = true; }
      dirty = false;
    }
    function changed() {
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(flush, 250);
    }
    return {
      get unavailable() { return unavailable; },
      get(item) {
        const record = entries.get(cacheKey(item));
        return valid(record) && record.etag === item.folder.etag ? record.preview : undefined;
      },
      put(item, preview) {
        if (!item.folder.etag) return;
        entries.set(cacheKey(item), { etag: item.folder.etag, time: Date.now(), preview });
        changed();
      },
      remove(item) { if (entries.delete(cacheKey(item))) changed(); },
      clear() { entries.clear(); changed(); },
      flush,
    };
  }

  function parseListing(xml, requestUrl) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'multistatus'
        || doc.documentElement.namespaceURI !== DAV) throw new Error('Nextcloud returned an invalid folder listing.');
    const parent = decodeURIComponent(requestUrl.pathname).replace(/\/$/, '');
    return Array.from(doc.getElementsByTagNameNS(DAV, 'response')).flatMap(response => {
      const raw = response.getElementsByTagNameNS(DAV, 'href')[0]?.textContent;
      if (!raw) return [];
      const url = new URL(raw, requestUrl);
      if (url.origin !== requestUrl.origin || url.username || url.password || url.search || url.hash) return [];
      let path;
      try { path = decodeURIComponent(url.pathname).replace(/\/$/, ''); } catch { return []; }
      if (!path.startsWith(`${parent}/`)) return [];
      const name = path.slice(parent.length + 1);
      if (!name || name.includes('/') || name === '.' || name === '..') return [];
      const properties = Array.from(response.getElementsByTagNameNS(DAV, 'propstat'))
        .filter(p => /\s200(?:\s|$)/.test(p.getElementsByTagNameNS(DAV, 'status')[0]?.textContent || ''));
      if (!properties.length) return [];
      const prop = (ns, tag) => properties.map(p => p.getElementsByTagNameNS(ns, tag)[0]?.textContent).find(v => v !== undefined) || '';
      return [{ name, href: url.href, folder: properties.some(p => p.getElementsByTagNameNS(DAV, 'collection').length),
        id: prop(OC, 'fileid'), etag: prop(DAV, 'getetag'), hideDownload: ['true', '1'].includes(prop(NC, 'hide-download')) }];
    });
  }

  async function list(ctx, path, signal) {
    const url = directoryUrl(ctx, path);
    const timeout = new AbortController();
    const abort = () => timeout.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) timeout.abort();
    const timer = setTimeout(abort, 20000);
    try {
      const response = await fetch(url, { method: 'PROPFIND', credentials: 'same-origin', mode: 'same-origin',
        redirect: 'error', cache: 'no-store', signal: timeout.signal, headers: { Depth: '1', 'Content-Type': 'application/xml',
          'X-Requested-With': 'XMLHttpRequest', requesttoken: document.head.dataset.requesttoken || '' }, body: listingBody });
      if (response.status === 401) throw new Error('Your Nextcloud session expired. Sign in again.');
      if (response.status === 403) throw new Error('Nextcloud denied access to this folder.');
      if (response.status !== 207) throw new Error(`Folder listing failed (HTTP ${response.status}).`);
      return parseListing(await response.text(), url);
    } catch (error) {
      if (timeout.signal.aborted && !signal.aborted) throw new Error('Folder listing timed out. Try Refresh.');
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }

  function element(tag, text, className) {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    if (className) el.className = className;
    return el;
  }

  // Lucide refresh-cw and download icons, ISC licensed (see THIRD_PARTY.md).
  function icon(kind) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none',
      stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
    const paths = kind === 'download' ? ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3']
      : ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'];
    paths.forEach(d => { const p = document.createElementNS(svg.namespaceURI, 'path'); p.setAttribute('d', d); svg.append(p); });
    return svg;
  }

  const style = element('style');
  style.textContent = `
    #${ID} { color:var(--color-main-text,#202528); font:14px/1.5 system-ui,sans-serif; letter-spacing:0; min-height:0; display:flex; flex-direction:column; }
    #${ID} * { box-sizing:border-box; }
    #${ID} [hidden] { display:none !important; }
    #${ID} .fg-toolbar { display:flex; flex:0 0 auto; align-items:center; flex-wrap:wrap; gap:8px; padding:8px 16px; border-bottom:1px solid var(--color-border,#ddd); }
    #${ID} button, #${ID} .fg-download { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:36px; padding:6px 12px; border:1px solid var(--color-border,#ccc); border-radius:6px; color:inherit; background:var(--color-main-background,#fff); cursor:pointer; font:inherit; margin:0; }
    #${ID} button[aria-pressed=true] { background:var(--color-primary-element,#006c75); color:var(--color-primary-element-text,#fff); }
    #${ID} button:disabled { opacity:.6; cursor:wait; }
    #${ID} .fg-icon { width:36px; flex:0 0 36px; padding:6px; }
    #${ID} input { min-width:120px; width:220px; max-width:100%; height:36px; margin:0; padding:6px 10px; font:inherit; }
    #${ID} :focus-visible { outline:3px solid var(--color-primary-element,#006c75); outline-offset:3px; }
    #${ID} .fg-status { flex:1; min-width:120px; font-size:13px; }
    #${ID} .fg-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(180px,100%),1fr)); grid-auto-rows:max-content; gap:16px; padding:16px; overflow:auto; min-height:0; align-content:start; }
    #${ID} .fg-card { min-width:0; height:max-content; border:1px solid var(--color-border,#ddd); border-radius:6px; overflow:hidden; background:var(--color-main-background,#fff); }
    #${ID} .fg-cover { display:block; position:relative; aspect-ratio:1; color:inherit; background:var(--color-background-dark,#e9ecef); overflow:hidden; }
    #${ID} .fg-cover img { width:100%; height:100%; object-fit:contain; display:block; }
    #${ID} .fg-placeholder { height:100%; display:grid; place-items:center; text-align:center; padding:12px; }
    #${ID} .fg-caption { display:flex; align-items:center; gap:8px; padding:10px; }
    #${ID} .fg-name { flex:1; min-width:0; overflow-wrap:anywhere; color:inherit; line-height:1.4; text-decoration:none; }
    #${ID} a:hover { text-decoration:underline; }
    #${ID} .fg-download { width:36px; flex:0 0 36px; padding:6px; }
    #${ID}.fg-active { flex:1; overflow:hidden; }
    .fg-native-hidden { display:none !important; }
    @media(max-width:600px) { #${ID} .fg-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; padding:8px; } #${ID} .fg-toolbar { padding:8px; } #${ID} .fg-status { flex-basis:100%; } #${ID} input { flex:1; } }
  `;
  if (document.getElementById(ID)) return;
  document.head.append(style);

  let state = null;
  let lastKey = '';

  function configure() {
    const ctx = context();
    if (!ctx) return;
    const answer = window.prompt('Folder path keywords (comma-separated, case-insensitive). These stay in your userscript manager on this browser. Leave empty to disable previews.', ctx.keywords?.join(', ') || '');
    if (answer === null) return;
    GM_setValue(ctx.settingsKey, [...new Set(answer.split(',').map(v => v.trim().toLowerCase()).filter(Boolean))]);
    sync();
  }

  GM_registerMenuCommand('Configure folder previews for this Nextcloud account', configure);

  function cleanup() {
    if (!state) return;
    state.controller.abort();
    state.run?.observer.disconnect();
    state.cache.flush();
    state.native.classList.remove('fg-native-hidden');
    state.root.remove();
    state = null;
  }

  function show(s, active) {
    s.active = active;
    s.root.classList.toggle('fg-active', active);
    s.native.classList.toggle('fg-native-hidden', active);
    s.grid.hidden = !active;
    s.search.hidden = !active;
    s.toggle.setAttribute('aria-pressed', String(active));
    s.toggle.textContent = active ? 'Show normal files' : 'Folder gallery';
    s.run?.pump();
  }

  function applyFilter(s) {
    const query = s.search.value.trim().toLocaleLowerCase();
    let visible = 0;
    s.cards.forEach(({ folder, card }) => { card.hidden = !folder.name.toLocaleLowerCase().includes(query); if (!card.hidden) visible++; });
    s.empty.hidden = visible !== 0;
    s.empty.textContent = s.cards.length ? 'No matching folders.' : 'No child folders.';
    s.run?.pump();
  }

  function cardFor(s, folder) {
    const path = `${s.ctx.dir === '/' ? '' : s.ctx.dir}/${folder.name}`;
    const card = element('article', '', 'fg-card');
    const cover = element('a', '', 'fg-cover');
    cover.href = openUrl(s.ctx, path);
    cover.setAttribute('aria-label', `Open folder ${folder.name}`);
    const placeholder = element('span', 'Preview pending', 'fg-placeholder');
    cover.append(placeholder);
    const caption = element('div', '', 'fg-caption');
    const name = element('a', folder.name, 'fg-name');
    name.href = cover.href;
    caption.append(name);
    if (!folder.hideDownload) {
      const download = element('a', '', 'fg-download');
      const url = directoryUrl(s.ctx, path);
      url.searchParams.set('accept', 'zip');
      download.href = url.href;
      download.download = `${folder.name}.zip`;
      download.title = `Download ${folder.name} as ZIP`;
      download.setAttribute('aria-label', download.title);
      download.append(icon('download'));
      caption.append(download);
    }
    card.append(cover, caption);
    s.grid.append(card);
    return { folder, card, cover, placeholder, path, near: false, started: false };
  }

  async function load(s, force = false) {
    s.controller.abort();
    s.run?.observer.disconnect();
    s.run = null;
    s.controller = new AbortController();
    const signal = s.controller.signal;
    s.refresh.disabled = true;
    s.status.textContent = 'Reading folders...';
    s.grid.replaceChildren();
    s.cards = [];
    s.empty = element('p');
    s.grid.append(s.empty);
    try {
      const entries = await list(s.ctx, s.ctx.dir, signal);
      if (signal.aborted) return;
      const folders = entries.filter(e => e.folder).sort((a, b) => collator.compare(a.name, b.name));
      s.cards = folders.map(folder => cardFor(s, folder));
      if (force) { s.cards.forEach(item => s.cache.remove(item)); s.cache.flush(); }
      applyFilter(s);
      if (!s.cards.length) { s.status.textContent = '0 previews / 0 folders'; show(s, false); return; }
      if (typeof IntersectionObserver !== 'function') throw new Error('This browser does not support lazy folder previews.');
      let active = 0, completed = 0, found = 0, failed = 0, pumping = false;
      const queue = new Set();
      const items = new Map(s.cards.map(item => [item.card, item]));
      function status() {
        s.status.textContent = `${found} previews / ${s.cards.length} folders; ${completed} checked${failed ? `; ${failed} could not be read. Try Refresh.` : ''}${s.cache.unavailable ? '; Local cache unavailable.' : ''}`;
      }
      async function inspect(item) {
        active++;
        item.started = true;
        item.placeholder.textContent = 'Checking preview...';
        try {
          let preview = s.cache.get(item);
          if (preview === undefined) {
            const children = await list(s.ctx, item.path, signal);
            if (signal.aborted) return;
            const match = children.filter(e => !e.folder && !e.hideDownload && PREVIEW_MATCH.test(e.name))
              .sort((a, b) => collator.compare(a.name, b.name))[0];
            preview = match ? { id: match.id, etag: match.etag } : null;
            if (preview) thumbnailUrl(s.ctx, preview);
            s.cache.put(item, preview);
          }
          if (preview) {
            const img = element('img');
            img.alt = '';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.referrerPolicy = 'same-origin';
            img.addEventListener('error', () => {
              if (signal.aborted) return;
              s.cache.remove(item);
              s.cache.flush();
              found--; failed++; status();
              img.remove(); item.placeholder.hidden = false; item.placeholder.textContent = 'Preview unavailable';
            }, { once: true });
            img.src = thumbnailUrl(s.ctx, preview);
            item.placeholder.hidden = true;
            item.cover.append(img);
            found++;
          } else item.placeholder.textContent = 'No preview';
        } catch (error) {
          if (signal.aborted) return;
          s.cache.remove(item);
          failed++;
          item.placeholder.textContent = 'Could not read folder';
          item.placeholder.title = error.message;
        } finally {
          active--;
          if (!signal.aborted) {
            completed++;
            pump();
            if (!active) s.cache.flush();
            status();
            if (completed === s.cards.length && !found && s.choice === null) show(s, false);
          }
        }
      }
      function pump() {
        if (signal.aborted || !s.active || pumping) return;
        pumping = true;
        try {
          for (const item of queue) {
            if (active >= CONCURRENCY) break;
            if (item.near && !item.card.hidden && !item.started) {
              queue.delete(item);
              void inspect(item);
            }
          }
        } finally {
          pumping = false;
        }
      }
      const observer = new IntersectionObserver(records => {
        for (const record of records) {
          const item = items.get(record.target);
          item.near = record.isIntersecting;
          if (item.near && !item.started) queue.add(item);
          else queue.delete(item);
        }
        pump();
      }, { root: s.grid, rootMargin: '400px 0px' });
      s.run = { observer, pump };
      status();
      show(s, s.choice !== false);
      s.cards.forEach(item => observer.observe(item.card));
    } catch (error) {
      if (signal.aborted) return;
      s.cache.clear();
      s.status.textContent = error.message;
      show(s, false);
    } finally {
      if (!signal.aborted) s.refresh.disabled = false;
    }
  }

  function mount(ctx, native) {
    const root = element('section');
    root.id = ID;
    root.setAttribute('aria-label', 'Folder gallery');
    const toolbar = element('div', '', 'fg-toolbar');
    const toggle = element('button', 'Folder gallery');
    toggle.type = 'button';
    const search = element('input');
    search.type = 'search'; search.placeholder = 'Find a folder'; search.setAttribute('aria-label', 'Find a folder');
    const refresh = element('button', '', 'fg-icon');
    refresh.type = 'button'; refresh.title = 'Refresh previews'; refresh.setAttribute('aria-label', 'Refresh previews'); refresh.append(icon('refresh'));
    const status = element('span', '', 'fg-status');
    status.setAttribute('role', 'status');
    const grid = element('div', '', 'fg-grid');
    toolbar.append(toggle, search, refresh, status);
    root.append(toolbar, grid);
    native.before(root);
    const s = { root, native, ctx, toggle, search, refresh, status, grid, cards: [], cache: previewCache(ctx),
      controller: new AbortController(), active: false, choice: null, run: null };
    toggle.addEventListener('click', () => { s.choice = !s.active; show(s, s.choice); });
    search.addEventListener('input', () => applyFilter(s));
    refresh.addEventListener('click', () => load(s, true));
    show(s, false);
    return s;
  }

  function sync() {
    const ctx = context();
    const native = document.querySelector('#app-content-vue > .files-list');
    if (!ctx || !native || !ctx.eligible) { cleanup(); lastKey = ''; return; }
    if (ctx.key === lastKey && state?.root.isConnected && state.native === native) return;
    cleanup();
    lastKey = ctx.key;
    state = mount(ctx, native);
    load(state);
  }

  // Nextcloud navigates without page reloads. Observe its DOM, not private Vue stores.
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; sync(); }, 100);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', sync);
  window.addEventListener('pagehide', () => { observer.disconnect(); cleanup(); });
  window.addEventListener('pageshow', () => { observer.observe(document.body, { childList: true, subtree: true }); sync(); });
  sync();
})();
