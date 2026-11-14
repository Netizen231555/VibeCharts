/**
 * Derived view panel: view selection, parameters, element navigation and the
 * readout of the selected element.
 *
 * Not a layout part: the settings menu mounts it in a modal dialog when the
 * dialog opens and calls `destroy()` when it closes. The accessibility model
 * lives in `controller.derived`; this panel only renders and drives it.
 */
import { append, clearElement, createElement, focusElement } from '../../interaction/dom.js';

const DEFAULT_KINDS = Object.freeze([
  { id: 'baseline', label: 'Baseline' },
  { id: 'heikinAshi', label: 'Heikin Ashi' },
  { id: 'renko', label: 'Renko' },
  { id: 'kagi', label: 'Kagi' },
  { id: 'pointAndFigure', label: 'Point & Figure' },
]);

// Ids of described-by text must not collide when panels of several dialogs coexist in one document.
let instanceCounter = 0;

export function createDerivedPanel(controller, { document: doc } = {}) {
  instanceCounter += 1;
  const uid = `chart-ui-derived-${instanceCounter}`;
  const element = createElement(doc, 'section', {
    class: 'chart-ui-panel chart-ui-panel-derived',
    'aria-label': 'Производный вид',
    tabindex: '-1',
  });
  const body = createElement(doc, 'div', { class: 'chart-ui-panel-body' });
  append(element, body);

  // Controls of the current render by key, so a rebuild can hand focus to the same control again.
  const focusables = new Map();
  let readout = null;
  let renderedModel = null;
  let renderedSignature = null;
  let destroyed = false;

  // `controls()` is constant-time and covers everything the panel shows apart from the selection,
  // so a crosshair-driven notification does not rebuild the inputs under the user's hands.
  function signatureOf(model) {
    return JSON.stringify(model.controls());
  }

  function focusedKey() {
    const active = doc.activeElement;
    if (!active) return null;
    for (const [key, node] of focusables) {
      if (node === active) return key;
    }
    return null;
  }

  function renderReadout() {
    const model = controller.derived;
    if (!readout || !model) return;
    const description = model.describe();
    const text = description ? description.text : 'Элемент не выбран.';
    if (readout.textContent !== text) readout.textContent = text;
  }

  function field(label) {
    const wrapper = createElement(doc, 'label', { class: 'chart-ui-panel-field' });
    append(wrapper, createElement(doc, 'span', {}, label));
    return wrapper;
  }

  function render() {
    if (destroyed) return;
    const previousKey = focusedKey();
    clearElement(body);
    focusables.clear();
    readout = null;
    const model = controller.derived;
    renderedModel = model;
    renderedSignature = model ? signatureOf(model) : null;
    if (!model) {
      append(body, createElement(doc, 'p', {}, 'Производный вид не задан.'));
      return;
    }
    const view = model.view;
    const options = controller.options;
    const buttonClass = 'chart-ui-btn chart-ui-surface-btn chart-ui-panel-btn';
    append(body, createElement(doc, 'h3', { class: 'chart-ui-panel-title' }, `Производный вид: ${view.name}`));

    const viewRow = field('Вид графика');
    const viewSelect = createElement(doc, 'select', { name: 'derivedView', class: 'chart-ui-select', 'aria-label': 'Вид графика (производный)' });
    for (const kind of options.derivedKinds || DEFAULT_KINDS) {
      const option = createElement(doc, 'option', { value: kind.id }, kind.label);
      if (kind.id === view.kind) option.setAttribute('selected', '');
      append(viewSelect, option);
    }
    viewSelect.value = view.kind;
    focusables.set('view', viewSelect);
    let viewReason = null;
    if (typeof options.onDerivedViewChange !== 'function') {
      viewSelect.setAttribute('disabled', '');
      viewSelect.setAttribute('aria-disabled', 'true');
      viewSelect.setAttribute('title', 'Смена производного вида не подключена');
      viewSelect.setAttribute('aria-describedby', `${uid}-view-reason`);
      viewReason = createElement(doc, 'span', { id: `${uid}-view-reason`, class: 'chart-ui-sr' }, 'Смена производного вида не подключена');
    } else {
      viewSelect.addEventListener('change', () => {
        try {
          options.onDerivedViewChange(viewSelect.value);
          controller.announce(`Выбран вид: ${viewSelect.value}`);
        } catch (error) {
          controller.announce(`Вид не изменён: ${error.message}`, { error: true });
        }
      });
    }
    append(viewRow, viewSelect, viewReason);
    append(body, viewRow);
    append(body, createElement(doc, 'p', { class: 'chart-ui-panel-params' }, view.parametersText || 'Параметры не заданы'));

    const controls = createElement(doc, 'div', {
      class: 'chart-ui-group chart-ui-panel-controls',
      role: 'group',
      'aria-label': 'Управление производным видом',
    });
    const prev = createElement(doc, 'button', { type: 'button', class: buttonClass }, 'Предыдущий элемент');
    prev.addEventListener('click', () => {
      const result = model.prev();
      if (!result.ok) controller.announce('Предыдущего элемента нет');
      renderReadout();
    });
    const next = createElement(doc, 'button', { type: 'button', class: buttonClass }, 'Следующий элемент');
    next.addEventListener('click', () => {
      const result = model.next();
      if (!result.ok) controller.announce('Следующего элемента нет');
      renderReadout();
    });
    const visibility = createElement(
      doc,
      'button',
      { type: 'button', class: buttonClass, 'aria-pressed': model.visible ? 'true' : 'false' },
      model.visible ? 'Скрыть метки' : 'Показать метки',
    );
    visibility.addEventListener('click', () => {
      model.setVisible(!model.visible);
      render();
    });
    focusables.set('prev', prev);
    focusables.set('next', next);
    focusables.set('visible', visibility);
    append(controls, prev, next, visibility);
    append(body, controls);

    const inputs = createElement(doc, 'div', { class: 'chart-ui-panel-inputs' });
    const colorLabel = field('Цвет элементов');
    const colorInput = createElement(doc, 'input', { type: 'text', name: 'color', class: 'chart-ui-panel-input', 'aria-label': 'Цвет элементов' });
    colorInput.value = model.color || '';
    const colorApply = createElement(doc, 'button', { type: 'button', class: buttonClass }, 'Применить цвет');
    colorApply.addEventListener('click', () => {
      const result = model.setColor(colorInput.value);
      if (!result.ok) {
        controller.announce('Цвет отклонён: недопустимое значение', { error: true });
        return;
      }
      controller.clearError();
      controller.announce(`Цвет элементов: ${result.color}`);
      render();
    });
    focusables.set('color', colorInput);
    focusables.set('colorApply', colorApply);
    append(colorLabel, colorInput);
    append(colorLabel, colorApply);
    append(inputs, colorLabel);

    const parameterInputs = [];
    for (const [name, value] of Object.entries(view.parameters || {})) {
      const label = field(name);
      const input = createElement(doc, 'input', { type: 'number', name, class: 'chart-ui-panel-input', 'aria-label': `Параметр ${name}` });
      input.value = String(value);
      parameterInputs.push({ name, input });
      focusables.set(`parameter:${name}`, input);
      append(label, input);
      append(inputs, label);
    }
    const apply = createElement(doc, 'button', { type: 'button', class: buttonClass }, 'Применить параметры');
    apply.addEventListener('click', () => {
      const parameters = { ...view.parameters };
      for (const { name, input } of parameterInputs) {
        const numeric = Number(input.value);
        if (input.value !== '' && !Number.isNaN(numeric)) parameters[name] = numeric;
      }
      const result = model.setParameters(parameters);
      if (!result.ok) {
        controller.announce(`Параметры отклонены: ${result.message || 'недопустимое значение'}`, { error: true });
        return;
      }
      controller.clearError();
      controller.announce('Параметры применены');
      render();
    });
    focusables.set('apply', apply);
    append(inputs, apply);
    append(body, inputs);

    readout = createElement(doc, 'div', { class: 'chart-ui-panel-readout', 'aria-live': 'polite' });
    append(body, readout);
    renderReadout();

    if (previousKey) {
      const target = focusables.get(previousKey);
      if (target && !target.hasAttribute('disabled')) focusElement(target);
      else focusElement(element);
    }
  }

  function onDerived() {
    if (destroyed) return;
    const model = controller.derived;
    if (model !== renderedModel || (model && signatureOf(model) !== renderedSignature)) render();
    else renderReadout();
  }

  render();
  const unsubscribe = controller.subscribe('derived', onDerived);

  return {
    element,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      focusables.clear();
      readout = null;
      renderedModel = null;
    },
  };
}
