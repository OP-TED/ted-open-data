/*
 * Copyright 2026 European Union
 *
 * Licensed under the EUPL, Version 1.2 or - as soon they will be approved by the European
 * Commission - subsequent versions of the EUPL (the "Licence"); You may not use this work except in
 * compliance with the Licence. You may obtain a copy of the Licence at:
 * https://joinup.ec.europa.eu/software/page/eupl
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the Licence
 * is distributed on an "AS IS" basis, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the Licence for the specific language governing permissions and limitations under
 * the Licence.
 */
// Test helpers — minimal shims for the browser globals the source modules
// touch. Plain node:test can run the pure modules (facets, namespaces,
// tedAPI) without any shims at all, but ExplorerController reaches into
// sessionStorage and window.location, so we stand those up here.
//
// Importing this file has side effects: it installs shims on globalThis.
// Each test file that needs them should `import './_helpers.js'` before
// importing the code under test.

// ── sessionStorage shim ─────────────────────────────────────────────

class MemoryStorage {
  constructor() { this._map = new Map(); }
  getItem(key)        { return this._map.has(key) ? this._map.get(key) : null; }
  setItem(key, value) { this._map.set(key, String(value)); }
  removeItem(key)     { this._map.delete(key); }
  clear()             { this._map.clear(); }
  get length()        { return this._map.size; }
}

if (typeof globalThis.sessionStorage === 'undefined') {
  globalThis.sessionStorage = new MemoryStorage();
}

// ── window.location shim ───────────────────────────────────────────

// Only the pieces ExplorerController.getShareableUrl / initFromUrlParams touch:
//   - window.location.href      (read by new URL(...))
//   - window.location.search    (read by URLSearchParams)
//   - window.history.replaceState (called by getShareableUrl? no, not called)
// We default to a localhost origin and let tests set .href explicitly.
const DEFAULT_HREF = 'http://localhost:8080/';

function setLocation(href) {
  const url = new URL(href);
  globalThis.window.location.href = url.href;
  globalThis.window.location.search = url.search;
  globalThis.window.location.pathname = url.pathname;
  globalThis.window.location.origin = url.origin;
  globalThis.window.location.hostname = url.hostname;
}

if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    location: { href: '', search: '', pathname: '', origin: '', hostname: '' },
  };
  setLocation(DEFAULT_HREF);
}

// ── Minimal document shim ──────────────────────────────────────────
//
// NoticeView and BacklinksView reach into the DOM via getElementById
// in their constructors. We don't want to drag in JSDOM (~3MB of deps)
// for a handful of tests, so this shim returns stub elements that
// expose just the surface those classes touch: style, dataset,
// classList, innerHTML, replaceChildren, appendChild, querySelector,
// querySelectorAll, addEventListener, textContent, offsetParent.
//
// The stub elements are intentionally dumb — they don't render or
// reflow anything. Tests that need to inspect what was rendered should
// use them as opaque sinks ("did this method call appendChild N times").
//
// Intentional omissions (add them here when a new test needs them):
//   - querySelector / querySelectorAll always return null / [] — no
//     DOM-tree traversal. Tests that want to find child elements should
//     reach for them through the StubElement's _children array instead.
//   - no event bubbling — addEventListener stores handlers on each
//     element but dispatchEvent is not implemented. Simulated clicks
//     in tests call the handler directly via the controller API.
//   - no layout metrics — offsetWidth, offsetHeight, getBoundingClientRect
//     are undefined. Tests that want to verify scroll positioning or
//     sizing behaviour should use Playwright against the running app.
//   - requestAnimationFrame runs the callback synchronously, unlike
//     real browsers which defer to the next paint. Tests that depend
//     on post-rAF layout reads won't see the real timing.
// When a test needs something the shim doesn't provide, extend the shim
// here rather than reaching for JSDOM — the shim is small enough that
// growing it incrementally stays cheaper than pulling in a full DOM.

class StubElement {
  constructor(id) {
    this.id = id;
    this.style = {};
    this.dataset = {};
    this.classList = new StubClassList();
    this._children = [];
    this._listeners = new Map();
    this._innerHTML = '';
    this.textContent = '';
    this.disabled = false;
    this.checked = false;
  }
  set innerHTML(v) { this._innerHTML = v; this._children.length = 0; }
  get innerHTML() { return this._innerHTML; }
  appendChild(child) { this._children.push(child); return child; }
  replaceChildren(...children) { this._children = children; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  addEventListener(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(handler);
  }
  removeAttribute() {}
  setAttribute() {}
  click() {}
  get parentElement() { return null; }
  get offsetParent() { return this; }
}

class StubClassList {
  constructor() { this._set = new Set(); }
  add(...names) { for (const n of names) this._set.add(n); }
  remove(...names) { for (const n of names) this._set.delete(n); }
  toggle(name, force) {
    const has = this._set.has(name);
    const shouldHave = force === undefined ? !has : !!force;
    if (shouldHave) this._set.add(name); else this._set.delete(name);
    return shouldHave;
  }
  contains(name) { return this._set.has(name); }
  get length() { return this._set.size; }
}

const _stubElements = new Map();

// requestAnimationFrame is used by NoticeView._scrollToCurrent. The
// stub just runs the callback synchronously since tests don't actually
// render anything.
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb) => { cb(0); return 0; };
}

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    getElementById(id) {
      if (!_stubElements.has(id)) _stubElements.set(id, new StubElement(id));
      return _stubElements.get(id);
    },
    createElement(_tag) {
      return new StubElement(null);
    },
    createTextNode(text) {
      // A text node is a leaf with a textContent and a nodeType. The
      // production code only ever appendChild's it; the stub container
      // just stores it in _children.
      return { nodeType: 3, textContent: String(text), nodeValue: String(text) };
    },
  };
}

// ── Reset helper for tests ─────────────────────────────────────────

// Clears sessionStorage, resets the URL, and wipes the stub element cache
// between tests. Call from a `beforeEach` so each test sees a pristine
// environment.
export function resetShims() {
  globalThis.sessionStorage.clear();
  setLocation(DEFAULT_HREF);
  _stubElements.clear();
}

export { setLocation };
