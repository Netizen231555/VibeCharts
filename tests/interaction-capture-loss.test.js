import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter, handleCaptureLoss } from '../src/interaction/routing.js';

test('lost capture immediately before pointerup commits the drag instead of cancelling it', () => {
  const calls = [];
  const router = createRouter();
  router.begin('object', { end: point => calls.push(['commit', point.x]), cancel: reason => calls.push(['cancel', reason]) }, { pointerId: 1 });
  let deferred;
  handleCaptureLoss({ buttons: 0, captureId: router.capture.captureId, currentCaptureId: () => router.capture?.captureId ?? null,
    cancel: () => router.cancel('lost-capture'), schedule: fn => { deferred = fn; } });
  router.end({ x: 260, y: 0 });
  deferred();
  assert.deepEqual(calls, [['commit', 260]]);
});

test('genuine lost capture cancels, without cancelling a subsequent gesture', () => {
  const calls = [];
  const router = createRouter();
  const owner = { end() {}, cancel: reason => calls.push(reason) };
  let deferred;
  router.begin('object', owner, { pointerId: 1 });
  handleCaptureLoss({ buttons: 0, captureId: router.capture.captureId, currentCaptureId: () => router.capture?.captureId ?? null,
    cancel: () => router.cancel('lost-capture'), schedule: fn => { deferred = fn; } });
  deferred();
  assert.deepEqual(calls, ['lost-capture']);
  router.begin('object', owner, { pointerId: 1 });
  const old = router.capture.captureId;
  handleCaptureLoss({ buttons: 0, captureId: old, currentCaptureId: () => router.capture?.captureId ?? null,
    cancel: () => router.cancel('lost-capture'), schedule: fn => { deferred = fn; } });
  router.end({ x: 0, y: 0 });
  router.begin('object', owner, { pointerId: 1 });
  deferred();
  assert.equal(router.active, true);
  handleCaptureLoss({ buttons: 1, captureId: router.capture.captureId, currentCaptureId: () => router.capture?.captureId ?? null,
    cancel: () => router.cancel('lost-capture'), schedule: () => assert.fail('must cancel immediately') });
  assert.deepEqual(calls, ['lost-capture', 'lost-capture']);
});
