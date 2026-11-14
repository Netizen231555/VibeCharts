import { fail } from './errors.js';
import {
  isPlainObject,
  requireArray,
  requireBoolean,
  requireFinite,
  requireString,
  toJsonClone,
  uniqueBy,
} from './util.js';
import { normalizeAnchor } from './anchors.js';
import { DEFAULT_OPTIONS, mergeChartOptions } from '../core/options.js';
import { normalizeLayout } from './layout.js';

export const TEMPLATE_VERSION = 1;
export const TEMPLATE_KINDS = Object.freeze(['layout', 'theme', 'indicators', 'drawings', 'preferences']);

const THEME_FIELDS = {
  layout: new Set(['background', 'textColor', 'fontSize', 'fontFamily']),
  grid: new Set(['visible', 'color']),
  sessions: new Set(['visible', 'color']),
  crosshair: new Set(['visible', 'color', 'labelBackground']),
  timeScale: new Set(['visible', 'borderColor', 'textColor']),
  priceScale: new Set(['borderColor', 'textColor']),
};

export function validateTheme(theme, code = 'invalid-template') {
  if (!isPlainObject(theme)) fail(code, 'theme must be an object', { field: 'theme' });
  for (const [section, value] of Object.entries(theme)) {
    if (section === 'theme') continue;
    const fields = THEME_FIELDS[section];
    if (!fields || !isPlainObject(value)) fail(code, `Invalid visual theme section "${section}"`, { field: `theme.${section}` });
    for (const key of Object.keys(value)) {
      if (!fields.has(key)) fail(code, `Invalid visual theme field "${section}.${key}"`, { field: `theme.${section}.${key}` });
    }
  }
  const normalized = toJsonClone(theme, 'theme', { code });
  try { mergeChartOptions(DEFAULT_OPTIONS, normalized); } catch (error) {
    fail(code, `Invalid theme: ${error.message}`, { field: error.field ? `theme.${error.field}` : 'theme' });
  }
  return normalized;
}

function knownChart(chartIds, chartId, field) {
  if (!chartIds.includes(chartId)) {
    fail('invalid-template', `${field} references unknown chart "${chartId}"`, { field });
  }
}

function validateLayoutTemplate(doc, chartIds) {
  return { kind: doc.kind, version: doc.version, layout: normalizeLayout(doc.layout, chartIds, 'invalid-template') };
}

function validateThemeTemplate(doc) {
  return { kind: doc.kind, version: doc.version, theme: validateTheme(doc.theme) };
}

function validatePreferencesTemplate(doc) {
  if (!isPlainObject(doc.preferences)) fail('invalid-template', 'preferences template requires a preferences object', { field: 'preferences' });
  return { kind: doc.kind, version: doc.version, preferences: toJsonClone(doc.preferences, 'preferences', { code: 'invalid-template' }) };
}

function validateIndicatorsTemplate(doc, chartIds) {
  requireArray(doc.charts, 'charts', 'invalid-template');
  uniqueBy(doc.charts, 'charts', 'chartId', 'invalid-template');
  const charts = doc.charts.map((entry, chartIndex) => {
    const field = `charts[${chartIndex}]`;
    if (!isPlainObject(entry)) fail('invalid-template', `${field} must be an object`, { field });
    const chartId = requireString(entry.chartId, `${field}.chartId`, 'invalid-template');
    knownChart(chartIds, chartId, `${field}.chartId`);
    requireArray(entry.indicators, `${field}.indicators`, 'invalid-template');
    uniqueBy(entry.indicators, `${field}.indicators`, 'id', 'invalid-template');
    const indicators = entry.indicators.map((indicator, indicatorIndex) => {
      const indicatorField = `${field}.indicators[${indicatorIndex}]`;
      if (!isPlainObject(indicator)) fail('invalid-template', `${indicatorField} must be an object`, { field: indicatorField });
      const id = requireString(indicator.id, `${indicatorField}.id`, 'invalid-template');
      const type = requireString(indicator.type, `${indicatorField}.type`, 'invalid-template');
      const source = requireString(indicator.source, `${indicatorField}.source`, 'invalid-template');
      const pane = requireString(indicator.pane, `${indicatorField}.pane`, 'invalid-template');
      if (!isPlainObject(indicator.style)) {
        fail('invalid-template', `${indicatorField}.style must be an object`, { field: `${indicatorField}.style` });
      }
      if (!isPlainObject(indicator.parameters)) {
        fail('invalid-template', `${indicatorField}.parameters must be an object`, { field: `${indicatorField}.parameters` });
      }
      return {
        id,
        type,
        source,
        pane,
        style: toJsonClone(indicator.style, `${indicatorField}.style`, { code: 'invalid-template' }),
        parameters: toJsonClone(indicator.parameters, `${indicatorField}.parameters`, { code: 'invalid-template' }),
        ...(indicator.visible === undefined ? {} : { visible: requireBoolean(indicator.visible, `${indicatorField}.visible`, 'invalid-template') }),
        ...(indicator.locked === undefined ? {} : { locked: requireBoolean(indicator.locked, `${indicatorField}.locked`, 'invalid-template') }),
        ...(indicator.priceScaleId === undefined ? {} : { priceScaleId: requireString(indicator.priceScaleId, `${indicatorField}.priceScaleId`, 'invalid-template') }),
      };
    });
    return { chartId, indicators };
  });
  return { kind: doc.kind, version: doc.version, charts };
}

function validateDrawingsTemplate(doc, chartIds) {
  const chartId = requireString(doc.chartId, 'chartId', 'invalid-template');
  knownChart(chartIds, chartId, 'chartId');
  if (!isPlainObject(doc.document)) {
    fail('invalid-template', 'drawings template requires a capability document', { field: 'document' });
  }
  const document = toJsonClone(doc.document, 'document', { code: 'invalid-template' });
  requireArray(document.drawings, 'document.drawings', 'invalid-template');
  uniqueBy(document.drawings, 'document.drawings', 'id', 'invalid-template');
  const groupIds = new Set();
  if (document.groups !== undefined) {
    requireArray(document.groups, 'document.groups', 'invalid-template');
    uniqueBy(document.groups, 'document.groups', 'id', 'invalid-template');
    for (const group of document.groups) {
      if (!isPlainObject(group)) fail('invalid-template', 'document.groups entries must be objects', { field: 'document.groups' });
      const groupId = requireString(group.id, 'document.groups.id', 'invalid-template');
      groupIds.add(groupId);
      if (group.parentId !== undefined && group.parentId !== null) {
        requireString(group.parentId, 'document.groups.parentId', 'invalid-template');
      }
    }
    for (const group of document.groups) {
      if (group.parentId !== undefined && group.parentId !== null && !groupIds.has(group.parentId)) {
        fail('invalid-template', `document group "${group.id}" references missing parent "${group.parentId}"`, {
          field: 'document.groups',
        });
      }
    }
    for (const group of document.groups) {
      const seen = new Set([group.id]);
      let current = group;
      while (current.parentId !== undefined && current.parentId !== null) {
        if (seen.has(current.parentId)) {
          fail('invalid-template', `document groups contain a cycle at "${group.id}"`, { field: 'document.groups' });
        }
        seen.add(current.parentId);
        current = document.groups.find((entry) => entry.id === current.parentId);
      }
    }
  }
  document.drawings = document.drawings.map((drawing, index) => {
    const field = `document.drawings[${index}]`;
    if (!isPlainObject(drawing)) fail('invalid-template', `${field} must be an object`, { field });
    requireString(drawing.id, `${field}.id`, 'invalid-template');
    requireString(drawing.type, `${field}.type`, 'invalid-template');
    requireArray(drawing.anchors, `${field}.anchors`, 'invalid-template');
    const normalized = { ...drawing };
    normalized.anchors = drawing.anchors.map((anchor, anchorIndex) => {
      const anchorField = `${field}.anchors[${anchorIndex}]`;
      if (drawing.type === 'horizontalLevel' && isPlainObject(anchor) && anchor.anchorBarId === undefined) {
        return { ...anchor, price: requireFinite(anchor.price, `${anchorField}.price`, 'invalid-template') };
      }
      return {
        ...anchor, ...normalizeAnchor(anchor, anchorField, 'invalid-template'),
        ...(anchor.price === undefined ? {} : { price: requireFinite(anchor.price, `${anchorField}.price`, 'invalid-template') }),
      };
    });
    if (drawing.visible !== undefined) normalized.visible = requireBoolean(drawing.visible, `${field}.visible`, 'invalid-template');
    if (drawing.locked !== undefined) normalized.locked = requireBoolean(drawing.locked, `${field}.locked`, 'invalid-template');
    if (drawing.groupId !== undefined && drawing.groupId !== null) {
      requireString(drawing.groupId, `${field}.groupId`, 'invalid-template');
      if (!groupIds.has(drawing.groupId)) {
        fail('invalid-template', `${field}.groupId references missing group "${drawing.groupId}"`, { field: `${field}.groupId` });
      }
    }
    return normalized;
  });
  if (document.order !== undefined) {
    requireArray(document.order, 'document.order', 'invalid-template');
    const ids = document.drawings.map((drawing) => drawing.id).sort();
    const ordered = document.order.map((id, index) => requireString(id, `document.order[${index}]`, 'invalid-template')).sort();
    if (ids.length !== ordered.length || ids.some((id, index) => id !== ordered[index])) {
      fail('invalid-template', 'document.order must list every drawing once', { field: 'document.order' });
    }
  }
  return { kind: doc.kind, version: doc.version, chartId, document };
}

/**
 * Validates a whole template document before anything is applied. Unknown kinds,
 * unsupported versions and invalid required fields reject the document as a unit.
 */
export function validateTemplateDocument(doc, { chartIds }) {
  if (!isPlainObject(doc)) fail('invalid-template', 'template document must be an object', { field: 'document' });
  if (typeof doc.kind !== 'string' || doc.kind.length === 0) {
    fail('invalid-template', 'template document requires a string kind', { field: 'kind' });
  }
  if (!TEMPLATE_KINDS.includes(doc.kind)) {
    fail('unsupported-template-kind', `Unsupported template kind: ${doc.kind}`, { kind: doc.kind, field: 'kind' });
  }
  if (doc.version !== TEMPLATE_VERSION) {
    fail(
      'unsupported-template-version',
      `Unsupported ${doc.kind} template version: ${String(doc.version)}; supported: ${TEMPLATE_VERSION}`,
      { kind: doc.kind, field: 'version' },
    );
  }
  requireArray(chartIds, 'chartIds');
  if (doc.kind === 'layout') return validateLayoutTemplate(doc, chartIds);
  if (doc.kind === 'theme') return validateThemeTemplate(doc);
  if (doc.kind === 'preferences') return validatePreferencesTemplate(doc);
  if (doc.kind === 'indicators') return validateIndicatorsTemplate(doc, chartIds);
  return validateDrawingsTemplate(doc, chartIds);
}
