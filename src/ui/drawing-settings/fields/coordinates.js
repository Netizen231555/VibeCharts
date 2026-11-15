// The anchors of a drawing: the bar an anchor sits on is fixed, its offset (in bars, fractions and negatives allowed)
// and its price are editable, for the coordinates the tool has.
import { DRAWING_TOOLS } from '../../../drawings/tools.js';
import { ALL_FAMILIES } from './helpers.js';
import { InteractionError } from '../../../interaction/errors.js';

export const owner = 'coordinates';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Checks `value` against the drawing it is meant for. `context` is `{ drawing, priceScaleMode }`. Errors name the
 * anchor index and the coordinate; the store stays the authority on the document itself.
 */
function validateAnchors(value, context) {
  const { drawing, priceScaleMode } = context;
  const spec = DRAWING_TOOLS[drawing.type].anchors;
  const fail = (message) => { throw new InteractionError(message, { code: 'INVALID_DRAWING_SETTING', field: 'anchors' }); };
  if (!Array.isArray(value) || value.length !== drawing.anchors.length) {
    fail(`needs ${drawing.anchors.length} anchors, got ${Array.isArray(value) ? value.length : typeof value}`);
  }
  const mode = typeof priceScaleMode === 'function' ? priceScaleMode(drawing.paneId, drawing.scaleId) : 'linear';
  return value.map((anchor, index) => {
    if (anchor === null || typeof anchor !== 'object') fail(`anchor ${index} must be an object`);
    const current = drawing.anchors[index];
    const result = {};
    if (spec.x) {
      if (anchor.anchorBarId !== undefined && anchor.anchorBarId !== current.anchorBarId) fail(`anchor ${index} anchorBarId is read-only`);
      if (!finite(anchor.offset)) fail(`anchor ${index} offset must be a finite number`);
      result.anchorBarId = current.anchorBarId;
      result.offset = anchor.offset;
    } else if (anchor.offset !== undefined || anchor.anchorBarId !== undefined) {
      fail(`anchor ${index} has no offset for ${drawing.type}`);
    }
    if (spec.price) {
      if (!finite(anchor.price)) fail(`anchor ${index} price must be a finite number`);
      if (mode === 'log' && !(anchor.price > 0)) fail(`anchor ${index} price must be greater than zero on a logarithmic scale`);
      result.price = anchor.price;
    } else if (anchor.price !== undefined) {
      fail(`anchor ${index} has no price for ${drawing.type}`);
    }
    return result;
  });
}

export const fields = [
  {
    id: 'anchors', tab: 'coordinates', group: 'anchors', order: 10, type: 'anchors', labelKey: 'drawingSettings.f.anchors',
    appliesTo: { families: ALL_FAMILIES }, multi: false,
    read: (drawing) => drawing.anchors.map((anchor) => ({ ...anchor })),
    patch: (value) => ({ anchors: value }),
    validate: validateAnchors,
  },
];
