/**
 * Public entry point for the interaction layer.
 *
 * `attachInteraction(chart, options)` binds DOM input to a chart built against
 * the documented core API. The pure state machines are exported separately so
 * hosts and tests can drive them without a DOM.
 */
export { attachInteraction, DEFAULT_INSTRUCTIONS, MENU_TARGET_KINDS, CANCEL_REASONS } from './attachInteraction.js';
export { resolveInteractionAdapter, normalizeLayout } from './adapter.js';
export { createRouter, routePointerDown, ROUTE } from './routing.js';
export { hitTest, hitTestDrawings, hitTestAxes, paneAtPoint, resolveDrawing, normalizeHitRadius, MIN_HIT_RADIUS, drawingTypeFamily } from './hittest.js';
export {
  computeCrosshair,
  createCrosshairController,
  buildReadout,
  emptyPayload,
  normalizeSeriesValues,
} from './crosshair.js';
export { createNavigation } from './navigation.js';
export { createGestureRecognizer } from './gestures.js';
export {
  createKeyboard,
  createCrosshairNavigation,
  normalizeChord,
  chordFromEvent,
  isEditableTarget,
  DEFAULT_BINDINGS,
  actionLabel,
  ABSENT_TEXT,
} from './keyboard.js';
export { createPaneLayout } from './panes.js';
export { createContextMenu, buildMenuItems, MENU_ACTION_IDS } from './menu.js';
export {
  buildAccessibleRows,
  buildTableModel,
  createStatusModel,
  createAnnouncer,
  formatTimestamp,
  formatSessionDate,
  ABSENT,
} from './a11y.js';
export {
  createDerivedViewAccessibility,
  normalizeDerivedView,
  describeParameters,
  DERIVED_VIEW_KINDS,
} from './derived.js';
export { InteractionError } from './errors.js';
export { isFiniteNumber } from './geometry.js';
