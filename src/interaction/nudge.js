/**
 * Keyboard nudging of the selected drawings: the complete move is planned before anything is written, so a
 * selection is either moved as a whole or refused with a reason and left untouched. Nothing is clamped.
 */

export const NUDGE_ACTIONS = Object.freeze({
  nudgeLeft: { axis: 'x', sign: -1, amount: 1 },
  nudgeRight: { axis: 'x', sign: 1, amount: 1 },
  nudgeUp: { axis: 'y', sign: 1, amount: 1 },
  nudgeDown: { axis: 'y', sign: -1, amount: 1 },
  nudgeLeftTen: { axis: 'x', sign: -1, amount: 10 },
  nudgeRightTen: { axis: 'x', sign: 1, amount: 10 },
  nudgeUpTen: { axis: 'y', sign: 1, amount: 10 },
  nudgeDownTen: { axis: 'y', sign: -1, amount: 10 },
});

function isLocked(store, drawing) {
  if (drawing.locked) return true;
  const seen = new Set();
  for (let id = drawing.groupId; id !== null && id !== undefined && !seen.has(id);) {
    seen.add(id);
    const group = store.getGroup(id);
    if (group.locked) return true;
    id = group.parentId;
  }
  return false;
}

// The price step belongs to the series drawn on the drawing's scale. Series that disagree give no step: moving by
// one of them would be a guess.
function scalePriceStep(chart, binding) {
  const steps = new Set();
  for (const entry of chart.series.list()) {
    if (entry.paneId !== binding.paneId || entry.priceScaleId !== binding.scaleId) continue;
    const step = chart.series(entry.id).metadata()?.priceStep;
    if (typeof step === 'number' && step > 0) steps.add(step);
  }
  return steps.size === 1 ? [...steps][0] : null;
}

/**
 * @returns {{ updates: Array<{id: string, patch: object}> } | { refusal: string, detail?: string }}
 */
export function planNudge({ chart, store, adapter, ids, action }) {
  const { axis, sign, amount } = NUDGE_ACTIONS[action];
  const surface = chart.surface;
  const drawings = ids.map(id => store.get(id));
  if (drawings.some(drawing => isLocked(store, drawing))) return { refusal: 'locked' };
  const updates = [];
  const steps = new Map();
  for (const drawing of drawings) {
    const binding = { paneId: drawing.paneId, scaleId: drawing.scaleId };
    let step = null;
    if (axis === 'y') {
      const key = `${binding.paneId}\u0000${binding.scaleId}`;
      if (!steps.has(key)) steps.set(key, scalePriceStep(chart, binding));
      step = steps.get(key);
    }
    const movable = drawing.anchors.some(anchor => (axis === 'x' ? anchor.anchorBarId !== undefined : anchor.price !== undefined));
    if (!movable) return { refusal: 'noAnchor' };
    if (axis === 'y' && step === null) return { refusal: 'noStep' };
    const count = axis === 'x' ? adapter.indexScaleFor(drawing.paneId).length : 0;
    const anchors = [];
    for (const anchor of drawing.anchors) {
      if (axis === 'x') {
        if (anchor.anchorBarId === undefined) { anchors.push(anchor); continue; }
        const moved = { ...anchor, offset: anchor.offset + sign * amount };
        const logical = surface.resolveAnchor(moved, { paneId: drawing.paneId });
        if (typeof logical !== 'number' || logical < 0 || logical > count - 1) return { refusal: 'outOfData' };
        anchors.push(moved);
      } else {
        if (anchor.price === undefined) { anchors.push(anchor); continue; }
        // Twelve significant digits absorb the binary error of adding a decimal step without rounding to the step.
        const price = Number((anchor.price + sign * amount * step).toPrecision(12));
        let y;
        try { y = surface.priceToY(price, binding); } catch { y = null; }
        if (!Number.isFinite(y)) return { refusal: 'invalid' };
        anchors.push({ ...anchor, price });
      }
    }
    updates.push({ id: drawing.id, patch: { anchors } });
  }
  return { updates };
}
