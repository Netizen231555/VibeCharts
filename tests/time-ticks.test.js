import test from 'node:test'
import assert from 'node:assert/strict'
import { computeTimeTicks } from '../src/render/time-ticks.js'
import { drawCandles, drawHistogram } from '../src/render/series-renderers.js'

const MINUTE = 60_000

function timelineOf(times, { cache = true } = {}) {
  const timeline = {
    length: times.length,
    slotAt: (index) => ({ barId: `b${index}`, time: times[index] })
  }
  if (cache) timeline._timesBetween = (from, to) => times.slice(from, to + 1)
  return timeline
}

function minutesOnDayUtc(day, count, hour = 0) {
  const base = Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`)
  return Array.from({ length: count }, (_unused, index) => base + index * MINUTE)
}

test('minute ticks land on wall-clock boundaries from the cached and uncached timeline', () => {
  const times = minutesOnDayUtc('2026-01-02', 240)
  for (const cache of [true, false]) {
    const { step, ticks } = computeTimeTicks({
      timeline: timelineOf(times, { cache }),
      from: 0,
      to: 239,
      barSpacing: 1000 / 240,
      timeZone: 'Europe/Moscow'
    })
    assert.equal(step.size, 30)
    assert.deepEqual(ticks.map((tick) => tick.index), [30, 60, 90, 120, 150, 180, 210])
  }
})

test('a DST spring shift keeps one tick per wall-clock bucket', () => {
  const times = minutesOnDayUtc('2026-03-08', 241, 5)
  const { ticks } = computeTimeTicks({
    timeline: timelineOf(times),
    from: 0,
    to: 240,
    barSpacing: 1000 / 241,
    timeZone: 'America/New_York'
  })
  // Local 02:00 does not exist: the 01:30 tick (index 90) is followed by 03:00 (index 120).
  assert.deepEqual(ticks.map((tick) => tick.index), [30, 60, 90, 120, 150, 180, 210, 240])
})

test('unsorted host order keeps the exact scan', () => {
  const times = minutesOnDayUtc('2026-01-02', 240)
  times[10] = times[9]
  const { ticks } = computeTimeTicks({
    timeline: timelineOf(times),
    from: 0,
    to: 239,
    barSpacing: 1000 / 240,
    timeZone: 'UTC'
  })
  assert.deepEqual(ticks.map((tick) => tick.index), [30, 60, 90, 120, 150, 180, 210])
})

function countingContext() {
  const calls = { fillRect: 0, stroke: 0 }
  return {
    calls,
    fillRect: () => { calls.fillRect += 1 },
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => { calls.stroke += 1 },
    set strokeStyle(value) { this._strokeStyle = value },
    get strokeStyle() { return this._strokeStyle },
    set fillStyle(value) { this._fillStyle = value },
    get fillStyle() { return this._fillStyle },
    set lineWidth(value) { this._lineWidth = value },
    get lineWidth() { return this._lineWidth }
  }
}

const theme = { up: 'up', down: 'down', equal: 'equal', wickUp: 'wu', wickDown: 'wd', borderUp: 'bu', borderDown: 'bd' }

test('dense candles collapse to one shape per pixel column', () => {
  const points = Array.from({ length: 300 }, (_unused, index) => ({
    index,
    open: 10,
    high: 12,
    low: 8,
    close: index % 2 ? 11 : 9
  }))
  const ctx = countingContext()
  drawCandles(ctx, {
    points,
    xOf: (index) => index * 0.3,
    yOf: (value) => value,
    barSpacing: 0.3,
    options: { borderVisible: false, wickVisible: true },
    theme
  })
  // 300 bars at 0.3px collapse into 91 pixel columns, not 300 draw pairs.
  assert.equal(ctx.calls.fillRect, 91)
  assert.equal(ctx.calls.stroke, 91)
})

test('dense histograms keep one column per pixel and stay within the range', () => {
  const points = Array.from({ length: 200 }, (_unused, index) => ({ index, value: (index % 7) + 1 }))
  const ctx = countingContext()
  drawHistogram(ctx, {
    points,
    xOf: (index) => index * 0.25,
    yOf: (value) => -value,
    barSpacing: 0.25,
    options: {},
    theme,
    paneRect: { y: 0, height: 100 }
  })
  assert.equal(ctx.calls.fillRect, 51)
})
