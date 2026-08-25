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
// Supported traversal:
//   - querySelector / querySelectorAll take a single simple selector
//     (".class", "#id", "tag") and walk the subtree. Combinators — spaces,
//     ">", ":scope" — are not parsed and match nothing, so code relying on
//     them (TreeRenderer.reveal) still needs _children directly.
//   - closest() walks up through _parent, which appendChild maintains, and
//     accepts a comma-separated selector list.
//   - appendChild splices a document fragment's children in, as a real DOM
//     does, rather than keeping the fragment as a node in the tree.
//
// Intentional omissions (add them here when a new test needs them):
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
    this.nodeType = 1; // Node.ELEMENT_NODE — text nodes use 3 (see createTextNode)
    this.tagName = undefined;
    this.style = {};
    this.dataset = {};
    this.classList = new StubClassList();
    this._children = [];
    this._listeners = new Map();
    this._attributes = new Map();
    this._innerHTML = '';
    this.textContent = '';
    this.disabled = false;
    this.checked = false;
  }
  set innerHTML(v) { this._innerHTML = v; this._children.length = 0; }
  get innerHTML() { return this._innerHTML; }
  appendChild(child) {
    // A real DOM moves a fragment's children into the parent and leaves the
    // fragment empty. Keeping the fragment itself as a child instead would
    // put a node in the tree that no selector can see through, hiding
    // everything TreeRenderer builds.
    if (child?.nodeType === 11) {
      for (const grandchild of child._children) {
        if (grandchild && typeof grandchild === 'object') grandchild._parent = this;
        this._children.push(grandchild);
      }
      child._children = [];
      return child;
    }
    if (child && typeof child === 'object') child._parent = this;
    this._children.push(child);
    return child;
  }

  // Walks up the tree the way the real one does. TreeRenderer's card handler
  // calls closest() to decide whether a click landed on a link rather than on
  // the card itself, so without this the whole click path is untestable.
  closest(selector) {
    const selectors = String(selector).split(',').map(s => s.trim()).filter(Boolean);
    for (let el = this; el; el = el._parent) {
      if (el.nodeType === 1 && selectors.some(s => el._matchesSelf(s))) return el;
    }
    return null;
  }

  _matchesSelf(selector) {
    if (selector.startsWith('.')) {
      const name = selector.slice(1);
      return this.classList?.contains(name)
        || String(this.className ?? '').split(/\s+/).includes(name);
    }
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    return this.tagName === selector.toUpperCase();
  }
  replaceChildren(...children) { this._children = children; }

  /** Detach from the parent, as Element.remove does. */
  remove() {
    const siblings = this._parent?._children;
    if (siblings) {
      const at = siblings.indexOf(this);
      if (at !== -1) siblings.splice(at, 1);
    }
    this._parent = null;
  }

  // Simple selectors only — ".class", "#id" or "tag" — matched against the
  // element subtree. Combinators (spaces, ">", ":scope") are not supported and
  // return nothing, as before.
  //
  // This exists because TreeRenderer looks its own toggle up with
  // querySelector during render. With the old always-null stub the render path
  // threw on the first card, so no test could drive it end to end, and a link
  // that dropped its navigation context stayed invisible.
  querySelector(selector) { return this._match(selector)[0] ?? null; }
  querySelectorAll(selector) { return this._match(selector); }

  _match(selector) {
    if (typeof selector !== 'string' || /[\s>,]/.test(selector)) return [];
    const test = (el) => el._matchesSelf(selector);

    const found = [];
    const walk = (el) => {
      for (const child of el._children || []) {
        if (child.nodeType !== 1) continue;
        if (test(child)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  addEventListener(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(handler);
  }
  // Attributes are stored rather than discarded: some behaviour is carried by
  // them alone — a Bootstrap data API hook, an aria state — and a test cannot
  // see it if setting one is a no-op.
  removeAttribute(name) { this._attributes.delete(name); }
  setAttribute(name, value) { this._attributes.set(name, String(value)); }
  getAttribute(name) { return this._attributes.has(name) ? this._attributes.get(name) : null; }
  click() {}
  get parentElement() { return this._parent ?? null; }
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
    // Code that closes something when the click lands elsewhere registers
    // here. The handlers are kept so a test can see one was removed again.
    _listeners: new Map(),
    addEventListener(event, handler) {
      if (!this._listeners.has(event)) this._listeners.set(event, []);
      this._listeners.get(event).push(handler);
    },
    removeEventListener(event, handler) {
      const handlers = this._listeners.get(event);
      if (!handlers) return;
      const at = handlers.indexOf(handler);
      if (at !== -1) handlers.splice(at, 1);
    },
    getElementById(id) {
      if (!_stubElements.has(id)) _stubElements.set(id, new StubElement(id));
      return _stubElements.get(id);
    },
    createElement(tag) {
      const el = new StubElement(null);
      el.tagName = tag ? String(tag).toUpperCase() : undefined;
      return el;
    },
    createTextNode(text) {
      // A text node is a leaf with a textContent and a nodeType. The
      // production code only ever appendChild's it; the stub container
      // just stores it in _children.
      return { nodeType: 3, textContent: String(text), nodeValue: String(text) };
    },
    createDocumentFragment() {
      // TreeRenderer builds each subtree into a fragment before attaching it.
      // A fragment is only ever appended to, so a StubElement carrying the
      // DOCUMENT_FRAGMENT_NODE type is enough — without this, render() cannot
      // run under test at all and the recursion has to be stubbed out, which
      // is precisely where the cycle-marker regression hid.
      const el = new StubElement(null);
      el.nodeType = 11;
      return el;
    },
  };
}

// ── Bootstrap shim ─────────────────────────────────────────────────
//
// TreeRenderer attaches a Tooltip and a Popover to every reference-card
// button, from the global Bootstrap bundle the page loads via <script>.
// Without a stand-in, render() throws on the first card and the whole render
// path becomes untestable — which is how a link that silently dropped its
// navigation context went unnoticed.
//
// The stubs record what they were asked to show rather than displaying it, so
// a test can assert on the card's content without a layout engine.

if (typeof globalThis.bootstrap === 'undefined') {
  class Tooltip {
    constructor(el, options = {}) { this.el = el; this.options = options; this.enabled = true; }
    show() {} hide() {}
    enable() { this.enabled = true; }
    disable() { this.enabled = false; }
    dispose() {}
  }
  // Faithful on the two points a leak or a use-after-dispose turns on.
  //
  // Bootstrap keeps every instance in a strong module-level Map and only
  // dispose() removes it, so `live` stands in for that: anything left in it
  // is an instance the page is still holding. And dispose() nulls every own
  // property of the instance, so a later show() reads from null and throws —
  // which is what happens if a closure keeps pointing at a disposed popover.
  class Popover {
    static live = new Set();
    constructor(el, options = {}) {
      this.el = el;
      this.options = options;
      this.tip = null;
      this.disposed = false;
      if (el) el._popover = this;
      Popover.live.add(this);
    }
    show() {
      if (this.disposed) {
        throw new TypeError("Cannot read properties of null (reading 'style')");
      }
      this.shown = true;
      // Bootstrap builds the tip and announces it. TreeRenderer wires the
      // card's own close button inside that handler, so without the event
      // that button is never reachable from a test.
      this.tip = document.createElement('div');
      const close = document.createElement('button');
      close.className = 'tree-info-close';
      this.tip.appendChild(close);
      for (const handler of this.el?._listeners?.get('shown.bs.popover') || []) handler();
    }
    hide() {
      this.shown = false;
      this.tip = null;
      // Bootstrap's hide() is animated unless told otherwise, and an animated
      // hide finishes well after it returns. Disposing before then leaves the
      // transition reading from an instance dispose() has already emptied,
      // which in a browser is `Cannot convert undefined or null to object`.
      this.hiding = this.options.animation !== false;
    }
    dispose() {
      if (this.hiding) {
        throw new Error('dispose() during an animated hide — the transition has not finished');
      }
      this.disposed = true;
      Popover.live.delete(this);
    }
  }
  globalThis.bootstrap = { Tooltip, Popover, Tab: class { constructor(el) { this.el = el; } show() {} } };
}

// ── Reset helper for tests ─────────────────────────────────────────

// Clears sessionStorage, resets the URL, and wipes the stub element cache
// between tests. Call from a `beforeEach` so each test sees a pristine
// environment.
export function resetShims() {
  globalThis.sessionStorage.clear();
  setLocation(DEFAULT_HREF);
  _stubElements.clear();
  globalThis.bootstrap?.Popover?.live?.clear();
  globalThis.document?._listeners?.clear();
}

export { setLocation };
