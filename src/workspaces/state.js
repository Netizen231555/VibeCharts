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
import { normalizeLayout } from './layout.js';
import { normalizeAnchor } from './anchors.js';
import { validateTreeNodes } from './tree.js';

export const STATE_VERSION = 2;
export const STATE_KIND = 'workspace-state';

function visibleRangeOf(raw, field) {
  if (raw === null || raw === undefined) return null;
  if (!isPlainObject(raw)) fail('invalid-state', `${field} must be an object or null`, { field });
  const from = normalizeAnchor(raw.from, `${field}.from`, 'invalid-state');
  const to = normalizeAnchor(raw.to, `${field}.to`, 'invalid-state');
  if (from.anchorBarId === to.anchorBarId && from.offset >= to.offset) {
    fail('invalid-state', `${field} must have an increasing range`, { field });
  }
  return { from, to };
}

function validateCharts(rawCharts) {
  requireArray(rawCharts, 'charts', 'invalid-state');
  uniqueBy(rawCharts, 'charts', 'id', 'invalid-state');
  return rawCharts.map((raw, index) => {
    const field = `charts[${index}]`;
    if (!isPlainObject(raw)) fail('invalid-state', `${field} must be an object`, { field });
    const id = requireString(raw.id, `${field}.id`, 'invalid-state');
    if (!isPlainObject(raw.chartState)) fail('invalid-state', `${field}.chartState must be an object`, { field: `${field}.chartState` });
    const chartState = toJsonClone(raw.chartState, `${field}.chartState`, { code: 'invalid-state' });
    if (chartState.visibleRange != null || chartState.crosshair != null) {
      fail('invalid-state', `${field}.chartState cannot contain logical viewport or crosshair coordinates`, { field: `${field}.chartState` });
    }
    const context =
      raw.context === null || raw.context === undefined
        ? null
        : toJsonClone(raw.context, `${field}.context`, { code: 'invalid-state' });
    const instrument =
      raw.instrument === null || raw.instrument === undefined
        ? null
        : toJsonClone(raw.instrument, `${field}.instrument`, { code: 'invalid-state' });
    let interval = null;
    if (raw.interval !== null && raw.interval !== undefined) {
      if (typeof raw.interval !== 'string' && typeof raw.interval !== 'number') {
        fail('invalid-state', `${field}.interval must be a string or number`, { field: `${field}.interval` });
      }
      interval = typeof raw.interval === 'number' ? requireFinite(raw.interval, `${field}.interval`, 'invalid-state') : raw.interval;
    }
    const settings = raw.settings === undefined ? {} : toJsonClone(raw.settings, `${field}.settings`, { code: 'invalid-state' });
    const drawings = raw.drawings === undefined ? [] : toJsonClone(raw.drawings, `${field}.drawings`, { code: 'invalid-state' });
    if (!Array.isArray(drawings)) fail('invalid-state', `${field}.drawings must be an array`, { field: `${field}.drawings` });
    return {
      id,
      chartState,
      context,
      instrument,
      interval,
      settings,
      visibleRange: visibleRangeOf(raw.visibleRange, `${field}.visibleRange`),
      drawings,
    };
  });
}

function validateSyncGroups(rawGroups, chartIds) {
  requireArray(rawGroups, 'syncGroups', 'invalid-state');
  uniqueBy(rawGroups, 'syncGroups', 'id', 'invalid-state');
  return rawGroups.map((raw, index) => {
    const field = `syncGroups[${index}]`;
    if (!isPlainObject(raw)) fail('invalid-state', `${field} must be an object`, { field });
    const charts = requireArray(raw.charts, `${field}.charts`, 'invalid-state').map((chartId, chartIndex) => {
      requireString(chartId, `${field}.charts[${chartIndex}]`, 'invalid-state');
      if (!chartIds.includes(chartId)) {
        fail('invalid-state', `${field}.charts references unknown chart "${chartId}"`, { field: `${field}.charts[${chartIndex}]` });
      }
      return chartId;
    });
    if (charts.length === 0) fail('invalid-state', `${field}.charts must not be empty`, { field: `${field}.charts` });
    if (new Set(charts).size !== charts.length) {
      fail('invalid-state', `${field}.charts contains duplicates`, { field: `${field}.charts` });
    }
    return {
      id: requireString(raw.id, `${field}.id`, 'invalid-state'),
      charts,
      range: requireBoolean(raw.range, `${field}.range`, 'invalid-state'),
      crosshair: requireBoolean(raw.crosshair, `${field}.crosshair`, 'invalid-state'),
      ...(raw.price === undefined ? {} : { price: requireBoolean(raw.price, `${field}.price`, 'invalid-state') }),
    };
  });
}

function validateComparisons(rawComparisons, chartIds) {
  requireArray(rawComparisons, 'comparisons', 'invalid-state');
  uniqueBy(rawComparisons, 'comparisons', 'id', 'invalid-state');
  return rawComparisons.map((raw, index) => {
    const field = `comparisons[${index}]`;
    if (!isPlainObject(raw)) fail('invalid-state', `${field} must be an object`, { field });
    const chartId = requireString(raw.chartId, `${field}.chartId`, 'invalid-state');
    if (!chartIds.includes(chartId)) fail('invalid-state', `${field}.chartId references unknown chart "${chartId}"`, { field: `${field}.chartId` });
    if (raw.mode !== 'percent' && raw.mode !== 'absolute') {
      fail('invalid-state', `${field}.mode must be "percent" or "absolute"`, { field: `${field}.mode` });
    }
    requireArray(raw.points, `${field}.points`, 'invalid-state');
    const sourceIds = new Set();
    const points = raw.points.map((point, pointIndex) => {
      const pointField = `${field}.points[${pointIndex}]`;
      if (!isPlainObject(point)) fail('invalid-state', `${pointField} must be an object`, { field: pointField });
      const sourceBarId = requireString(point.sourceBarId, `${pointField}.sourceBarId`, 'invalid-state');
      if (sourceIds.has(sourceBarId)) fail('invalid-state', `${field}.points contains duplicate source bar`, { field: `${pointField}.sourceBarId` });
      sourceIds.add(sourceBarId);
      return { sourceBarId, value: requireFinite(point.value, `${pointField}.value`, 'invalid-state') };
    });
    if (!isPlainObject(raw.mapping)) fail('invalid-state', `${field}.mapping must be an object`, { field: `${field}.mapping` });
    const mapping = {};
    for (const [sourceBarId, target] of Object.entries(raw.mapping)) {
      requireString(sourceBarId, `${field}.mapping key`, 'invalid-state');
      mapping[sourceBarId] = requireString(target, `${field}.mapping.${sourceBarId}`, 'invalid-state');
    }
    const baseSlot = raw.baseSlot === null || raw.baseSlot === undefined ? null : requireString(raw.baseSlot, `${field}.baseSlot`, 'invalid-state');
    if (raw.mode === 'percent' && !baseSlot) fail('invalid-state', `${field}.baseSlot is required for percent mode`, { field: `${field}.baseSlot` });
    return {
      id: requireString(raw.id, `${field}.id`, 'invalid-state'),
      chartId,
      name: raw.name === undefined ? null : requireString(raw.name, `${field}.name`, 'invalid-state'),
      mode: raw.mode,
      primary: raw.primary == null ? null : {
        seriesId: requireString(raw.primary.seriesId, `${field}.primary.seriesId`, 'invalid-state'),
        field: requireString(raw.primary.field, `${field}.primary.field`, 'invalid-state'),
      },
      ...(raw.primary == null ? {} : {
        primaryOriginalVisible: requireBoolean(raw.primaryOriginalVisible, `${field}.primaryOriginalVisible`, 'invalid-state'),
      }),
      instrument: raw.instrument === undefined ? null : toJsonClone(raw.instrument, `${field}.instrument`, { code: 'invalid-state' }),
      points,
      mapping,
      baseSlot,
      units: raw.units === undefined || raw.units === null ? null : requireString(raw.units, `${field}.units`, 'invalid-state'),
      currency: raw.currency === undefined || raw.currency === null ? null : requireString(raw.currency, `${field}.currency`, 'invalid-state'),
    };
  });
}

function validateMarkers(rawMarkers, chartIds) {
  requireArray(rawMarkers, 'markers', 'invalid-state');
  uniqueBy(rawMarkers, 'markers', 'chartId', 'invalid-state');
  return rawMarkers.map((entry, index) => {
    const field = `markers[${index}]`;
    if (!isPlainObject(entry)) fail('invalid-state', `${field} must be an object`, { field });
    const chartId = requireString(entry.chartId, `${field}.chartId`, 'invalid-state');
    if (!chartIds.includes(chartId)) fail('invalid-state', `${field}.chartId references unknown chart "${chartId}"`, { field: `${field}.chartId` });
    requireArray(entry.markers, `${field}.markers`, 'invalid-state');
    uniqueBy(entry.markers, `${field}.markers`, 'id', 'invalid-state');
    const markers = entry.markers.map((marker, markerIndex) => {
      const markerField = `${field}.markers[${markerIndex}]`;
      if (!isPlainObject(marker)) fail('invalid-state', `${markerField} must be an object`, { field: markerField });
      const normalized = {
        id: requireString(marker.id, `${markerField}.id`, 'invalid-state'),
        barId: requireString(marker.barId, `${markerField}.barId`, 'invalid-state'),
        text: requireString(marker.text, `${markerField}.text`, 'invalid-state', true),
      };
      if (marker.details !== undefined) normalized.details = requireString(marker.details, `${markerField}.details`, 'invalid-state', true);
      return normalized;
    });
    const result = { chartId, markers };
    if (entry.distance !== undefined) {
      if (!Number.isSafeInteger(entry.distance) || entry.distance < 0) {
        fail('invalid-state', `${field}.distance must be a non-negative integer`, { field: `${field}.distance` });
      }
      result.distance = entry.distance;
    }
    return result;
  });
}

/**
 * Validates a full workspace snapshot before any part of it is applied.
 * Any structural problem rejects the whole snapshot with the offending field.
 */
export function validateSnapshot(state) {
  if (!isPlainObject(state)) fail('invalid-state', 'workspace state must be an object', { field: 'state' });
  if (state.kind !== STATE_KIND) {
    fail('invalid-state', `workspace state kind must be "${STATE_KIND}"`, { field: 'kind' });
  }
  if (state.version !== STATE_VERSION) {
    fail('unsupported-state-version', `Unsupported workspace state version: ${String(state.version)}; supported: ${STATE_VERSION}`, {
      field: 'version',
    });
  }
  const charts = validateCharts(state.charts);
  const chartIds = charts.map((chart) => chart.id);
  const layout = normalizeLayout(state.layout, chartIds, 'invalid-state');
  const syncGroups = validateSyncGroups(state.syncGroups === undefined ? [] : state.syncGroups, chartIds);
  const treeInput = state.tree === undefined ? null : state.tree;
  let tree;
  if (treeInput === null) {
    tree = { nodes: [], focusedId: null };
  } else {
    if (!isPlainObject(treeInput)) fail('invalid-state', 'tree must be an object', { field: 'tree' });
    const nodes = validateTreeNodes(treeInput.nodes === undefined ? [] : treeInput.nodes, chartIds, 'invalid-state');
    const focusedId = treeInput.focusedId === null || treeInput.focusedId === undefined ? null : requireString(treeInput.focusedId, 'tree.focusedId', 'invalid-state');
    if (focusedId !== null && !nodes.some((node) => node.id === focusedId)) {
      fail('invalid-state', `tree.focusedId references missing node "${focusedId}"`, { field: 'tree.focusedId' });
    }
    tree = { nodes, focusedId };
  }
  const comparisons = validateComparisons(state.comparisons === undefined ? [] : state.comparisons, chartIds);
  const bases = new Map();
  for (const comparison of comparisons) {
    if (comparison.mode !== 'percent') continue;
    if (bases.has(comparison.chartId) && bases.get(comparison.chartId) !== comparison.baseSlot) {
      fail('invalid-state', 'Percentage comparisons on one chart must use the same base slot', { field: 'comparisons' });
    }
    bases.set(comparison.chartId, comparison.baseSlot);
  }
  const markers = validateMarkers(state.markers === undefined ? [] : state.markers, chartIds);
  const theme = state.theme === undefined ? {} : toJsonClone(state.theme, 'theme', { code: 'invalid-state' });
  if (!isPlainObject(theme)) fail('invalid-state', 'theme must be an object', { field: 'theme' });
  const preferences = state.preferences === undefined ? {} : toJsonClone(state.preferences, 'preferences', { code: 'invalid-state' });
  if (!isPlainObject(preferences)) fail('invalid-state', 'preferences must be an object', { field: 'preferences' });
  return {
    kind: STATE_KIND,
    version: STATE_VERSION,
    layout,
    theme,
    charts,
    syncGroups,
    tree,
    comparisons,
    markers,
    preferences,
  };
}
