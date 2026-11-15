/**
 * Describes the settings of a selection: tabs, groups and typed fields with current values, mixed and disabled
 * states. Pure and headless; a host can render any interface on it.
 */
import { InteractionError } from '../../interaction/errors.js';
import { DRAWING_TOOLS } from '../../drawings/tools.js';
import { t } from '../messages.js';
import { DRAWING_SETTINGS_TABS, fieldApplies } from './registry.js';
import { readField, equal } from './values.js';

function localizedLimits(field, locale) {
  const limits = field.limits;
  if (!limits) return undefined;
  if (!limits.options) return { ...limits };
  return { ...limits, options: limits.options.map((option) => ({ value: option.value, label: t(locale, option.labelKey) })) };
}

function reasonText(locale, result) {
  return result && typeof result === 'object' && result.reasonKey ? t(locale, result.reasonKey) : t(locale, 'drawingSettings.reason.locked');
}

/**
 * @param {{ registry: { list(): readonly object[] } }} model the field registry to read
 */
export function describeWith(registry, { drawings, locale, context = {} }) {
  if (!Array.isArray(drawings) || drawings.length === 0) {
    throw new InteractionError('drawings must be a non-empty array of drawings', { code: 'INVALID_DRAWING_SETTINGS_INPUT', field: 'drawings' });
  }
  const isLocked = typeof context.isLocked === 'function' ? context.isLocked : (drawing) => drawing.locked === true;
  const locked = drawings.some((drawing) => isLocked(drawing));
  const many = drawings.length > 1;
  const tabs = new Map(DRAWING_SETTINGS_TABS.map((id) => [id, { id, label: t(locale, `drawingSettings.tab.${id}`), groups: new Map() }]));

  for (const field of registry.list()) {
    if (many && !field.multi) continue;
    if (!drawings.every((drawing) => fieldApplies(field, drawing, DRAWING_TOOLS))) continue;
    if (field.visibleWhen && !drawings.every((drawing) => field.visibleWhen(drawing, context) !== false)) continue;
    const values = drawings.map((drawing) => readField(field, drawing));
    const mixed = values.some((value) => !equal(value, values[0]));
    let enabled = true;
    let reason = null;
    if (locked) {
      enabled = false;
      reason = t(locale, 'drawingSettings.reason.locked');
    } else if (field.enabledWhen) {
      for (const drawing of drawings) {
        const verdict = field.enabledWhen(drawing, context);
        if (verdict !== true && verdict !== undefined) {
          enabled = false;
          reason = reasonText(locale, verdict);
          break;
        }
      }
    }
    const entry = {
      id: field.id,
      type: field.type,
      label: t(locale, field.labelKey),
      value: mixed ? null : values[0],
      mixed,
      enabled,
      reason,
      limits: localizedLimits(field, locale),
    };
    if (field.type === 'anchors') {
      const drawing = drawings[0];
      const spec = DRAWING_TOOLS[drawing.type].anchors;
      const mode = typeof context.priceScaleMode === 'function' ? context.priceScaleMode(drawing.paneId, drawing.scaleId) : 'linear';
      entry.limits = { offset: Boolean(spec.x), price: Boolean(spec.price), positivePrice: mode === 'log' };
    }
    const tab = tabs.get(field.tab);
    if (!tab.groups.has(field.group)) {
      tab.groups.set(field.group, { id: field.group, label: t(locale, `drawingSettings.group.${field.group}`), fields: [] });
    }
    tab.groups.get(field.group).fields.push(entry);
  }

  return {
    ids: drawings.map((drawing) => drawing.id),
    types: [...new Set(drawings.map((drawing) => drawing.type))],
    count: drawings.length,
    locked,
    tabs: DRAWING_SETTINGS_TABS.map((id) => tabs.get(id)).filter((tab) => tab.groups.size > 0)
      .map((tab) => ({ id: tab.id, label: tab.label, groups: [...tab.groups.values()] })),
  };
}
