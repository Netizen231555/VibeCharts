import test from 'node:test';
import assert from 'node:assert/strict';
import { Timeline } from '../src/core/timeline.js';
import { Series } from '../src/core/series.js';

test('render snapshot follows updates, corrections, appends and timeline prepends', () => {
  const timeline = new Timeline();
  timeline.setTimeline([{ barId: 'a' }, { barId: 'b' }, { barId: 'c' }]);
  const series = new Series({ id: 'line', type: 'line', timeline });
  series.setData([{ barId: 'a', value: 1 }, { barId: 'c', value: 3 }]);
  assert.deepEqual(series._indexedPointsInRange(0, 2), [{ barId: 'a', value: 1, index: 0 }, { barId: 'c', value: 3, index: 2 }]);
  assert.deepEqual(series._indexedPointsInRange(1, 2), [{ barId: 'c', value: 3, index: 2 }]);
  series.correct({ barId: 'a', value: 2 });
  series.update({ barId: 'c', value: 4 });
  assert.deepEqual(series._indexedPointsInRange(0, 2), [{ barId: 'a', value: 2, index: 0 }, { barId: 'c', value: 4, index: 2 }]);
  timeline.prepend([{ barId: 'z' }]);
  assert.deepEqual(series._indexedPointsInRange(0, 3), [{ barId: 'a', value: 2, index: 1 }, { barId: 'c', value: 4, index: 3 }]);
  timeline.append([{ barId: 'd' }]);
  series.update({ barId: 'd', value: 5 });
  assert.deepEqual(series._indexedPointsInRange(2, 4), [{ barId: 'c', value: 4, index: 3 }, { barId: 'd', value: 5, index: 4 }]);
});
