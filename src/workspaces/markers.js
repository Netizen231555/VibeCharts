import { fail } from './errors.js';
import { isPlainObject, requireArray, requireString, toJsonClone } from './util.js';
import { indexOfBar, readScale } from './anchors.js';
import { clearChildren, createElement, listen } from './dom.js';

export const DEFAULT_CLUSTER_DISTANCE = 2;

export function validateMarkerCoordinates(chart) {
  if (typeof chart.indexScale().indexToCoordinate !== 'function') {
    fail('adapter-unsupported', 'Marker placement requires indexScale().indexToCoordinate()', { field: 'indexScale.indexToCoordinate' });
  }
}

/**
 * Validates a complete marker set for one chart. The whole set is rejected with
 * the offending field when any id is duplicated or any `barId` is not present in
 * the chart timeline. Nothing is repaired or dropped silently.
 */
export function validateMarkerSet(markers, chart, { field = 'markers', code = 'invalid-markers', distance } = {}) {
  requireArray(markers, field, code);
  const scale = chart.indexScale();
  readScale(scale);
  if (markers.length) validateMarkerCoordinates(chart);
  const ids = new Set();
  const normalized = markers.map((marker, index) => {
    const markerField = `${field}[${index}]`;
    if (!isPlainObject(marker)) fail(code, `${markerField} must be an object`, { field: markerField });
    const id = requireString(marker.id, `${markerField}.id`, code);
    if (ids.has(id)) fail(code, `${field} contains duplicate marker id "${id}"`, { field: `${markerField}.id` });
    ids.add(id);
    const barId = requireString(marker.barId, `${markerField}.barId`, code);
    if (indexOfBar(scale, barId) === null) {
      fail(code, `${markerField}.barId references missing bar "${barId}"`, { field: `${markerField}.barId`, barId });
    }
    const text = requireString(marker.text, `${markerField}.text`, code, true);
    const node = { id, barId, text };
    if (marker.details !== undefined) node.details = requireString(marker.details, `${markerField}.details`, code, true);
    return node;
  });
  return { markers: normalized, distance: validateDistance(distance) };
}

export function validateDistance(distance) {
  if (distance === undefined) return DEFAULT_CLUSTER_DISTANCE;
  if (!Number.isSafeInteger(distance) || distance < 0) {
    fail('invalid-argument', 'clusterDistance must be a non-negative integer', { field: 'clusterDistance' });
  }
  return distance;
}

/** Groups markers by horizontal CSS-pixel distance. */
export function clusterMarkers(entries, distance = DEFAULT_CLUSTER_DISTANCE) {
  const sorted = [...entries].sort((a, b) => (a.x ?? a.index) - (b.x ?? b.index) || String(a.marker.id).localeCompare(String(b.marker.id)));
  const clusters = [];
  let current = null;
  for (const entry of sorted) {
    if (!current || (entry.x ?? entry.index) - current.lastX > distance) {
      current = { key: entry.marker.id, markerIds: [entry.marker.id], markers: [entry.marker], lastIndex: entry.index, lastX: entry.x ?? entry.index };
      clusters.push(current);
    } else {
      current.markerIds.push(entry.marker.id);
      current.markers.push(entry.marker);
      current.lastIndex = entry.index;
      current.lastX = entry.x ?? entry.index;
    }
  }
  return clusters.map((cluster) => ({
    key: cluster.key,
    markers: cluster.markers,
    count: cluster.markers.length,
    index: cluster.lastIndex,
    x: cluster.lastX,
  }));
}

export function markerEntries(markers, chart) {
  const scale = chart.indexScale();
  const rect = chart.surface?.getVisibleRect?.();
  return markers.map((marker) => {
    const index = indexOfBar(scale, marker.barId);
    const coordinate = index === null ? null : scale.indexToCoordinate(index);
    return { marker, index, x: coordinate === null ? null : coordinate + (rect?.x ?? 0) };
  });
}

/** DOM list of markers and dense-marker groups for one chart. */
export function createMarkerView({ container, chartId, getChart, getMarkers, getDistance, onSelect }) {
  let markers = [];
  let chart = null;
  let model = [];
  const openGroups = new Set();
  const unlisten = [];

  const distance = () => {
    const value = getDistance?.();
    return Number.isSafeInteger(value) && value >= 0 ? value : DEFAULT_CLUSTER_DISTANCE;
  };

  function rebuild() {
    chart = getChart(chartId);
    const entries = chart ? markerEntries(markers, chart) : markers.map((marker) => ({ marker, index: null }));
    const placed = entries.filter((entry) => entry.index !== null && entry.x !== null);
    const unresolved = entries.filter((entry) => entry.index === null || entry.x === null);
    model = clusterMarkers(placed, distance());
    return { unresolved };
  }

  function button(parent, marker, label) {
    const element = createElement(parent, 'button', {
      className: 'cw-marker-button',
      attributes: { type: 'button', 'data-marker-id': marker.id, 'aria-label': label ?? `Event: ${marker.text || marker.id}` },
    });
    element.textContent = marker.text;
    if (element.dataset) element.dataset.markerId = marker.id;
    if (marker.details !== undefined) element.setAttribute('title', marker.details);
    return element;
  }

  function render() {
    if (!container) return;
    const active = container.ownerDocument?.activeElement;
    let focused = null;
    for (let node = active; node && node !== container; node = node.parentElement ?? node.parentNode) {
      if (node.dataset?.markerId || node.dataset?.clusterKey) {
        focused = { markerId: node.dataset.markerId ?? node.dataset.clusterKey };
        break;
      }
    }
    const hadFocus = focused && (() => {
      for (let node = active; node; node = node.parentElement ?? node.parentNode) if (node === container) return true;
      return false;
    })();
    const oldCluster = hadFocus ? model.find(cluster => cluster.markers.some(marker => marker.id === focused.markerId)) : null;
    const { unresolved } = rebuild();
    clearChildren(container);
    if (markers.length === 0) {
      if (hadFocus) {
        container.setAttribute('tabindex', '-1');
        container.focus?.();
      }
      return;
    }
    const list = createElement(container, 'div', {
      className: 'cw-markers',
      attributes: { role: 'list', 'aria-label': `Event markers for chart ${chartId}` },
    });
    Object.assign(list.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    list.dataset.chartId = chartId;
    let focusTarget = null;
    let nearestTarget = null;
    let nearestDistance = Infinity;
    for (const cluster of model) {
      if (cluster.count === 1) {
        const item = createElement(list, 'div', { className: 'cw-marker', attributes: { role: 'listitem' } });
        Object.assign(item.style, { position: 'absolute', left: `${cluster.x}px`, top: '0', pointerEvents: 'auto' });
        const target = item;
        if (hadFocus) {
          const distance = Math.abs(cluster.x - (oldCluster?.x ?? cluster.x));
          if (distance < nearestDistance) { nearestDistance = distance; nearestTarget = target; }
        }
        const markerButton = button(item, cluster.markers[0]);
        if (hadFocus && cluster.markers[0].id === focused.markerId) focusTarget = markerButton;
        if (nearestTarget === item) nearestTarget = markerButton;
        continue;
      }
      const isOpen = openGroups.has(cluster.key);
      const group = createElement(list, 'div', {
        className: 'cw-marker-cluster',
        attributes: {
          role: 'listitem',
          tabindex: '0',
          'data-cluster-key': cluster.key,
          'aria-expanded': isOpen ? 'true' : 'false',
          'aria-label': `${cluster.count} events near ${cluster.markers[0].barId}. Press Enter to expand.`,
        },
      });
      Object.assign(group.style, { position: 'absolute', left: `${cluster.x}px`, top: '0', pointerEvents: 'auto' });
      if (group.dataset) group.dataset.clusterKey = cluster.key;
      if (hadFocus) {
        const distance = Math.abs(cluster.x - (oldCluster?.x ?? cluster.x));
        if (distance < nearestDistance) { nearestDistance = distance; nearestTarget = group; }
        if (cluster.markers.some(marker => marker.id === focused.markerId)) focusTarget = group;
      }
      const count = createElement(group, 'span', { className: 'cw-marker-count' });
      count.textContent = `${cluster.count} events`;
      if (isOpen) {
        const items = createElement(group, 'ul', { className: 'cw-marker-list', attributes: { role: 'list', 'aria-label': `Events near ${cluster.markers[0].barId}` } });
        for (const marker of cluster.markers) {
          const item = createElement(items, 'li', { attributes: { role: 'listitem' } });
          const markerButton = button(item, marker);
          if (hadFocus && marker.id === focused.markerId) focusTarget = markerButton;
        }
      }
    }
    for (const entry of unresolved) {
      const item = createElement(list, 'div', { className: 'cw-marker cw-marker-unresolved', attributes: { role: 'listitem' } });
      const text = createElement(item, 'span', { className: 'cw-marker-text' });
      text.textContent = `${entry.marker.text} (bar ${entry.marker.barId} unavailable)`;
    }
    if (hadFocus) {
      const target = focusTarget ?? nearestTarget ?? container;
      if (target === container) container.setAttribute('tabindex', '-1');
      target.focus?.();
    }
  }

  function select(markerId) {
    const marker = markers.find((entry) => entry.id === markerId);
    if (!marker) fail('unknown-marker', `Unknown marker: ${markerId}`, { field: 'markerId' });
    if (typeof onSelect === 'function') onSelect({ markerId: marker.id, chartId, barId: marker.barId });
    return marker;
  }

  function toggleGroup(key) {
    if (openGroups.has(key)) openGroups.delete(key);
    else openGroups.add(key);
    render();
    return openGroups.has(key);
  }

  function handleClick(event) {
    for (let node = event?.target; node && node !== container; node = node.parentElement) {
      const data = node.dataset ?? {};
      if (data.markerId) return select(data.markerId);
      if (data.clusterKey) return toggleGroup(data.clusterKey);
    }
    return undefined;
  }

  function handleKey(event) {
    const data = event?.target?.dataset ?? {};
    if (event.key !== 'Enter' && event.key !== ' ') return undefined;
    if (data.markerId) {
      event.preventDefault?.();
      return select(data.markerId);
    }
    if (data.clusterKey) {
      event.preventDefault?.();
      return toggleGroup(data.clusterKey);
    }
    return undefined;
  }

  if (container) {
    unlisten.push(listen(container, 'click', handleClick), listen(container, 'keydown', handleKey));
  }
  const initialChart = getChart(chartId);
  if (typeof initialChart?.subscribe === 'function') {
    for (const event of ['datachange', 'visibleRangeChange', 'resize']) {
      unlisten.push(initialChart.subscribe(event, () => render()));
    }
  }

  return {
    setMarkers(next, { distance: nextDistance } = {}) {
      markers = next.map((marker) => toJsonClone(marker, 'marker'));
      if (nextDistance !== undefined) openGroups.clear();
      render();
    },
    getMarkers() {
      rebuild();
      return model.map((cluster) => ({
        key: cluster.key,
        count: cluster.count,
        index: cluster.index,
        markerIds: cluster.markers.map((marker) => marker.id),
      }));
    },
    getOpenGroups() {
      return [...openGroups];
    },
    getMarkersById() {
      return markers.map((marker) => ({ ...marker }));
    },
    getPositions() {
      const live = getChart(chartId);
      return markers.map((marker) => ({
        ...marker,
        index: live ? indexOfBar(live.indexScale(), marker.barId) : null,
      }));
    },
    select,
    toggleGroup,
    render,
    destroy() {
      for (const off of unlisten) off();
      unlisten.length = 0;
      markers = [];
      model = [];
      openGroups.clear();
      if (container) clearChildren(container);
    },
  };
}
