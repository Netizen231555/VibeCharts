// Pointer gestures on drawings (move, handle move, Shift-drag clone) driven through the real router and store,
// without a DOM. Escape, pointer cancel and lost capture all reach the owner as `router.cancel(reason)`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingStore } from '../src/drawings/store.js';
import { createObjectOwner } from '../src/interaction/drawingGesture.js';
import { createRouter, CANCEL_REASONS, ROUTE } from '../src/interaction/routing.js';
import { translate } from '../src/interaction/messages.js';

const BARS = Array.from({ length: 40 }, (_, i) => ({ barId: `b${i}` }));
const geometry = {
  hasBinding: ({ paneId }) => paneId === 'main',
  getVisibleRect: () => ({ x: 0, y: 0, width: 400, height: 200 }),
  resolveX: anchor => {
    const index = BARS.findIndex(bar => bar.barId === anchor.anchorBarId);
    return index < 0 ? null : index + anchor.offset;
  },
  logicalToX: logical => logical * 10,
  priceToY: price => 200 - price * 2,
  getPriceScaleMode: () => 'linear',
  yToPrice: y => (200 - y) / 2,
  getIndexCount: () => BARS.length,
  getSlot: index => BARS[index] ?? null,
  indexOf: barId => BARS.findIndex(bar => bar.barId === barId),
  getSeriesValues: () => null,
};

function harness({ hostController, locale = 'en-US' } = {}) {
  const store = createDrawingStore({ context: { instrumentId: 'T', interval: '1D', sourceId: 'src', view: 'main' }, geometry, historyLimit: 20 });
  const messages = [];
  const errors = [];
  let renders = 0;
  const chart = {
    drawings: store,
    requestRender: () => { renders += 1; },
    _paneXContext: () => ({ kind: 'source' }),
    surface: {
      anchorToX: anchor => { const logical = geometry.resolveX(anchor); return logical === null ? null : logical * 10; },
      xToAnchor: () => null,
      xToLogical: x => x / 10,
      priceToY: price => geometry.priceToY(price),
      // A pointer above the pane resolves to no price, which makes the destination unavailable.
      yToPrice: y => (y < 0 ? Number.NaN : geometry.yToPrice(y)),
      getVisibleRect: () => geometry.getVisibleRect(),
    },
  };
  let primary = null;
  const env = {
    chart,
    store,
    getDrawing: id => { try { return store.get(id); } catch { return null; } },
    getSnap: () => ({ mode: 'free', threshold: 5, magnet: false }),
    locale: () => locale,
    tr: (key, params) => translate(locale, key, params),
    announce: (text, options) => messages.push({ text, error: options?.error === true }),
    reportError: error => errors.push(error.message),
    hostController,
    adoptStoreSelection: () => { primary = store.getSelection().at(-1) ?? null; },
    ensureSelected(hit) {
      if (!store.getSelection().includes(hit.drawingId)) { store.select(hit.drawingId); primary = hit.drawingId; }
    },
  };
  const router = createRouter();
  const press = (hit, point, event = {}) => {
    const owner = createObjectOwner(hit, point, event, env);
    router.begin(ROUTE.OBJECT, owner, { pointerId: 1, point });
    return owner;
  };
  const move = (point, event = {}) => router.move(point, { event });
  const release = (point, event = {}) => router.end(point, { event });
  return { store, messages, errors, router, press, move, release, primary: () => primary, renders: () => renders };
}

const segment = (a, b, extra = {}) => ({
  type: 'segment', paneId: 'main', scaleId: 'right',
  anchors: [{ anchorBarId: `b${a}`, offset: 0, price: 40 }, { anchorBarId: `b${b}`, offset: 0, price: 60 }], ...extra,
});
const body = (id, extra = {}) => ({ kind: 'drawing', drawingId: id, ...extra });
const handle = (id, anchorIndex) => ({ kind: 'handle', drawingId: id, anchorIndex });
// The drawing 'b2'..'b6' runs from x=20 to x=60; its middle is a body hit.
const START = { x: 40, y: 100 };

test('Shift at pointer down clones: a ghost follows, originals stay, release creates selected copies', () => {
  const t = harness();
  const a = t.store.add(segment(2, 6));
  t.press(body(a.id), START, { shiftKey: true });
  const before = t.store.export();
  t.move({ x: 100, y: 100 });
  assert.equal(t.store.clonePreview().length, 1, 'the ghost is shown');
  assert.deepEqual(t.store.export(), before, 'nothing is committed while dragging');
  assert.equal(t.store.layout(a.id).anchors[0].x, 20, 'the original stays in place');
  t.release({ x: 100, y: 100 });
  assert.equal(t.store.clonePreview(), null);
  assert.equal(t.store.list().length, 2);
  assert.deepEqual(t.store.get(a.id), before.drawings[0], 'the original is unchanged');
  const copy = t.store.list()[1];
  assert.equal(copy.anchors[0].anchorBarId, 'b8');
  assert.deepEqual(t.store.getSelection(), [copy.id]);
  assert.equal(t.primary(), copy.id);
  assert.deepEqual(t.messages.at(-1), { text: 'Copies created: 1', error: false });
  t.store.undo();
  assert.deepEqual(t.store.export(), before, 'one undo removes the copies');
});

test('without Shift the same body drag moves the drawing', () => {
  const t = harness();
  const a = t.store.add(segment(2, 6));
  t.press(body(a.id), START, {});
  t.move({ x: 100, y: 100 });
  assert.equal(t.store.clonePreview(), null, 'no ghost for a move');
  t.release({ x: 100, y: 100 });
  assert.equal(t.store.list().length, 1);
  assert.equal(t.store.get(a.id).anchors[0].anchorBarId, 'b8');
});

test('Escape, pointer cancel and lost capture create nothing and clear the ghost', () => {
  for (const reason of [CANCEL_REASONS.ESCAPE, CANCEL_REASONS.POINTER_CANCEL, CANCEL_REASONS.LOST_CAPTURE]) {
    const t = harness();
    const a = t.store.add(segment(2, 6));
    t.press(body(a.id), START, { shiftKey: true });
    const before = t.store.export();
    const historyBefore = t.store.canUndo();
    t.move({ x: 120, y: 80 });
    assert.equal(t.store.clonePreview().length, 1);
    t.router.cancel(reason);
    assert.equal(t.store.clonePreview(), null, reason);
    assert.deepEqual(t.store.export(), before, reason);
    assert.equal(t.store.canUndo(), historyBefore, reason);
    assert.equal(t.router.active, false);
    // A late pointer up after the cancel must not create anything either.
    t.release({ x: 120, y: 80 });
    assert.equal(t.store.list().length, 1, reason);
  }
});

test('a release without movement creates nothing', () => {
  const t = harness();
  const a = t.store.add(segment(2, 6));
  t.press(body(a.id), START, { shiftKey: true });
  const before = t.store.export();
  const result = t.release(START, { shiftKey: true });
  assert.equal(t.store.clonePreview(), null);
  assert.deepEqual(t.store.export(), before);
  assert.equal(t.messages.length, 0);
  assert.equal(result.handled !== false, true);
});

test('an unavailable destination creates nothing and is announced', () => {
  const t = harness();
  const a = t.store.add(segment(2, 6));
  t.press(body(a.id), START, { shiftKey: true });
  const before = t.store.export();
  t.move({ x: 100, y: 100 });
  t.move({ x: 100, y: -30 });
  assert.equal(t.store.clonePreview(), null, 'the ghost is not shown at an unresolvable position');
  t.release({ x: 100, y: -30 });
  assert.deepEqual(t.store.export(), before);
  assert.deepEqual(t.messages.at(-1), { text: translate('en-US', 'drawing.cloneUnavailable'), error: true });
});

test('Shift on a handle stays a handle move and never clones', () => {
  const t = harness();
  const a = t.store.add(segment(2, 6));
  t.press(handle(a.id, 1), { x: 60, y: 80 }, { shiftKey: true });
  t.move({ x: 120, y: 80 }, { shiftKey: true });
  assert.equal(t.store.clonePreview(), null);
  t.release({ x: 120, y: 80 }, { shiftKey: true });
  assert.equal(t.store.list().length, 1);
  const moved = t.store.get(a.id);
  assert.equal(moved.anchors[0].anchorBarId, 'b2');
  assert.equal(moved.anchors[1].anchorBarId, 'b12');
  // Shift also keeps the dragged end of a line on the other anchor's price.
  assert.equal(moved.anchors[1].price, moved.anchors[0].price);
});

test('a hit on a selected drawing clones the whole selection, an unselected hit only itself', () => {
  const t = harness();
  const a = t.store.add(segment(2, 6));
  const b = t.store.add(segment(10, 14));
  t.store.add(segment(20, 24));
  t.store.selectMany([a.id, b.id]);
  t.press(body(a.id), START, { shiftKey: true });
  t.move({ x: 80, y: 100 });
  assert.equal(t.store.clonePreview().length, 2);
  t.release({ x: 80, y: 100 });
  assert.equal(t.store.list().length, 5);
  assert.equal(t.store.getSelection().length, 2);

  const u = harness();
  const x = u.store.add(segment(2, 6));
  const y = u.store.add(segment(10, 14));
  u.store.select(y.id);
  u.press(body(x.id), START, { shiftKey: true });
  u.move({ x: 80, y: 100 });
  assert.equal(u.store.clonePreview().length, 1, 'the unselected hit becomes the selection and is the only clone');
  u.release({ x: 80, y: 100 });
  assert.equal(u.store.list().length, 3);
});

test('locked sources can be cloned but not moved', () => {
  const t = harness();
  const a = t.store.add(segment(2, 6, { locked: true }));
  t.press(body(a.id, { locked: true }), START, {});
  t.move({ x: 100, y: 100 });
  assert.equal(t.store.clonePreview(), null);
  const moveResult = t.release({ x: 100, y: 100 });
  assert.equal(t.store.get(a.id).anchors[0].anchorBarId, 'b2', 'a locked drawing does not move');
  assert.equal(moveResult.handled !== false, true);

  t.press(body(a.id, { locked: true }), START, { shiftKey: true });
  t.move({ x: 100, y: 100 });
  assert.equal(t.store.clonePreview().length, 1);
  t.release({ x: 100, y: 100 });
  assert.equal(t.store.list().length, 2);
  assert.equal(t.store.get(a.id).locked, true);
  assert.equal(t.store.list()[1].locked, true, 'the copy keeps the source flags');
});

test('a host drawing controller receives clone: true only for the Shift body gesture', () => {
  const requests = [];
  const hostController = { begin: request => { requests.push(request); return null; } };
  const t = harness({ hostController });
  const a = t.store.add(segment(2, 6));
  t.press(body(a.id), START, { shiftKey: true });
  t.router.cancel(CANCEL_REASONS.ESCAPE);
  t.press(body(a.id), START, {});
  t.router.cancel(CANCEL_REASONS.ESCAPE);
  t.press(handle(a.id, 0), START, { shiftKey: true });
  t.router.cancel(CANCEL_REASONS.ESCAPE);
  assert.deepEqual(requests.map(request => request.clone), [true, false, false]);
  assert.deepEqual(requests.map(request => request.anchorIndex), [null, null, 0]);
});
