// Lifecycle and document effects of the drawing settings dialog, driven without a browser: a minimal element stub
// satisfies the DOM helpers the dialog uses (append, attributes, listeners, focus), and a real drawing store keeps
// the assertions about ownership, atomic applies and external deletion honest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingStore } from '../src/drawings/store.js';
import { createDrawingSettingsDialog } from '../src/ui/settings-dialog.js';

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.textContent = '';
    this.disabled = false;
    this.value = '';
    this.style = {};
    this.open = false;
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); child.parentNode = null; return child; }
  get firstChild() { return this.children[0] ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'open') this.open = true; }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(handler); }
  removeEventListener(type, handler) { const list = this.listeners.get(type) ?? []; const i = list.indexOf(handler); if (i >= 0) list.splice(i, 1); }
  emit(type, event = {}) { for (const handler of [...(this.listeners.get(type) ?? [])]) handler({ preventDefault: () => {}, stopPropagation: () => {}, target: this, ...event }); }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; this.emit('close'); }
  get length() { return this.children.length; }
}
const fakeDoc = { createElement: tag => new FakeElement(tag) };

const ADAPTER = {
  hasBinding: () => true,
  getVisibleRect: () => ({ x: 0, y: 0, width: 200, height: 200 }),
  resolveX: ({ anchorBarId }) => ({ b0: 0, b1: 1, b2: 2, b3: 3, b4: 4, b5: 5, b6: 6, b7: 7, b8: 8, b9: 9 })[anchorBarId] ?? null,
  logicalToX: logical => logical * 20,
  priceToY: price => 200 - price * 2,
  yToPrice: y => (200 - y) / 2,
  getPriceScaleMode: () => 'linear',
  getIndexCount: () => 10,
  getSlot: () => ({ barId: 'b0' }),
  indexOf: () => 0,
  getSeriesValues: () => null,
};
const CONTEXT = { instrumentId: 'T', interval: '1D', sourceId: 'src', view: 'main' };
const makeStore = () => createDrawingStore({ context: CONTEXT, geometry: ADAPTER, historyLimit: 10 });
const ANCHORS = [{ anchorBarId: 'b2', offset: 0, price: 20 }, { anchorBarId: 'b6', offset: 0, price: 60 }];
const addSegment = (store, style) => store.add({ paneId: 'main', scaleId: 'right', type: 'segment', anchors: ANCHORS, style }).id;

/** A dialog wired to a fake host; `find` walks the built tree like the dialog itself does. */
function mount(store, { sharedStyle = null } = {}) {
  const host = new FakeElement('div');
  const listeners = [];
  const interaction = { subscribe: (event, handler) => { listeners.push({ event, handler }); return () => { const i = listeners.findIndex(l => l.handler === handler); if (i >= 0) listeners.splice(i, 1); }; } };
  const announced = [];
  const dialog = createDrawingSettingsDialog({
    chart: { drawings: store, _options: { locale: 'en-US' } },
    doc: fakeDoc,
    host,
    interaction,
    announce: (text, options) => announced.push({ text, options }),
    sharedStyle,
  });
  const activate = (ids, source = 'pointer') => { for (const { event, handler } of [...listeners]) if (event === 'drawingActivate') handler({ drawingIds: ids, drawingId: ids[0], source }); };
  const root = () => host.children.find(child => child.tagName === 'DIALOG');
  const find = (pred, node = root()) => {
    if (!node) return null;
    if (pred(node)) return node;
    for (const child of node.children) { const found = find(pred, child); if (found) return found; }
    return null;
  };
  const byType = type => find(node => node.tagName === type.toUpperCase());
  return { dialog, activate, root, find, byType, announced, listenerCount: () => listeners.length, host };
}

test('activation opens one reusable dialog and destroy releases the subscription', () => {
  const store = makeStore();
  const id = addSegment(store);
  store.select(id);
  const h = mount(store);
  h.activate([id]);
  const first = h.root();
  assert.ok(first.open, 'dialog is open');
  h.activate([id]);
  assert.equal(h.root(), first, 'repeated activation reuses the dialog');
  assert.equal(h.listenerCount(), 1, 'one activation subscription');
  h.dialog.destroy();
  assert.equal(h.listenerCount(), 0, 'destroy unsubscribes');
  assert.equal(first.parentNode, null, 'destroy removes the dialog element');
});

test('apply drafts through the model marks individual style in one undo step', () => {
  const store = makeStore();
  const id = addSegment(store);
  store.select(id);
  const h = mount(store);
  h.activate([id]);
  const color = h.find(node => node.tagName === 'INPUT' && node.getAttribute('type') === 'color');
  color.value = '#c0392b';
  color.emit('input');
  h.find(node => node.tagName === 'FORM').emit('submit');
  assert.equal(store.get(id).style.color, '#c0392b');
  assert.equal(store.get(id).ownStyle, true, 'an individual edit marks ownership');
  store.undo();
  const restored = store.get(id);
  assert.equal(restored.style.color, '#4a9fd0');
  assert.equal(restored.ownStyle, false, 'ownership returns with the same undo step');
});

test('cancel drops the draft and closes without touching the document', () => {
  const store = makeStore();
  const id = addSegment(store);
  store.select(id);
  const h = mount(store);
  h.activate([id]);
  const before = store.get(id);
  const historyDepth = JSON.stringify(store.export().drawings); // creation only
  const color = h.find(node => node.tagName === 'INPUT' && node.getAttribute('type') === 'color');
  color.value = '#123456';
  color.emit('input');
  h.find(node => node.getAttribute?.('data-settings-action') === 'cancel').emit('click');
  assert.ok(!h.root().open, 'cancel closes');
  assert.deepEqual(store.get(id), before, 'document and history unchanged');
  assert.equal(JSON.stringify(store.export().drawings), historyDepth, 'no history entry was added');
});

test('an externally deleted drawing is reported and nothing is applied', () => {
  const store = makeStore();
  const a = addSegment(store);
  const b = addSegment(store, { color: '#111111' });
  store.selectMany([a, b]);
  const h = mount(store);
  h.activate([a, b]);
  store.remove(a);
  const color = h.find(node => node.tagName === 'INPUT' && node.getAttribute('type') === 'color');
  color.value = '#654321';
  color.emit('input');
  h.find(node => node.tagName === 'FORM').emit('submit');
  assert.equal(store.get(b).style.color, '#111111', 'the surviving drawing keeps its style');
  assert.ok(h.root().open, 'the dialog stays open on the error');
});

test('the host shared style is offered back only to individually styled drawings', () => {
  const store = makeStore();
  const individual = addSegment(store, {});
  const shared = { color: '#4a9fd0', width: 1, dash: 'solid', opacity: 1 };
  const h = mount(store, { sharedStyle: () => shared });
  store.select(individual);
  h.activate([individual]);
  // Without ownStyle there is no return-to-shared action.
  const backOf = () => h.find(node => node.getAttribute?.('data-settings-action') === 'use-shared');
  assert.equal(backOf(), null);
  store.update(individual, { style: { color: '#c0392b' }, ownStyle: true });
  h.activate([individual]);
  const back = backOf();
  assert.ok(back, 'the action appears once the drawing is individual');
  back.emit('click');
  const after = store.get(individual);
  assert.equal(after.style.color, '#4a9fd0');
  assert.equal(after.ownStyle, false);
});
