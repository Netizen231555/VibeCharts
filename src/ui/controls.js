/**
 * Semantic toolbar model. Controls are buttons, toggles and selects with
 * explicit names; an unavailable action is disabled together with a reason and
 * never acts as a no-op.
 */
import { InteractionError } from '../interaction/errors.js';
import { t } from './messages.js';
import { DRAWING_TOOLS as LIBRARY_TOOLS } from '../drawings/tools.js';

export const CHART_TYPES = Object.freeze([
  { id: 'candles', labelKey: 'chartType.candles' },
  { id: 'bars', labelKey: 'chartType.bars' },
  { id: 'line', labelKey: 'chartType.line' },
]);

export const INDICATORS = Object.freeze([
  { id: 'sma20', label: 'SMA(20)' },
  { id: 'ema20', label: 'EMA(20)' },
]);

// A rail tool id IS the drawing library tool name, so arming needs no mapping. Order is the rail order;
// a change of `group` draws a separator between neighbouring tools.
const TOOL_GROUPS = Object.freeze({
  lines: ['segment', 'ray', 'line', 'horizontalLevel', 'horizontalRay', 'verticalLine', 'arrow', 'angle', 'polyline', 'brush', 'bezier'],
  channels: ['parallelChannel', 'regressionChannel', 'pitchfork', 'fibRetracement', 'fibExtension', 'fibFan', 'fibArcs', 'fibTimeZones'],
  shapes: ['rectangle', 'ellipse', 'triangle'],
  annotations: ['text', 'callout', 'flag', 'priceLabel', 'marker'],
  analysis: ['measure', 'anchoredVwap'],
});

export const DRAWING_TOOLS = Object.freeze(
  Object.entries(TOOL_GROUPS).flatMap(([group, ids]) => ids.map((id) => Object.freeze({ id, group, labelKey: `tool.${id}` }))),
);

// The rail must offer exactly what the library can draw: a tool added to or removed from the library fails here, not silently in the UI.
{
  const known = Object.keys(LIBRARY_TOOLS);
  const listed = DRAWING_TOOLS.map((entry) => entry.id);
  const unknown = listed.filter((id) => !known.includes(id));
  const missing = known.filter((id) => !listed.includes(id));
  if (unknown.length > 0 || missing.length > 0) {
    throw new InteractionError(`Drawing rail out of sync with the drawing library (unknown: ${unknown.join(', ') || '-'}; missing: ${missing.join(', ') || '-'})`, { code: 'INVALID_TOOLBAR', field: 'DRAWING_TOOLS' });
  }
}

const REASON_KEYS = Object.freeze([
  'chartType', 'indicator', 'drawing', 'clear', 'undo', 'redo', 'interval', 'navigation', 'theme', 'table',
  'logScale', 'logScalePercent', 'logScaleNone', 'drawingSnap', 'crosshair',
]);

/** Reasons are resolved per model build so they follow the chart locale at that moment. */
function reasonsFor(locale) {
  return Object.fromEntries(REASON_KEYS.map((key) => [key, t(locale, `reason.${key}`)]));
}

/** Host-supplied entries keep their own `label`; the built-in ones are translated. */
function labelOf(entry, locale) {
  return entry.label ?? t(locale, entry.labelKey);
}

/** Log toggle availability: the host hook, a scale to act on, and not a percent scale (its base is owned by the host). */
function logScaleAvailability(current, capabilities, REASONS) {
  if (capabilities.canLogScale === false) return { enabled: false, reason: REASONS.logScale };
  if (current.priceMode === 'percent') return { enabled: false, reason: REASONS.logScalePercent };
  if (current.priceMode === null) return { enabled: false, reason: REASONS.logScaleNone };
  return { enabled: true, reason: null };
}

export function createToolbarModel({ current = {}, capabilities = {}, locale = 'en-US' } = {}) {
  if (typeof current !== 'object' || current === null) {
    throw new InteractionError('Toolbar current state must be an object', { code: 'INVALID_TOOLBAR', field: 'current' });
  }
  const REASONS = reasonsFor(locale);
  const chartTypes = current.chartTypes || CHART_TYPES;
  const indicators = current.indicators || INDICATORS;
  const tools = current.tools || DRAWING_TOOLS;
  const intervals = current.intervals || [];

  return {
    groups: [
      {
        id: 'chartType',
        label: t(locale, 'group.chartType'),
        controls: chartTypes.map((entry) => ({
          id: `chartType:${entry.id}`,
          kind: 'toggle',
          label: labelOf(entry, locale),
          pressed: current.chartType === entry.id,
          enabled: capabilities.canChangeChartType !== false,
          reason: capabilities.canChangeChartType === false ? REASONS.chartType : null,
          action: 'chartType',
          value: entry.id,
        })),
      },
      {
        id: 'indicators',
        label: t(locale, 'group.indicators'),
        controls: indicators.map((entry) => ({
          id: `indicator:${entry.id}`,
          kind: 'toggle',
          label: labelOf(entry, locale),
          pressed: current.indicator === entry.id,
          enabled: capabilities.canSelectIndicator !== false,
          reason: capabilities.canSelectIndicator === false ? REASONS.indicator : null,
          action: 'indicator',
          value: entry.id,
        })),
      },
      {
        id: 'tools',
        label: t(locale, 'group.tools'),
        controls: tools.map((entry) => ({
          id: `tool:${entry.id}`,
          kind: 'toggle',
          label: labelOf(entry, locale),
          pressed: current.tool === entry.id,
          enabled: capabilities.canDraw !== false,
          reason: capabilities.canDraw === false ? REASONS.drawing : null,
          action: 'tool',
          value: entry.id,
          group: entry.group ?? null,
        })),
      },
      {
        id: 'actions',
        label: t(locale, 'group.actions'),
        controls: [
          {
            id: 'clearDrawings',
            kind: 'button',
            label: t(locale, 'control.clearDrawings'),
            enabled: capabilities.canClearDrawings !== false,
            reason: capabilities.canClearDrawings === false ? REASONS.clear : null,
            action: 'clearDrawings',
          },
          {
            id: 'undo',
            kind: 'button',
            label: t(locale, 'control.undo'),
            enabled: capabilities.canUndo !== false,
            reason: capabilities.canUndo === false ? REASONS.undo : null,
            action: 'undo',
          },
          {
            id: 'redo',
            kind: 'button',
            label: t(locale, 'control.redo'),
            enabled: capabilities.canRedo !== false,
            reason: capabilities.canRedo === false ? REASONS.redo : null,
            action: 'redo',
          },
          ...[
            'panLeft', 'panRight', 'zoomIn', 'zoomOut', 'priceZoomIn', 'priceZoomOut', 'crosshairPrev', 'crosshairNext',
          ].map((id) => ({
            id, kind: 'button', label: t(locale, `control.${id}`), action: id,
            enabled: capabilities.canKeyboardActions !== false,
            reason: capabilities.canKeyboardActions === false ? REASONS.navigation : null,
          })),
          {
            id: 'fitContent',
            kind: 'button',
            label: t(locale, 'control.fitContent'),
            enabled: capabilities.canNavigate !== false,
            reason: capabilities.canNavigate === false ? REASONS.navigation : null,
            action: 'fitContent',
          },
          {
            id: 'scrollToRealTime',
            kind: 'button',
            label: t(locale, 'control.scrollToRealTime'),
            enabled: capabilities.canNavigate !== false,
            reason: capabilities.canNavigate === false ? REASONS.navigation : null,
            action: 'scrollToRealTime',
          },
          {
            id: 'priceAuto',
            kind: 'button',
            label: t(locale, 'control.priceAuto'),
            enabled: capabilities.canPriceAuto !== false,
            reason: capabilities.canPriceAuto === false ? REASONS.navigation : null,
            action: 'priceAuto',
          },
          {
            id: 'follow',
            kind: 'toggle',
            label: t(locale, 'control.follow'),
            pressed: current.follow === true,
            enabled: capabilities.canNavigate !== false,
            reason: capabilities.canNavigate === false ? REASONS.navigation : null,
            action: 'follow',
          },
          {
            id: 'crosshair',
            kind: 'toggle',
            label: t(locale, 'control.crosshair'),
            pressed: current.crosshair === true,
            enabled: capabilities.canToggleCrosshair !== false,
            reason: capabilities.canToggleCrosshair === false ? REASONS.crosshair : null,
            action: 'crosshair',
          },
          {
            id: 'theme',
            kind: 'toggle',
            label: t(locale, 'control.theme'),
            pressed: current.theme === 'dark',
            enabled: capabilities.canToggleTheme !== false,
            reason: capabilities.canToggleTheme === false ? REASONS.theme : null,
            action: 'theme',
          },
          {
            id: 'accessibleTable',
            kind: 'toggle',
            label: t(locale, 'control.accessibleTable'),
            pressed: current.tableVisible !== false,
            enabled: capabilities.canShowTable !== false,
            reason: capabilities.canShowTable === false ? REASONS.table : null,
            action: 'accessibleTable',
          },
          {
            id: 'logScale',
            kind: 'toggle',
            label: t(locale, 'control.logScale'),
            pressed: current.priceMode === 'log',
            ...logScaleAvailability(current, capabilities, REASONS),
            action: 'logScale',
          },
          {
            id: 'drawingSnap',
            kind: 'toggle',
            label: t(locale, 'control.drawingSnap'),
            // Strong snapping (set from the drawing dialog) also counts as on; the toggle then turns it off.
            pressed: typeof current.snapMode === 'string' && current.snapMode !== 'free',
            enabled: capabilities.canDrawingSnap !== false,
            reason: capabilities.canDrawingSnap === false ? REASONS.drawingSnap : null,
            action: 'drawingSnap',
          },
        ],
      },
      ...(intervals.length > 0
        ? [
            {
              id: 'interval',
              label: t(locale, 'group.interval'),
              controls: [
                {
                  id: 'interval',
                  kind: 'select',
                  label: t(locale, 'control.interval'),
                  value: current.interval || '',
                  options: intervals.map((entry) => ({ value: entry.id, label: entry.label })),
                  enabled: capabilities.canChangeInterval !== false,
                  reason: capabilities.canChangeInterval === false ? REASONS.interval : null,
                  action: 'interval',
                },
              ],
            },
          ]
        : []),
    ],
  };
}

export function findControl(model, id) {
  for (const group of model.groups) {
    const control = group.controls.find((entry) => entry.id === id);
    if (control) return { control, group };
  }
  return null;
}

export function activateControl(model, id, { disabled = null, locale = 'en-US' } = {}) {
  const found = findControl(model, id);
  if (!found) throw new InteractionError(`Unknown control ${id}`, { code: 'UNKNOWN_CONTROL', field: 'id' });
  if (found.control.enabled === false || disabled === true) {
    return { ok: false, code: 'CONTROL_DISABLED', id, reason: found.control.reason || t(locale, 'ui.actionUnavailable') };
  }
  return { ok: true, id, action: found.control.action, value: found.control.value };
}
