import { fail } from './errors.js';
import { isPlainObject, requireArray, requireBoolean, requireString, hasOwn } from './util.js';
import {
  anchorFromLogical,
  indexOfBar,
  logicalFromAnchor,
  normalizeAnchor,
  readScale,
} from './anchors.js';

const pairKey = (from, to) => `${from}\u0000${to}`;

function instrumentPriceIdentity(instrument) {
  if (!isPlainObject(instrument)) return null;
  const currency = instrument.currency;
  const unit = instrument.priceUnit ?? instrument.unit;
  const scale = instrument.priceScale ?? 'linear';
  if (typeof currency !== 'string' || !currency || typeof unit !== 'string' || !unit) return null;
  return `${currency}\u0000${unit}\u0000${scale}`;
}

function normalizeGroup(group, index, workspace) {
  const field = `groups[${index}]`;
  if (!isPlainObject(group)) fail('invalid-sync-config', `${field} must be an object`, { field });
  const id = requireString(group.id, `${field}.id`, 'invalid-sync-config');
  requireArray(group.charts, `${field}.charts`, 'invalid-sync-config');
  if (group.charts.length === 0) fail('invalid-sync-config', `${field}.charts must not be empty`, { field: `${field}.charts` });
  const seen = new Set();
  const charts = group.charts.map((chartId, chartIndex) => {
    const chartField = `${field}.charts[${chartIndex}]`;
    requireString(chartId, chartField, 'invalid-sync-config');
    if (seen.has(chartId)) fail('invalid-sync-config', `${field}.charts contains duplicate "${chartId}"`, { field: chartField });
    seen.add(chartId);
    if (!workspace.getChart(chartId)) {
      fail('invalid-sync-config', `${field}.charts references unknown chart "${chartId}"`, { field: chartField });
    }
    return chartId;
  });
  return {
    id,
    charts,
    range: group.range === undefined ? true : requireBoolean(group.range, `${field}.range`, 'invalid-sync-config'),
    crosshair: group.crosshair === undefined ? true : requireBoolean(group.crosshair, `${field}.crosshair`, 'invalid-sync-config'),
    price: group.price === undefined ? false : requireBoolean(group.price, `${field}.price`, 'invalid-sync-config'),
  };
}

function normalizeMapping(mapping, index, workspace) {
  const field = `mappings[${index}]`;
  if (!isPlainObject(mapping)) fail('invalid-sync-config', `${field} must be an object`, { field });
  const from = requireString(mapping.from, `${field}.from`, 'invalid-sync-config');
  const to = requireString(mapping.to, `${field}.to`, 'invalid-sync-config');
  if (from === to) fail('invalid-sync-config', `${field} must connect two different charts`, { field });
  if (!workspace.getChart(from)) fail('invalid-sync-config', `${field}.from references unknown chart "${from}"`, { field: `${field}.from` });
  if (!workspace.getChart(to)) fail('invalid-sync-config', `${field}.to references unknown chart "${to}"`, { field: `${field}.to` });

  const result = { from, to };
  let kindCount = 0;
  if (mapping.bars !== undefined) {
    if (!isPlainObject(mapping.bars)) fail('invalid-sync-config', `${field}.bars must be an object`, { field: `${field}.bars` });
    const bars = {};
    for (const [sourceBarId, targetBarId] of Object.entries(mapping.bars)) {
      if (!sourceBarId) fail('invalid-sync-config', `${field}.bars has an empty source bar id`, { field: `${field}.bars` });
      requireString(targetBarId, `${field}.bars["${sourceBarId}"]`, 'invalid-sync-config');
      bars[sourceBarId] = targetBarId;
    }
    if (Object.keys(bars).length === 0) fail('invalid-sync-config', `${field}.bars must not be empty`, { field: `${field}.bars` });
    result.bars = bars;
    kindCount += 1;
  }
  if (mapping.timestamps !== undefined) {
    requireBoolean(mapping.timestamps, `${field}.timestamps`, 'invalid-sync-config');
    if (mapping.timestamps) {
      result.timestamps = true;
      kindCount += 1;
    }
  }
  if (mapping.derived !== undefined) {
    requireBoolean(mapping.derived, `${field}.derived`, 'invalid-sync-config');
    if (mapping.derived) {
      result.derived = true;
      kindCount += 1;
    }
  }
  if (mapping.anchors !== undefined) {
    requireArray(mapping.anchors, `${field}.anchors`, 'invalid-sync-config');
    if (mapping.anchors.length === 0) fail('invalid-sync-config', `${field}.anchors must not be empty`, { field: `${field}.anchors` });
    result.anchors = mapping.anchors.map((entry, entryIndex) => {
      const entryField = `${field}.anchors[${entryIndex}]`;
      if (!isPlainObject(entry)) fail('invalid-sync-config', `${entryField} must be an object`, { field: entryField });
      return {
        from: normalizeAnchor(entry.from, `${entryField}.from`, 'invalid-sync-config'),
        to: normalizeAnchor(entry.to, `${entryField}.to`, 'invalid-sync-config'),
      };
    });
    kindCount += 1;
  }
  if (mapping.anchorDelta !== undefined) {
    const deltaField = `${field}.anchorDelta`;
    if (!isPlainObject(mapping.anchorDelta)) fail('invalid-sync-config', `${deltaField} must be an object`, { field: deltaField });
    result.anchorDelta = {
      fromAnchorBarId: requireString(mapping.anchorDelta.fromAnchorBarId, `${deltaField}.fromAnchorBarId`, 'invalid-sync-config'),
      toAnchorBarId: requireString(mapping.anchorDelta.toAnchorBarId, `${deltaField}.toAnchorBarId`, 'invalid-sync-config'),
      delta: normalizeAnchor(
        { anchorBarId: mapping.anchorDelta.fromAnchorBarId, offset: mapping.anchorDelta.delta },
        `${deltaField}.delta`,
        'invalid-sync-config',
      ).offset,
    };
    kindCount += 1;
  }
  if (kindCount === 0) {
    fail('invalid-sync-config', `${field} provides no explicit mapping`, { field });
  }
  return result;
}

/**
 * Explicit range/crosshair synchronisation for a workspace. Coordinates travel as
 * `{ anchorBarId, offset }`; raw indexes and pixels are never exchanged.
 */
export function createSyncController(workspace, config = {}) {
  if (!workspace || typeof workspace.getChart !== 'function') fail('invalid-sync-config', 'workspace is required', { field: 'workspace' });
  if (!isPlainObject(config)) fail('invalid-sync-config', 'sync config must be an object', { field: 'config' });
  const groupList = config.groups === undefined ? [] : requireArray(config.groups, 'config.groups', 'invalid-sync-config');
  const mappingList = config.mappings === undefined ? [] : requireArray(config.mappings, 'config.mappings', 'invalid-sync-config');

  const groups = groupList.map((group, index) => normalizeGroup(group, index, workspace));
  const groupsById = new Map();
  for (const group of groups) {
    if (groupsById.has(group.id)) fail('invalid-sync-config', `duplicate sync group id "${group.id}"`, { field: 'groups' });
    groupsById.set(group.id, group);
  }

  const mappings = mappingList.map((mapping, index) => normalizeMapping(mapping, index, workspace));
  const mappingsByPair = new Map();
  for (const mapping of mappings) {
    const key = pairKey(mapping.from, mapping.to);
    if (mappingsByPair.has(key)) {
      fail('invalid-sync-config', `duplicate mapping for ${mapping.from} -> ${mapping.to}`, { field: 'mappings' });
    }
    mappingsByPair.set(key, mapping);
  }

  const members = new Map();
  const statuses = new Map(groups.map((group) => [group.id, { synchronized: true, reason: null }]));
  const appliedRanges = new Map();
  let busy = false;
  let destroyed = false;
  const unsubscribeWorkspace = workspace.subscribe ? workspace.subscribe(onWorkspaceEvent) : () => {};

  function chartOf(chartId) {
    const chart = workspace.getChart(chartId);
    return chart && !chart.__workspaceDestroyed ? chart : null;
  }

  function findPair(from, to) {
    const direct = mappingsByPair.get(pairKey(from, to));
    if (direct) return { mapping: direct, forward: true };
    const reverse = mappingsByPair.get(pairKey(to, from));
    if (reverse) return { mapping: reverse, forward: false };
    return null;
  }

  function uniqueSlotAtTime(chart, time) {
    if (typeof time !== 'number' || !Number.isFinite(time)) return null;
    const { slots } = readScale(chart.indexScale());
    const matches = slots.filter((slot) => slot.time === time);
    return matches.length === 1 ? matches[0].barId : null;
  }

  function barTime(chart, barId) {
    const { slots } = readScale(chart.indexScale());
    const index = indexOfBar(chart.indexScale(), barId);
    if (index === null) return undefined;
    return slots[index]?.time;
  }

  /**
   * Maps one bar id through the host-provided mapping. Returns null when the
   * correspondence is missing or ambiguous; a neighbour slot is never guessed.
   */
  function mapBar(fromChartId, toChartId, barId) {
    const pair = findPair(fromChartId, toChartId);
    if (!pair) return null;
    const { mapping, forward } = pair;
    const fromChart = chartOf(fromChartId);
    const toChart = chartOf(toChartId);
    if (!fromChart || !toChart) return null;

    if (mapping.bars) {
      if (forward) return hasOwn(mapping.bars, barId) ? mapping.bars[barId] : null;
      const keys = Object.keys(mapping.bars).filter((sourceBarId) => mapping.bars[sourceBarId] === barId);
      return keys.length === 1 ? keys[0] : null;
    }
    if (mapping.timestamps) {
      const time = barTime(fromChart, barId);
      return uniqueSlotAtTime(toChart, time);
    }
    if (mapping.derived) {
      const derivedChart = forward ? toChart : fromChart;
      if (typeof derivedChart.derivedScale !== 'function') return null;
      const derived = derivedChart.derivedScale();
      if (forward) {
        return typeof derived.lastCompletedElementFor === 'function' ? derived.lastCompletedElementFor(barId) : null;
      }
      return typeof derived.completionBarFor === 'function' ? derived.completionBarFor(barId) : null;
    }
    return null;
  }

  function mapFutureAnchor(fromChartId, toChartId, coordinate) {
    const pair = findPair(fromChartId, toChartId);
    if (!pair) return null;
    const { mapping, forward } = pair;
    const anchors = mapping.anchors ?? [];
    for (const entry of anchors) {
      const source = forward ? entry.from : entry.to;
      const target = forward ? entry.to : entry.from;
      if (source.anchorBarId === coordinate.anchorBarId && source.offset === coordinate.offset) return { ...target };
    }
    if (mapping.anchorDelta) {
      if (forward) {
        if (coordinate.anchorBarId === mapping.anchorDelta.fromAnchorBarId) {
          return {
            anchorBarId: mapping.anchorDelta.toAnchorBarId,
            offset: coordinate.offset + mapping.anchorDelta.delta,
          };
        }
      } else if (coordinate.anchorBarId === mapping.anchorDelta.toAnchorBarId) {
        return {
          anchorBarId: mapping.anchorDelta.fromAnchorBarId,
          offset: coordinate.offset - mapping.anchorDelta.delta,
        };
      }
    }
    return null;
  }

  /**
   * Maps a transport coordinate. Positions outside history require an explicit
   * future anchor mapping; they never produce synthetic bars or times.
   */
  function mapCoordinate(fromChartId, toChartId, coordinate) {
    const fromChart = chartOf(fromChartId);
    const toChart = chartOf(toChartId);
    if (!fromChart || !toChart) return { coordinate: null, reason: 'removed-chart' };
    const fromScale = fromChart.indexScale();
    const { slots } = readScale(fromScale);
    if (slots.length === 0) return { coordinate: null, reason: 'empty-source' };
    const sourceLogical = logicalFromAnchor(fromScale, coordinate);
    if (sourceLogical === null) return { coordinate: null, reason: 'missing-source-bar' };
    const last = slots.length - 1;
    if (sourceLogical < 0 || sourceLogical > last) {
      const mapped = mapFutureAnchor(fromChartId, toChartId, coordinate);
      if (!mapped) return { coordinate: null, reason: 'future-unmapped' };
      if (indexOfBar(toChart.indexScale(), mapped.anchorBarId) === null) {
        return { coordinate: null, reason: 'missing-target-bar' };
      }
      return { coordinate: mapped };
    }
    if (!findPair(fromChartId, toChartId)) return { coordinate: null, reason: 'no-mapping' };
    const mappedBar = mapBar(fromChartId, toChartId, coordinate.anchorBarId);
    if (!mappedBar) return { coordinate: null, reason: 'unmapped-bar' };
    if (indexOfBar(toChart.indexScale(), mappedBar) === null) {
      return { coordinate: null, reason: 'missing-target-bar' };
    }
    return { coordinate: { anchorBarId: mappedBar, offset: coordinate.offset } };
  }

  function report(group, synchronized, reason, chartId) {
    const previous = statuses.get(group.id);
    if (previous && previous.synchronized === synchronized && previous.reason === reason) return;
    statuses.set(group.id, { synchronized, reason });
    if (workspace.reportSync) {
      workspace.reportSync({ groupId: group.id, synchronized, reason, chartId });
    }
  }

  function groupMembers(group) {
    return group.charts.filter((chartId) => Boolean(chartOf(chartId)));
  }

  function applyCrosshair(chart, coordinate, price) {
    if (typeof chart.setCrosshairAnchor === 'function') {
      chart.setCrosshairAnchor(coordinate
        ? { anchorBarId: coordinate.anchorBarId, offset: coordinate.offset, ...(price === undefined ? {} : { price }) }
        : null);
      return true;
    }
    if (typeof chart.setCrosshair === 'function') {
      if (!coordinate) {
        chart.setCrosshair(null);
        return true;
      }
      if (coordinate.offset === 0) {
        chart.setCrosshair(coordinate.anchorBarId, price === undefined ? null : price);
        return true;
      }
      chart.setCrosshair(null);
      return false;
    }
    const options = coordinate
      ? { crosshair: { anchorBarId: coordinate.anchorBarId, offset: coordinate.offset, ...(price === undefined ? {} : { price }) } }
      : { crosshair: null };
    chart.applyOptions(options);
    return true;
  }

  function crosshairPriceFor(group, sourceChartId, targetChartId, price) {
    if (!group.price || typeof price !== 'number' || !Number.isFinite(price)) return undefined;
    const sourceChart = chartOf(sourceChartId);
    const targetChart = chartOf(targetChartId);
    if (!sourceChart || !targetChart || typeof sourceChart.getState !== 'function') return undefined;
    const sourceState = sourceChart.getState();
    const targetState = typeof targetChart.getState === 'function' ? targetChart.getState() : null;
    const sourceIdentity = instrumentPriceIdentity(sourceState?.instrument);
    const targetIdentity = instrumentPriceIdentity(targetState?.instrument);
    if (!sourceIdentity || sourceIdentity !== targetIdentity) return undefined;
    if (sourceState?.priceScaleId && targetState?.priceScaleId && sourceState.priceScaleId !== targetState.priceScaleId) return undefined;
    return price;
  }

  function coordinateFromEvent(event) {
    if (!isPlainObject(event)) return null;
    if (typeof event.barId === 'string' && event.barId.length > 0) {
      const offset = typeof event.offset === 'number' && Number.isFinite(event.offset) ? event.offset : 0;
      return { anchorBarId: event.barId, offset };
    }
    if (typeof event.logical === 'number' && Number.isFinite(event.logical)) {
      const chart = chartOf(event.chartId);
      if (!chart) return null;
      return anchorFromLogical(chart.indexScale(), event.logical);
    }
    return null;
  }

  function propagateCrosshair(sourceChartId, coordinate, price) {
    for (const group of groups) {
      if (!group.crosshair || !group.charts.includes(sourceChartId)) continue;
      const membersOfGroup = groupMembers(group);
      if (membersOfGroup.length < 2) continue;
      let synchronized = true;
      let reason = null;
      for (const targetChartId of membersOfGroup) {
        if (targetChartId === sourceChartId) continue;
        const targetChart = chartOf(targetChartId);
        if (!targetChart) continue;
        const result = coordinate
          ? mapCoordinate(sourceChartId, targetChartId, coordinate)
          : { coordinate: null, reason: 'no-source-coordinate' };
        if (!result.coordinate) {
          synchronized = false;
          reason = reason ?? result.reason;
          applyCrosshair(targetChart, null);
          continue;
        }
        const applied = applyCrosshair(
          targetChart,
          result.coordinate,
          crosshairPriceFor(group, sourceChartId, targetChartId, price),
        );
        if (!applied) {
          synchronized = false;
          reason = reason ?? 'fractional-cursor-unsupported';
        }
      }
      report(group, synchronized, reason, sourceChartId);
    }
  }

  function rangeAnchors(chartId, range) {
    const chart = chartOf(chartId);
    if (!chart) return null;
    const scale = chart.indexScale();
    const { slots } = readScale(scale);
    if (slots.length === 0) return null;
    const fromAnchor = anchorFromLogical(scale, range.from);
    const toAnchor = anchorFromLogical(scale, range.to);
    if (!fromAnchor || !toAnchor) return null;
    return { scale, last: slots.length - 1, fromAnchor, toAnchor };
  }

  function mappedBoundary(sourceChartId, targetChartId, anchor, outside) {
    if (outside) {
      const mapped = mapFutureAnchor(sourceChartId, targetChartId, anchor);
      if (!mapped) return null;
      const targetChart = chartOf(targetChartId);
      if (!targetChart || indexOfBar(targetChart.indexScale(), mapped.anchorBarId) === null) return null;
      return logicalFromAnchor(targetChart.indexScale(), mapped);
    }
    if (!findPair(sourceChartId, targetChartId)) return null;
    const mappedBar = mapBar(sourceChartId, targetChartId, anchor.anchorBarId);
    if (!mappedBar) return null;
    const targetChart = chartOf(targetChartId);
    if (!targetChart || indexOfBar(targetChart.indexScale(), mappedBar) === null) return null;
    return logicalFromAnchor(targetChart.indexScale(), { anchorBarId: mappedBar, offset: anchor.offset });
  }

  function countMappedSlots(sourceChartId, targetChartId, sourceScale, range) {
    const { slots } = readScale(sourceScale);
    let mapped = 0;
    for (let index = 0; index < slots.length; index += 1) {
      const x = index;
      if (x < range.from - 1e-9 || x > range.to + 1e-9) continue;
      if (mapBar(sourceChartId, targetChartId, slots[index].barId)) mapped += 1;
    }
    return mapped;
  }

  function mapVisibleRange(sourceChartId, targetChartId, range) {
    const anchors = rangeAnchors(sourceChartId, range);
    if (!anchors) return { range: null, reason: 'empty-source' };
    const { scale, last, fromAnchor, toAnchor } = anchors;
    const targetChart = chartOf(targetChartId);
    if (!targetChart) return { range: null, reason: 'removed-chart' };
    const fromOutside = range.from < 0 || range.from > last;
    const toOutside = range.to < 0 || range.to > last;
    const mappedFrom = mappedBoundary(sourceChartId, targetChartId, fromAnchor, fromOutside);
    const mappedTo = mappedBoundary(sourceChartId, targetChartId, toAnchor, toOutside);
    const current = targetChart.indexScale().getVisibleRange();

    if (mappedFrom === null && mappedTo === null) {
      const anyMapped = countMappedSlots(sourceChartId, targetChartId, scale, range);
      return { range: null, reason: anyMapped > 0 ? 'unmapped-boundaries' : 'no-intersection' };
    }
    let from = mappedFrom;
    let to = mappedTo;
    if (from === null) from = current?.from;
    if (to === null) to = current?.to;
    if (typeof from !== 'number' || typeof to !== 'number' || !Number.isFinite(from) || !Number.isFinite(to)) {
      return { range: null, reason: 'unmapped-boundaries' };
    }
    if (from >= to) return { range: null, reason: 'order-conflict' };
    return { range: { from, to }, reason: null };
  }

  function applyRangeRange(targetChartId, range) {
    const chart = chartOf(targetChartId);
    if (!chart) return;
    const current = chart.indexScale().getVisibleRange();
    if (current && current.from === range.from && current.to === range.to) return;
    chart.indexScale().setVisibleRange(range);
  }

  function propagateRange(sourceChartId, range) {
    for (const group of groups) {
      if (!group.range || !group.charts.includes(sourceChartId)) continue;
      const membersOfGroup = groupMembers(group);
      if (membersOfGroup.length < 2) continue;
      let synchronized = true;
      let reason = null;
      for (const targetChartId of membersOfGroup) {
        if (targetChartId === sourceChartId) continue;
        const result = mapVisibleRange(sourceChartId, targetChartId, range);
        if (!result.range) {
          synchronized = false;
          reason = reason ?? result.reason;
          continue;
        }
        applyRangeRange(targetChartId, result.range);
      }
      report(group, synchronized, reason, sourceChartId);
    }
  }

  function onCrosshair(sourceChartId, event) {
    if (destroyed || busy) return;
    const chart = chartOf(sourceChartId);
    if (!chart) return;
    const coordinate = coordinateFromEvent({ ...event, chartId: sourceChartId });
    busy = true;
    try {
      propagateCrosshair(sourceChartId, coordinate, event?.price);
    } finally {
      busy = false;
    }
  }

  function onVisibleRange(sourceChartId, event) {
    if (destroyed || busy) return;
    const chart = chartOf(sourceChartId);
    if (!chart) return;
    let range = event?.range ?? event;
    if (!range || typeof range.from !== 'number' || typeof range.to !== 'number') {
      range = chart.indexScale().getVisibleRange();
    }
    if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to) || range.from >= range.to) return;
    const key = `${range.from}\u0000${range.to}`;
    if (appliedRanges.get(sourceChartId) === key) return;
    appliedRanges.set(sourceChartId, key);
    busy = true;
    try {
      propagateRange(sourceChartId, { from: range.from, to: range.to });
    } finally {
      busy = false;
    }
  }

  function attach(chartId) {
    if (members.has(chartId)) return;
    const chart = chartOf(chartId);
    if (!chart || typeof chart.subscribe !== 'function') return;
    const unsubscribeCrosshair = chart.subscribe('crosshairMove', (event) => onCrosshair(chartId, event));
    const unsubscribeRange = chart.subscribe('visibleRangeChange', (event) => onVisibleRange(chartId, event));
    members.set(chartId, {
      unsubscribe: () => {
        unsubscribeCrosshair();
        unsubscribeRange();
      },
    });
  }

  function detach(chartId) {
    const member = members.get(chartId);
    if (!member) return;
    member.unsubscribe();
    members.delete(chartId);
  }

  function onWorkspaceEvent(event) {
    if (destroyed || !event) return;
    if (event.type === 'chartRemoved') {
      detach(event.chartId);
      for (const group of groups) {
        const index = group.charts.indexOf(event.chartId);
        if (index !== -1) group.charts.splice(index, 1);
        if (group.charts.length < 2) report(group, false, 'insufficient-members', event.chartId);
      }
      statuses.delete(event.chartId);
      return;
    }
    if (event.type === 'destroy') controller.destroy();
  }

  function missingPair(group) {
    for (let i = 0; i < group.charts.length; i += 1) {
      for (let j = i + 1; j < group.charts.length; j += 1) {
        if (!findPair(group.charts[i], group.charts[j])) return [group.charts[i], group.charts[j]];
      }
    }
    return null;
  }

  for (const group of groups) for (const chartId of group.charts) attach(chartId);

  // A group without an explicit mapping for every pair can never claim to be
  // synchronised, even before the first host event arrives.
  for (const group of groups) {
    if (group.charts.length < 2 || (!group.range && !group.crosshair)) continue;
    const missing = missingPair(group);
    if (missing) report(group, false, 'no-mapping', missing[0]);
  }

  const controller = {
    /** Current group membership, toggles and status. */
    listGroups() {
      return groups.map((group) => ({
        id: group.id,
        charts: [...group.charts],
        range: group.range,
        crosshair: group.crosshair,
        price: group.price,
      }));
    },
    getStatus(groupId) {
      if (groupId !== undefined) {
        const status = statuses.get(groupId);
        if (!status) fail('unknown-sync-group', `Unknown sync group: ${groupId}`, { field: 'groupId' });
        return { groupId, ...status };
      }
      return groups.map((group) => ({ groupId: group.id, ...(statuses.get(group.id) ?? { synchronized: true, reason: null }) }));
    },
    setEnabled(groupId, patch = {}) {
      const group = groupsById.get(groupId);
      if (!group) fail('unknown-sync-group', `Unknown sync group: ${groupId}`, { field: 'groupId' });
      if (patch.range !== undefined) group.range = requireBoolean(patch.range, 'range');
      if (patch.crosshair !== undefined) group.crosshair = requireBoolean(patch.crosshair, 'crosshair');
      if (patch.price !== undefined) group.price = requireBoolean(patch.price, 'price');
      const missing = group.charts.length > 1 && (group.range || group.crosshair) ? missingPair(group) : null;
      if (missing) report(group, false, 'no-mapping', missing[0]);
      else report(group, true, null, null);
      return controller.listGroups();
    },
    /** Host entry point: set a cursor coordinate on one chart and propagate it. */
    setCrosshair(chartId, coordinate, { price } = {}) {
      if (destroyed) fail('destroyed', 'sync controller is destroyed');
      if (!chartOf(chartId)) fail('unknown-chart', `Unknown chart: ${chartId}`, { field: 'chartId' });
      if (coordinate === null) {
        propagateCrosshair(chartId, null, undefined);
        return controller.getStatus();
      }
      if (coordinate.logical !== undefined && coordinate.anchorBarId === undefined && coordinate.barId === undefined) {
        const anchor = anchorFromLogical(chartOf(chartId).indexScale(), coordinate.logical);
        if (!anchor) fail('invalid-anchor', 'logical coordinate cannot be anchored without slots', { field: 'logical' });
        propagateCrosshair(chartId, anchor, price);
        return controller.getStatus();
      }
      const normalized =
        coordinate.anchorBarId === undefined && typeof coordinate.barId === 'string'
          ? normalizeAnchor({ anchorBarId: coordinate.barId, offset: coordinate.offset ?? 0 }, 'coordinate')
          : normalizeAnchor(coordinate, 'coordinate');
      propagateCrosshair(chartId, normalized, price);
      return controller.getStatus();
    },
    /** Host entry point: set a visible range on one chart and propagate it. */
    setVisibleRange(chartId, range) {
      if (destroyed) fail('destroyed', 'sync controller is destroyed');
      if (!chartOf(chartId)) fail('unknown-chart', `Unknown chart: ${chartId}`, { field: 'chartId' });
      if (!range || typeof range.from !== 'number' || typeof range.to !== 'number' || !Number.isFinite(range.from) || !Number.isFinite(range.to) || range.from >= range.to) {
        fail('invalid-range', 'range must be finite with from < to', { field: 'range' });
      }
      appliedRanges.set(chartId, `${range.from}\u0000${range.to}`);
      busy = true;
      try {
        propagateRange(chartId, { from: range.from, to: range.to });
      } finally {
        busy = false;
      }
      return controller.getStatus();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (typeof workspace.unregisterSyncController === 'function') workspace.unregisterSyncController(controller);
      unsubscribeWorkspace();
      for (const chartId of [...members.keys()]) detach(chartId);
      for (const group of groups) group.charts.length = 0;
    },
  };

  if (typeof workspace.registerSyncController === 'function') {
    try {
      workspace.registerSyncController(controller, groups.map((group) => group.id));
    } catch (error) {
      controller.destroy();
      throw error;
    }
  }

  return controller;
}
