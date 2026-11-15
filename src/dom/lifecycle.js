import { ChartError } from '../errors.js';
import { computeBufferSize } from '../render/canvas.js';
import { translate } from './messages.js';

let hostCounter = 0;

function visuallyHidden(style) {
  style.position = 'absolute';
  style.width = '1px';
  style.height = '1px';
  style.margin = '-1px';
  style.padding = '0';
  style.overflow = 'hidden';
  style.clip = 'rect(0 0 0 0)';
  style.whiteSpace = 'nowrap';
  style.border = '0';
}

function createElement(doc, tag, className) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  return element;
}

function setText(element, text) {
  element.textContent = text;
}

/**
 * Browser host: owns the DOM nodes, Canvas buffer, DPR and container observers.
 * It never reads market data and never creates HTML from data strings.
 */
export function createDomHost(container, options = {}) {
  if (!container || typeof container.appendChild !== 'function' || !container.ownerDocument) {
    throw new ChartError('INVALID_CONTAINER', 'createChart: container must be a DOM element');
  }
  const doc = container.ownerDocument;
  const win = doc.defaultView ?? globalThis;
  const hostId = `chart-host-${++hostCounter}`;
  const tableId = `${hostId}-table`;
  const label = typeof options.accessibilityLabel === 'string' ? options.accessibilityLabel : 'Price chart';

  const root = createElement(doc, 'div', 'charting-root');
  root.tabIndex = 0;
  root.setAttribute('role', 'figure');
  root.setAttribute('aria-label', label);
  root.setAttribute('aria-describedby', tableId);
  root.style.position = 'relative';
  root.style.width = '100%';
  root.style.height = '100%';
  root.style.overflow = 'hidden';
  root.style.boxSizing = 'border-box';

  const canvas = createElement(doc, 'canvas', 'charting-canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';

  const overlay = createElement(doc, 'div', 'charting-overlay');
  overlay.style.position = 'absolute';
  overlay.style.inset = '0';
  overlay.style.pointerEvents = 'none';

  const status = createElement(doc, 'div', 'charting-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  visuallyHidden(status.style);

  const alert = createElement(doc, 'div', 'charting-alert');
  alert.setAttribute('role', 'alert');
  alert.setAttribute('aria-live', 'assertive');
  alert.setAttribute('aria-atomic', 'true');
  visuallyHidden(alert.style);

  const table = createElement(doc, 'table', 'charting-a11y-table');
  table.id = tableId;
  visuallyHidden(table.style);
  const caption = createElement(doc, 'caption');
  setText(caption, 'Chart data, accessible alternative');
  const thead = createElement(doc, 'thead');
  const headerRow = createElement(doc, 'tr');
  const tbody = createElement(doc, 'tbody');
  table.appendChild(caption);
  table.appendChild(thead);
  thead.appendChild(headerRow);
  table.appendChild(tbody);

  const labelOverflow = createElement(doc, 'details', 'charting-label-overflow');
  labelOverflow.hidden = true;
  labelOverflow.style.position = 'absolute';
  labelOverflow.style.right = '0';
  labelOverflow.style.top = '0';
  labelOverflow.style.maxWidth = '100%';
  labelOverflow.style.maxHeight = '100%';
  labelOverflow.style.overflow = 'auto';
  labelOverflow.style.background = 'var(--charting-surface, Canvas)';
  labelOverflow.style.color = 'var(--charting-text, CanvasText)';
  labelOverflow.style.overflowWrap = 'anywhere';
  const labelSummary = createElement(doc, 'summary');
  setText(labelSummary, translate(options.locale, 'labels.otherValues'));
  const labelList = createElement(doc, 'ul');
  labelOverflow.appendChild(labelSummary);
  labelOverflow.appendChild(labelList);
  let labelOverflowKey = '';

  root.appendChild(canvas);
  root.appendChild(overlay);
  root.appendChild(status);
  root.appendChild(alert);
  root.appendChild(labelOverflow);
  root.appendChild(table);

  let chart = null;
  let width = 0;
  let height = 0;
  let dpr = Number.isFinite(win.devicePixelRatio) && win.devicePixelRatio > 0 ? win.devicePixelRatio : 1;
  let raf = null;
  let frameIsAnimation = false;
  let resizeObserver = null;
  let dprQuery = null;
  let dprListener = null;
  let windowResizeListener = null;
  let autoSize = options.autoSize !== false;
  let destroyed = false;
  let tableScheduled = false;
  let tableFrame = null;
  let tableFrameIsAnimation = false;
  const listeners = new Map();
  const controls = new Map();
  const unsubscribers = [];

  const ctx = canvas.getContext('2d');
  container.appendChild(root);

  function measure() {
    const bounds = container.getBoundingClientRect?.();
    return {
      width: Math.max(0, bounds?.width ?? container.clientWidth ?? 0),
      height: Math.max(0, bounds?.height ?? container.clientHeight ?? 0)
    };
  }

  function applySize(nextWidth, nextHeight) {
    const previousDpr = dpr;
    width = Math.max(0, nextWidth);
    height = Math.max(0, nextHeight);
    dpr = Number.isFinite(win.devicePixelRatio) && win.devicePixelRatio > 0 ? win.devicePixelRatio : 1;
    if (dpr !== previousDpr && dprQuery) watchDpr();
    const buffer = computeBufferSize(width, height, dpr);
    canvas.width = buffer.width;
    canvas.height = buffer.height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    return { width, height, dpr };
  }

  function scheduleDraw() {
    if (destroyed || !chart || raf !== null) return;
    frameIsAnimation = typeof win.requestAnimationFrame === 'function'
      && typeof win.cancelAnimationFrame === 'function';
    const run = () => {
      raf = null;
      if (!destroyed) chart?._draw();
    };
    raf = frameIsAnimation ? win.requestAnimationFrame(run) : win.setTimeout(run, 0);
  }

  function cancelFrame() {
    if (raf === null) return;
    if (frameIsAnimation) win.cancelAnimationFrame(raf);
    else win.clearTimeout(raf);
    raf = null;
  }

  function formatTimeCell(time) {
    if (typeof time !== 'number') return 'not provided';
    try {
      return new Date(time).toISOString();
    } catch {
      return 'not provided';
    }
  }

  function formatSessionDate(date) {
    if (!date) return 'not provided';
    return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
  }

  function rebuildTable() {
    tableScheduled = false;
    if (!chart || destroyed) return;
    const pane = chart._panes[0];
    const series = [...pane.series].find((entry) => entry.type === 'candlestick' || entry.type === 'bar')
      ?? [...pane.series][0]
      ?? null;
    headerRow.textContent = '';
    tbody.textContent = '';
    if (!series) {
      const headers = ['Bar', 'Time (UTC)', 'Session date', 'Value'];
      for (const name of headers) {
        const th = createElement(doc, 'th');
        th.scope = 'col';
        setText(th, name);
        headerRow.appendChild(th);
      }
      const row = createElement(doc, 'tr');
      const cell = createElement(doc, 'td');
      cell.colSpan = headers.length;
      setText(cell, 'No data');
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }
    const ohlc = series.type === 'candlestick' || series.type === 'bar';
    const headers = ohlc
      ? ['Bar', 'Time (UTC)', 'Session date', 'Open', 'High', 'Low', 'Close', 'Direction', 'Volume']
      : ['Bar', 'Time (UTC)', 'Session date', 'Value'];
    for (const name of headers) {
      const th = createElement(doc, 'th');
      th.scope = 'col';
      setText(th, name);
      headerRow.appendChild(th);
    }
    const range = chart._indexScale.getVisibleRange();
    if (!range) {
      const row = createElement(doc, 'tr');
      const cell = createElement(doc, 'td');
      cell.colSpan = headers.length;
      setText(cell, 'No visible data');
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }
    const from = Math.max(0, Math.floor(range.from));
    const to = Math.min(chart._timeline.length - 1, Math.ceil(range.to), from + 99);
    for (let index = from; index <= to; index += 1) {
      const slot = chart._timeline.slotAt(index);
      if (!slot) continue;
      const point = series.point(slot.barId);
      if (!point) continue;
      const row = createElement(doc, 'tr');
      const cells = [
        slot.barId,
        formatTimeCell(slot.time),
        formatSessionDate(slot.sessionDate)
      ];
      if (ohlc) {
        cells.push(
          String(point.open),
          String(point.high),
          String(point.low),
          String(point.close),
          point.close > point.open ? 'up' : point.close < point.open ? 'down' : 'unchanged',
          point.volume === null || point.volume === undefined ? 'unavailable' : String(point.volume)
        );
      } else {
        cells.push(String(point.value));
      }
      for (const value of cells) {
        const cell = createElement(doc, 'td');
        setText(cell, value);
        row.appendChild(cell);
      }
      tbody.appendChild(row);
    }
  }

  function scheduleTable() {
    if (tableScheduled || destroyed) return;
    tableScheduled = true;
    tableFrameIsAnimation = typeof win.requestAnimationFrame === 'function'
      && typeof win.cancelAnimationFrame === 'function';
    const run = () => {
      tableFrame = null;
      rebuildTable();
    };
    tableFrame = tableFrameIsAnimation ? win.requestAnimationFrame(run) : win.setTimeout(run, 0);
  }

  function addListener(id, target, type, handler, listenerOptions) {
    if (destroyed) throw new ChartError('CHART_DESTROYED', 'host.addListener: chart is destroyed');
    if (listeners.has(id)) {
      throw new ChartError('INVALID_ARGUMENT', `host.addListener: listener id "${id}" is already registered`);
    }
    if (!target || typeof target.addEventListener !== 'function') {
      throw new ChartError('INVALID_ARGUMENT', 'host.addListener: target does not support events');
    }
    target.addEventListener(type, handler, listenerOptions);
    let active = true;
    const release = () => {
      if (!active) return;
      active = false;
      target.removeEventListener(type, handler, listenerOptions);
      listeners.delete(id);
    };
    listeners.set(id, release);
    return release;
  }

  function addControl(control) {
    if (!control || typeof control.id !== 'string' || control.id.length === 0) {
      throw new ChartError('INVALID_ARGUMENT', 'host.addControl: control.id is required');
    }
    if (controls.has(control.id)) {
      throw new ChartError('INVALID_ARGUMENT', 'host.addControl: control id already exists');
    }
    const wrapper = createElement(doc, 'div', 'charting-control');
    wrapper.style.pointerEvents = 'auto';
    wrapper.dataset.controlId = control.id;
    wrapper.setAttribute('aria-label', typeof control.name === 'string' ? control.name : control.id);
    if (typeof control.role === 'string' && control.role !== 'button') wrapper.setAttribute('role', control.role);
    let rendered = null;
    let releaseListener = null;
    if (typeof control.render === 'function') rendered = control.render();
    if (rendered && typeof rendered === 'object' && typeof rendered.nodeType === 'number') {
      wrapper.appendChild(rendered);
    } else {
      const button = createElement(doc, 'button');
      button.type = 'button';
      if (typeof control.name === 'string') button.setAttribute('aria-label', control.name);
      setText(button, typeof rendered === 'string' ? rendered : typeof control.name === 'string' ? control.name : control.id);
      const errorRegion = createElement(doc, 'div', 'charting-control-error');
      errorRegion.style.backgroundColor = '#fff';
      errorRegion.style.color = '#000';
      errorRegion.style.padding = '0.25em';
      errorRegion.setAttribute('role', 'alert');
      errorRegion.setAttribute('hidden', '');
      const activate = () => {
        if (destroyed) return;
        try {
          control.onActivate?.();
          errorRegion.textContent = '';
          errorRegion.setAttribute('hidden', '');
        } catch {
          errorRegion.textContent = `Control ${control.name || control.id}: activation failed. Check the extension and try again.`;
          errorRegion.removeAttribute('hidden');
        }
      };
      button.addEventListener('click', activate);
      releaseListener = () => button.removeEventListener('click', activate);
      wrapper.appendChild(button);
      wrapper.appendChild(errorRegion);
    }
    overlay.appendChild(wrapper);
    controls.set(control.id, { wrapper, releaseListener });
    return () => {
      if (controls.get(control.id)?.wrapper === wrapper) removeControl(control.id);
    };
  }

  function removeControl(id) {
    const control = controls.get(id);
    if (!control) return;
    control.releaseListener?.();
    control.wrapper.remove();
    controls.delete(id);
  }

  function addOverlay(element) {
    if (!element || typeof element !== 'object') {
      throw new ChartError('INVALID_ARGUMENT', 'host.addOverlay: element is required');
    }
    overlay.appendChild(element);
    return () => element.remove();
  }

  // Assigning canvas.width clears the bitmap; drawing on the next frame would paint one blank frame per resize
  // (a flash while the container settles or the window is dragged), so the host-driven resize redraws at once.
  function resizeAndDraw(nextWidth, nextHeight) {
    chart.resize(nextWidth, nextHeight);
    if (destroyed) return;
    cancelFrame();
    chart._draw();
  }

  function resizeFromContainer() {
    if (!chart || destroyed || !autoSize) return;
    const next = measure();
    if (next.width !== width || next.height !== height) resizeAndDraw(next.width, next.height);
  }

  function startAutoSize() {
    if (!autoSize || destroyed || resizeObserver || typeof win.ResizeObserver !== 'function') return;
    const observer = new win.ResizeObserver(() => {
      if (resizeObserver === observer) resizeFromContainer();
    });
    resizeObserver = observer;
    observer.observe(container);
  }

  function stopAutoSize() {
    const observer = resizeObserver;
    resizeObserver = null;
    observer?.disconnect();
  }

  function unwatchDpr() {
    if (dprQuery && dprListener) {
      if (typeof dprQuery.removeEventListener === 'function') dprQuery.removeEventListener('change', dprListener);
      else dprQuery.removeListener?.(dprListener);
    }
    dprQuery = null;
    dprListener = null;
  }

  function watchDpr() {
    unwatchDpr();
    if (destroyed || typeof win.matchMedia !== 'function') return;
    const query = win.matchMedia(`(resolution: ${dpr}dppx)`);
    const listener = () => {
      if (destroyed || !chart || dprQuery !== query) return;
      unwatchDpr();
      resizeAndDraw(width, height);
      watchDpr();
    };
    if (typeof query.addEventListener === 'function') query.addEventListener('change', listener);
    else if (typeof query.addListener === 'function') query.addListener(listener);
    else return;
    dprQuery = query;
    dprListener = listener;
  }

  function onWindowResize() {
    if (destroyed || !chart) return;
    if (autoSize && !resizeObserver) resizeFromContainer();
    if (destroyed) return;
    const currentDpr = Number.isFinite(win.devicePixelRatio) && win.devicePixelRatio > 0 ? win.devicePixelRatio : 1;
    if (currentDpr !== dpr) {
      resizeAndDraw(width, height);
      watchDpr();
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelFrame();
    if (tableFrame !== null) {
      if (tableFrameIsAnimation) win.cancelAnimationFrame(tableFrame);
      else win.clearTimeout(tableFrame);
      tableFrame = null;
      tableScheduled = false;
    }
    stopAutoSize();
    unwatchDpr();
    if (windowResizeListener) win.removeEventListener?.('resize', windowResizeListener);
    for (const release of [...listeners.values()]) release();
    listeners.clear();
    for (const unsubscribe of unsubscribers) {
      try {
        unsubscribe();
      } catch {
        // Unsubscription must not prevent DOM cleanup.
      }
    }
    for (const id of controls.keys()) removeControl(id);
    root.remove();
  }

  const host = {
    id: hostId,
    container,
    element: root,
    canvas,
    overlay,
    status,
    alert,
    table,
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    get dpr() {
      return dpr;
    },
    getSize() {
      return { width, height };
    },
    getContext() {
      return ctx;
    },
    attach(nextChart) {
      if (chart === nextChart) return;
      chart = nextChart;
      const next = measure();
      applySize(next.width, next.height);
      chart.resize(next.width, next.height);
      startAutoSize();
      windowResizeListener = onWindowResize;
      win.addEventListener?.('resize', windowResizeListener);
      watchDpr();
      unsubscribers.push(
        chart.subscribe('datachange', scheduleTable),
        chart.subscribe('visibleRangeChange', scheduleTable),
        chart.subscribe('destroy', () => {
          scheduleTable();
        })
      );
      scheduleTable();
    },
    setSize(nextWidth, nextHeight) {
      return applySize(nextWidth, nextHeight);
    },
    setAutoSize(enabled) {
      autoSize = enabled === true;
      if (autoSize) {
        startAutoSize();
        resizeFromContainer();
      } else stopAutoSize();
    },
    scheduleDraw,
    addListener,
    addControl,
    removeControl,
    addOverlay,
    setLabelOverflow(labels) {
      const key = JSON.stringify(labels);
      if (key === labelOverflowKey) return;
      labelOverflowKey = key;
      labelList.textContent = '';
      for (const item of labels) {
        const entry = createElement(doc, 'li');
        setText(entry, `${item.paneId} / ${item.scaleId} / ${item.seriesId}: ${item.text}`);
        labelList.appendChild(entry);
      }
      labelOverflow.hidden = labels.length === 0;
    },
    announce(message, { assertive = false } = {}) {
      const target = assertive ? alert : status;
      setText(target, typeof message === 'string' ? message : String(message));
    },
    destroy
  };
  return host;
}
