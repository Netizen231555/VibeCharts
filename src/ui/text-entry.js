import { createElement, append, contains, focusElement, setStyle } from '../interaction/dom.js';

// The editor lives outside the canvas and is removed before interactive placement starts.
export function openAnnotationEntry({ chart, t, onApply }) {
  const host = chart.container;
  const doc = host?.ownerDocument;
  if (!doc || !host) throw new Error(t('chart.toolUnavailable'));
  const invoker = doc.activeElement;
  const form = createElement(doc, 'form', { class: 'chart-drawing-text-entry', role: 'group', 'aria-label': t('drawings.textEntryTitle') });
  setStyle(form, { position: 'absolute', zIndex: '20', top: '8px', left: '8px', padding: '8px', background: 'Canvas', color: 'CanvasText' });
  const label = createElement(doc, 'label', {});
  const text = createElement(doc, 'textarea', { 'aria-label': t('drawings.textEntry') });
  const error = createElement(doc, 'p', { role: 'alert' });
  const apply = createElement(doc, 'button', { type: 'submit' }, t('drawings.place'));
  const cancel = createElement(doc, 'button', { type: 'button' }, t('drawings.cancelEdit'));
  append(label, createElement(doc, 'span', {}, t('drawings.textEntry')), text);
  append(form, label, error, apply, cancel);
  append(host, form);
  let closed = false;
  function close(restore = true) {
    if (closed) return;
    closed = true;
    const hadFocus = contains(form, doc.activeElement);
    if (form.parentNode) form.parentNode.removeChild(form);
    if (restore && hadFocus) focusElement(invoker && invoker.isConnected !== false ? invoker : host);
  }
  cancel.addEventListener('click', () => close());
  form.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (text.value.length > 20000) { error.textContent = t('drawings.textLimit'); focusElement(text); return; }
    try {
      onApply(text.value);
      close(false);
      focusElement(host);
    } catch (failure) {
      error.textContent = failure.message;
      focusElement(text);
    }
  });
  focusElement(text);
  return close;
}
