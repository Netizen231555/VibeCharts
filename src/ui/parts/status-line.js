/**
 * Status line part: one compact line with the data state, the source and
 * observation time or delay, the demo-data label and action announcements.
 *
 * Both live regions exist from the first render and are updated in place, so
 * assistive technology registers them and announces later changes. Errors go
 * to a separate `role="alert"` region and stay there until a successful
 * result replaces them. All text is set with textContent.
 */
import { createElement, append } from '../../interaction/dom.js';
import { formatTimestamp } from '../../interaction/a11y.js';

/** Text and `title` are written together so a visually truncated line keeps its full text reachable. */
function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
  if (text === '') node.removeAttribute('title');
  else node.setAttribute('title', text);
}

function setHidden(node, hidden) {
  if (hidden) node.setAttribute('hidden', '');
  else node.removeAttribute('hidden');
}

/** Same wording as the former toolbar status: source, observation time, delay. */
function formatSource(info, options, t) {
  const parts = [];
  if (info.source !== undefined) parts.push(t('status.source', { value: info.source }));
  if (info.observedAt !== undefined) {
    parts.push(t('status.observed', { value: formatTimestamp(info.observedAt, { locale: options.locale, timeZone: options.timeZone }) }));
  }
  if (info.delayText !== undefined) parts.push(t('status.delay', { value: info.delayText }));
  else if (info.delay !== undefined) parts.push(t('status.delay', { value: String(info.delay) }));
  return parts.join('; ');
}

export function createStatusLine(controller, context) {
  const doc = context.document;
  const options = controller.options || {};

  const element = createElement(doc, 'div', { class: 'chart-ui-status-line', role: 'group', 'aria-label': controller.t('status.label') });

  const statusRegion = createElement(doc, 'div', { class: 'chart-ui-status-region', role: 'status' });
  const stateText = createElement(doc, 'span', { class: 'chart-ui-status-state' });
  const messageText = createElement(doc, 'span', { class: 'chart-ui-status-message' });
  append(statusRegion, stateText, messageText);

  const sourceText = createElement(doc, 'span', { class: 'chart-ui-status-source' });

  let demo = null;
  if (options.demo === true) {
    demo = createElement(doc, 'span', { class: 'chart-ui-status-demo' });
    // An omitted label means the default wording; a non-string value means no label at all.
    const label = options.demoLabel === undefined ? controller.t('chart.demoLabel') : (typeof options.demoLabel === 'string' ? options.demoLabel : '');
    append(demo, createElement(doc, 'strong', { class: 'chart-ui-status-demo-tag' }, 'DEMO'));
    if (label !== '') append(demo, createElement(doc, 'span', { class: 'chart-ui-status-demo-label' }, `: ${label}`));
    demo.setAttribute('title', label === '' ? 'DEMO' : `DEMO: ${label}`);
  }

  const alertRegion = createElement(doc, 'div', { class: 'chart-ui-status-alert', role: 'alert', hidden: true });
  const stateError = createElement(doc, 'span', { class: 'chart-ui-status-error' });
  const messageError = createElement(doc, 'span', { class: 'chart-ui-status-error' });
  const indicatorError = createElement(doc, 'span', { class: 'chart-ui-status-error' });
  append(alertRegion, stateError, messageError, indicatorError);

  append(element, statusRegion, sourceText);
  if (demo) append(element, demo);
  append(element, alertRegion);

  function syncAlert() {
    const empty = stateError.textContent === '' && messageError.textContent === '' && indicatorError.textContent === '';
    setHidden(alertRegion, empty);
    for (const node of [stateError, messageError, indicatorError]) setHidden(node, node.textContent === '');
  }

  function renderStatus() {
    const description = controller.statusModel.describe();
    element.setAttribute('data-phase', description.phase);
    if (description.stale) element.setAttribute('data-stale', 'true');
    else element.removeAttribute('data-stale');
    if (description.role === 'alert') {
      setText(stateError, description.text);
      setText(stateText, '');
    } else {
      setText(stateText, description.text);
      setText(stateError, '');
    }
    setText(sourceText, formatSource(controller.statusModel.sourceInfo(), options, controller.t));
    setHidden(sourceText, sourceText.textContent === '');
    syncAlert();
  }

  function renderMessage() {
    const { text, error } = controller.message;
    setText(messageText, error ? '' : text);
    setText(messageError, error ? text : '');
    setHidden(messageText, messageText.textContent === '');
    syncAlert();
  }

  function renderIndicatorErrors() {
    setText(indicatorError, controller.indicatorErrors());
    syncAlert();
  }

  renderStatus();
  renderMessage();
  renderIndicatorErrors();

  const unsubscribers = [
    controller.subscribe('status', renderStatus),
    controller.subscribe('message', renderMessage),
    controller.subscribe('indicatorErrors', renderIndicatorErrors),
  ];

  return {
    element,
    destroy() {
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
    },
  };
}
