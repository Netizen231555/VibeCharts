/**
 * Which ways exist to invoke each UI action without a pointer: a control in a
 * mounted part, a keyboard binding, or an entry of the chart context menu.
 *
 * The layout validator uses this to reject a layout that would leave an action
 * with no way to reach it. Only equivalents that really exist are listed:
 * actions without any (theme, table, follow, chart type, indicator, drawing
 * tools, clear, undo/redo, interval) need a control or an explicit removal.
 */

/** Control id → keyboard actions that must all be bound for the shortcut to count. */
export const KEYBOARD_EQUIVALENTS = Object.freeze({
  panLeft: ['panLeft'],
  panRight: ['panRight'],
  zoomIn: ['zoomIn'],
  zoomOut: ['zoomOut'],
  priceZoomIn: ['priceZoomIn'],
  priceZoomOut: ['priceZoomOut'],
  priceAuto: ['priceAuto'],
  fitContent: ['fitContent'],
  follow: ['follow'],
  logScale: ['toggleLogScale'],
  crosshair: ['toggleCrosshair'],
  hideDrawings: ['toggleDrawingsVisible'],
  lockDrawings: ['toggleDrawingsLocked'],
  // Arrow keys move the crosshair by one slot while it is active.
  crosshairPrev: ['toggleCrosshair', 'panLeft'],
  crosshairNext: ['toggleCrosshair', 'panRight'],
});

/** Control id → context menu item id. */
export const MENU_EQUIVALENTS = Object.freeze({
  fitContent: 'fitContent',
  scrollToRealTime: 'scrollToRealTime',
  priceAuto: 'priceAutoScale',
});

function boundKeys(interaction) {
  const keyboard = interaction && interaction.keyboard;
  if (!keyboard || typeof keyboard.getBindings !== 'function') return null;
  return keyboard.getBindings();
}

/**
 * @param {Array<{id:string,label:string,kind:string,action:string}>} controls flat control list of the toolbar model
 * @param {object|null} interaction the attached interaction handle, if any
 * @returns {Array<{id:string,label:string,kind:string,keyboard:string[]|null,menu:string|null}>}
 */
export function describeActionAccess(controls, interaction) {
  const bindings = boundKeys(interaction);
  const menuBound = bindings !== null && bindings.contextMenu !== null && bindings.contextMenu !== undefined;
  return controls.map((control) => {
    const keyboardActions = KEYBOARD_EQUIVALENTS[control.id] || null;
    const keyboard = keyboardActions && bindings !== null && keyboardActions.every((action) => bindings[action] !== null && bindings[action] !== undefined)
      ? keyboardActions.map((action) => bindings[action])
      : null;
    const menu = MENU_EQUIVALENTS[control.id] && menuBound ? MENU_EQUIVALENTS[control.id] : null;
    return { id: control.id, label: control.label, kind: control.kind, keyboard, menu };
  });
}
