/**
 * Data table part: the chart values as a semantic table, shown only while the
 * controller's `tableVisible` is on.
 *
 * The part element stays mounted and is merely hidden, so toggling never moves
 * focus. The scroll container is kept across re-renders for the same reason
 * and so that a reader's scroll position survives a data update. Cells and
 * headers are set with textContent; missing values arrive from the table model
 * already spelled out and are never replaced by 0 or an empty cell.
 */
import { createElement, append, clearElement } from '../../interaction/dom.js';

// Unique per part instance: several charts may share one document.
let instanceCounter = 0;

function setHidden(node, hidden) {
  if (hidden) node.setAttribute('hidden', '');
  else node.removeAttribute('hidden');
}

export function createDataTable(controller, context) {
  const doc = context.document;
  instanceCounter += 1;
  const captionId = `chart-ui-data-table-caption-${instanceCounter}`;

  const element = createElement(doc, 'div', { class: 'chart-ui-data-table' });
  const scroll = createElement(doc, 'div', { class: 'chart-ui-data-table-scroll', tabindex: '0', role: 'region' });
  const notice = createElement(doc, 'p', { class: 'chart-ui-data-table-notice' });
  const failure = createElement(doc, 'p', { class: 'chart-ui-data-table-notice chart-ui-data-table-error', role: 'alert' });
  append(element, scroll, notice, failure);

  function showOnly(target) {
    setHidden(scroll, target !== scroll);
    setHidden(notice, target !== notice);
    setHidden(failure, target !== failure);
  }

  function buildTable(model) {
    const table = createElement(doc, 'table', { class: 'chart-accessible-table chart-ui-data-table-grid' });
    append(table, createElement(doc, 'caption', { id: captionId }, model.caption));
    const headerRow = createElement(doc, 'tr', {});
    for (const column of model.columns) append(headerRow, createElement(doc, 'th', { scope: 'col' }, column.label));
    const body = createElement(doc, 'tbody', {});
    for (const row of model.rows) {
      const tr = createElement(doc, 'tr', {});
      for (const cell of row) append(tr, createElement(doc, 'td', {}, cell));
      append(body, tr);
    }
    append(table, append(createElement(doc, 'thead', {}), headerRow), body);
    return table;
  }

  function render() {
    const visible = controller.get('tableVisible') === true;
    setHidden(element, !visible);
    if (!visible) {
      // Nothing is kept for a hidden table: a large model would otherwise stay in the DOM unseen.
      clearElement(scroll);
      return;
    }
    let model;
    try {
      model = controller.table();
    } catch (error) {
      clearElement(scroll);
      failure.textContent = controller.t('data.failed', { message: error.message });
      showOnly(failure);
      return;
    }
    if (model === null) {
      clearElement(scroll);
      notice.textContent = controller.t('data.noSource');
      showOnly(notice);
      return;
    }
    const { scrollTop, scrollLeft } = scroll;
    clearElement(scroll);
    append(scroll, buildTable(model));
    scroll.setAttribute('aria-labelledby', captionId);
    scroll.removeAttribute('aria-label');
    showOnly(scroll);
    scroll.scrollTop = scrollTop;
    scroll.scrollLeft = scrollLeft;
  }

  // Before the first table is built the region still needs a name for assistive technology.
  scroll.setAttribute('aria-label', controller.t('data.label'));
  render();
  // A feed can append several bars per frame and every rebuild is O(rows), so data changes are drawn once per animation
  // frame; toggling visibility stays immediate because the user is waiting for it. Without a window the render is synchronous.
  const view = doc.defaultView;
  let frame = null;
  const cancelFrame = () => {
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = null;
  };
  const unsubscribe = controller.subscribe(['data', 'tableVisible'], (changed) => {
    if (changed.includes('tableVisible') || !view || typeof view.requestAnimationFrame !== 'function') {
      cancelFrame();
      render();
      return;
    }
    if (frame !== null) return;
    frame = view.requestAnimationFrame(() => {
      frame = null;
      render();
    });
  });

  return {
    element,
    destroy() {
      unsubscribe();
      if (view) cancelFrame();
    },
  };
}
