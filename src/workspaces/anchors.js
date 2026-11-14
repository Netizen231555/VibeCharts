import { fail } from './errors.js';
import { requireFinite } from './util.js';

/**
 * A horizontal anchor is `{ anchorBarId, offset }`: offset is a finite fractional
 * number of index positions relative to the bar identified by `anchorBarId`.
 * The same representation covers positions between bars and outside history.
 */
export function normalizeAnchor(anchor, field = 'anchor', code = 'invalid-anchor') {
  if (anchor === null || typeof anchor !== 'object' || Array.isArray(anchor)) {
    fail(code, `${field} must be an object with anchorBarId and offset`, { field });
  }
  if (typeof anchor.anchorBarId !== 'string' || anchor.anchorBarId.length === 0) {
    fail(code, `${field}.anchorBarId must be a non-empty string`, { field: `${field}.anchorBarId` });
  }
  const offset = requireFinite(anchor.offset, `${field}.offset`, code);
  return { anchorBarId: anchor.anchorBarId, offset: offset === 0 ? 0 : offset };
}

export function sameAnchor(a, b) {
  return Boolean(a && b) && a.anchorBarId === b.anchorBarId && a.offset === b.offset;
}

/** Validates the index-scale surface of the chart adapter and returns its slots. */
export function readScale(scale, field = 'chart.indexScale()') {
  if (!scale || typeof scale !== 'object') {
    fail('chart-adapter', `${field} must return an index scale object`, { field: 'chart.indexScale' });
  }
  for (const method of ['barIdToIndex', 'indexToBarId', 'slots', 'getVisibleRange', 'setVisibleRange']) {
    if (typeof scale[method] !== 'function') {
      fail('chart-adapter', `${field}.${method} must be a function`, { field: `chart.indexScale.${method}` });
    }
  }
  const slots = scale.slots();
  if (!Array.isArray(slots)) {
    fail('chart-adapter', `${field}.slots() must return an array`, { field: 'chart.indexScale.slots' });
  }
  slots.forEach((slot, index) => {
    if (!slot || typeof slot.barId !== 'string' || slot.barId.length === 0) {
      fail('chart-adapter', `${field}.slots()[${index}].barId must be a non-empty string`, {
        field: `chart.indexScale.slots[${index}].barId`,
      });
    }
  });
  return { scale, slots };
}

export function indexOfBar(scale, barId) {
  const index = scale.barIdToIndex(barId);
  return Number.isSafeInteger(index) && index >= 0 ? index : null;
}

export function barIdAtIndex(scale, index) {
  const barId = scale.indexToBarId(index);
  return typeof barId === 'string' && barId.length > 0 ? barId : null;
}

/**
 * Converts a free logical x coordinate to a real-bar anchor plus fractional offset.
 * Returns null when the timeline has no slots; it never invents a bar.
 */
export function anchorFromLogical(scale, logical, field = 'logical') {
  const { slots } = readScale(scale);
  if (slots.length === 0) return null;
  const x = requireFinite(logical, field);
  const last = slots.length - 1;
  let anchorIndex;
  let offset;
  if (x < 0) {
    anchorIndex = 0;
    offset = x;
  } else if (x > last) {
    anchorIndex = last;
    offset = x - last;
  } else {
    anchorIndex = Math.floor(x);
    offset = x - anchorIndex;
  }
  const anchorBarId = barIdAtIndex(scale, anchorIndex);
  if (anchorBarId === null) return null;
  return { anchorBarId, offset: offset === 0 ? 0 : offset };
}

/** Returns the logical x of an anchor, or null when its bar is unknown. */
export function logicalFromAnchor(scale, anchor) {
  const index = indexOfBar(scale, anchor.anchorBarId);
  return index === null ? null : index + anchor.offset;
}

/**
 * Resolves an anchor against the live timeline. An unknown anchor bar stays
 * unresolved and is reported with its original identity and offset.
 */
export function anchorStatus(scale, anchor) {
  const index = indexOfBar(scale, anchor.anchorBarId);
  if (index === null) {
    return {
      resolved: false,
      reason: 'missing-bar',
      anchorBarId: anchor.anchorBarId,
      offset: anchor.offset,
    };
  }
  return {
    resolved: true,
    anchorBarId: anchor.anchorBarId,
    offset: anchor.offset,
    index,
    x: index + anchor.offset,
  };
}

export function anchorKey(anchor) {
  return `${anchor.anchorBarId}\u0000${String(anchor.offset)}`;
}
