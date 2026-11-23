// Empty-plot gestures: pointer jitter is a click (it clears the drawing selection and never pans the chart), and
// only real movement pans, with the whole displacement from the press point applied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPanOwner, CLICK_SLOP } from '../src/interaction/panGesture.js';

function harness(start = { x: 100, y: 100 }) {
  const pans = [];
  let cleared = 0;
  const owner = createPanOwner({
    paneId: 'main',
    startPoint: start,
    pan: (dx, dy) => pans.push([dx, dy]),
    clearSelection: () => { cleared += 1; },
  });
  return { owner, pans, cleared: () => cleared };
}

test('a click with pointer jitter under the slop neither pans nor counts as a drag', () => {
  const { owner, pans, cleared } = harness();
  owner.move({ x: 101, y: 100 });
  owner.move({ x: 102, y: 101 });
  owner.move({ x: 100 + CLICK_SLOP, y: 100 });
  assert.deepEqual(pans, []);
  assert.deepEqual(owner.end(), { paneId: 'main', moved: false });
  assert.equal(cleared(), 1, 'the click clears the selection');
});

test('crossing the slop pans by the full displacement from the press point, then incrementally', () => {
  const { owner, pans, cleared } = harness();
  owner.move({ x: 102, y: 100 });
  owner.move({ x: 110, y: 100 });
  assert.deepEqual(pans, [[10, 0]], 'the slop is not lost: the whole 10px applies at once');
  owner.move({ x: 116, y: 104 });
  assert.deepEqual(pans, [[10, 0], [6, 4]]);
  assert.deepEqual(owner.end(), { paneId: 'main', moved: true });
  assert.equal(cleared(), 0, 'a drag keeps the selection');
});

test('a drag never pans backwards across the slop and a cancelled gesture clears nothing', () => {
  const { owner, pans, cleared } = harness();
  owner.move({ x: 100, y: 104 });
  assert.deepEqual(pans, [[0, 4]]);
  owner.move({ x: 100, y: 101 });
  assert.deepEqual(pans, [[0, 4], [0, -3]]);
  owner.cancel();
  assert.equal(cleared(), 0);
});
