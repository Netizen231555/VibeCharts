import test from 'node:test';
import assert from 'node:assert/strict';
import { drawSeries } from '../src/render/series-renderers.js';

function recordingContext() {
  const calls = [];
  const ctx = { calls };
  for (const method of ['beginPath', 'moveTo', 'lineTo', 'closePath', 'stroke', 'fill', 'fillRect', 'strokeRect']) {
    ctx[method] = (...args) => calls.push([method, ...args]);
  }
  return ctx;
}

const theme = {
  up: 'green', down: 'red', equal: 'gray', wickUp: 'green', wickDown: 'red',
  borderUp: 'green', borderDown: 'red', areaLine: 'blue', areaFill: 'lightblue',
  baselineAboveLine: 'green', baselineBelowLine: 'red',
  baselineAboveFill: 'lightgreen', baselineBelowFill: 'pink', volume: 'gray'
};
const values = [{ index: 0, value: 2 }, { index: 1, value: 3 }, { index: 2, value: 1 }];
const ohlc = [{ index: 0, open: 2, high: 4, low: 1, close: 3 }, { index: 1, open: 3, high: 4, low: 1, close: 2 }];

for (const type of ['line', 'area', 'baseline']) {
  test(`${type} draws value series through the requested coordinates`, () => {
    const ctx = recordingContext();
    drawSeries(ctx, {
      series: { type }, points: values, xOf: (x) => x * 10, yOf: (y) => y * 5,
      barSpacing: 10, options: { basePrice: 0 }, theme, paneRect: { y: 0, height: 100 }
    });
    assert.ok(ctx.calls.some(([name, x, y]) => name === 'lineTo' && x === 10 && y === 15));
    assert.ok(ctx.calls.some(([name]) => name === 'stroke'));
    if (type !== 'line') assert.ok(ctx.calls.some(([name]) => name === 'fill'));
  });
}

test('bars render high and low without entering the line renderer', () => {
  const ctx = recordingContext();
  drawSeries(ctx, {
    series: { type: 'bar' }, points: ohlc, xOf: (x) => x * 10, yOf: (y) => y * 5,
    barSpacing: 10, options: {}, theme, paneRect: { y: 0, height: 100 }
  });
  assert.ok(ctx.calls.some(([name, x, y]) => name === 'moveTo' && x === 0 && y === 20));
  assert.ok(ctx.calls.some(([name, x, y]) => name === 'lineTo' && x === 0 && y === 5));
  assert.equal(ctx.calls.filter(([name]) => name === 'stroke').length, 2);
});
