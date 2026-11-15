/**
 * The drawing settings dialog: a modal `<dialog>` built from the settings model's description of the selection.
 *
 * It owns no knowledge of tools: tabs, groups and controls come from `describeDrawingSettings`, edits stay in a
 * draft until Apply, and Apply goes through `applyDrawingSettings`, so it is one undo step and every refusal of the
 * model or the store is shown next to the field that caused it. Escape, the close button and the backdrop dismiss
 * without applying; focus returns to the element that opened it.
 */
import { InteractionError } from '../interaction/errors.js';
import { createElement, append, clearElement, on, focusElement, contains } from '../interaction/dom.js';
import { fibDefaultLevels } from '../drawings/tools.js';
import { t, localeOf } from './messages.js';
import {
  describeDrawingSettings, applyDrawingSettings, applySavedDrawingStyle, saveDrawingStyle, planDrawingStyle,
} from './drawing-settings/index.js';

let counter = 0;

const HEX = /^#[0-9a-f]{6}$/i;
const clone = (value) => (value === undefined ? value : structuredClone(value));

/**
 * @param {object} options
 * @param {object} options.chart a chart with a `drawings` store
 * @param {Document} options.doc
 * @param {HTMLElement} options.host element the dialog is appended to
 * @param {{ subscribe: Function }} [options.interaction] source of `drawingActivate`
 * @param {(text: string, options?: { error?: boolean }) => void} [options.announce]
 * @param {() => (object|null)} [options.sharedStyle] the host's shared style, when it has one
 */
export function createDrawingSettingsDialog({ chart, doc, host, interaction = null, announce = () => {}, sharedStyle = null }) {
  const store = chart?.drawings;
  const tr = (key, params) => t(localeOf(chart), `drawingSettings.dialog.${key}`, params);
  if (!store || typeof store.updateBatch !== 'function' || typeof store.get !== 'function') {
    throw new InteractionError(t(localeOf(chart), 'drawingSettings.dialog.unavailable'), { code: 'DRAWINGS_UNAVAILABLE', field: 'drawings' });
  }
  const prefix = `chart-drawing-settings-${(counter += 1)}`;
  const disposers = [];
  let dialog = null;
  let titleNode = null;
  let tablist = null;
  let panel = null;
  let banner = null;
  let footer = null;
  let applyButton = null;
  let closeButton = null;
  let cancelButton = null;
  let session = null;
  let unsubscribeStore = null;
  let applying = false;
  let destroyed = false;
  let uid = 0;
  const nextId = (kind) => `${prefix}-${kind}-${(uid += 1)}`;

  /** The first control built for a field in the open panel, found without a selector engine. */
  function findField(fieldId) {
    const visit = (node) => {
      if (node.getAttribute?.('data-field') === fieldId) return node;
      for (const child of node.children ?? []) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return panel ? visit(panel) : null;
  }

  const context = () => ({
    priceScaleMode: (paneId, scaleId) => {
      try { return chart.priceScale(paneId, scaleId).mode; } catch { return 'linear'; }
    },
    // The layout carries the effective lock, including locks inherited from groups.
    isLocked: (drawing) => {
      try { return store.layout(drawing.id).locked === true; } catch { return drawing.locked === true; }
    },
  });

  function liveDrawings() {
    const drawings = [];
    const missing = [];
    for (const id of session.ids) {
      try { drawings.push(store.get(id)); } catch { missing.push(id); }
    }
    return { drawings, missing };
  }

  /* ------------------------------- construction ------------------------------- */
  function ensureDialog() {
    if (dialog) return;
    const candidate = createElement(doc, 'dialog', { class: 'chart-ui-dialog chart-drawing-settings', 'aria-labelledby': `${prefix}-title` });
    if (typeof candidate.showModal !== 'function') {
      throw new InteractionError(t(localeOf(chart), 'settings.dialogUnsupported'), { code: 'UNSUPPORTED_DOM', field: 'dialog' });
    }
    const frame = createElement(doc, 'form', { class: 'chart-drawing-settings-frame', novalidate: true });
    const head = createElement(doc, 'div', { class: 'chart-drawing-settings-head' });
    titleNode = createElement(doc, 'h2', { id: `${prefix}-title`, class: 'chart-drawing-settings-title' });
    closeButton = createElement(doc, 'button', { type: 'button', class: 'chart-ui-btn chart-ui-surface-btn', 'data-settings-action': 'close' });
    append(head, titleNode, closeButton);
    tablist = createElement(doc, 'div', { role: 'tablist', class: 'chart-drawing-settings-tabs' });
    banner = createElement(doc, 'p', { class: 'chart-drawing-settings-banner', role: 'alert', hidden: true });
    panel = createElement(doc, 'div', { role: 'tabpanel', class: 'chart-drawing-settings-panel' });
    footer = createElement(doc, 'div', { class: 'chart-drawing-settings-footer' });
    applyButton = createElement(doc, 'button', { type: 'submit', class: 'chart-ui-btn chart-ui-surface-btn', 'data-settings-action': 'apply' });
    cancelButton = createElement(doc, 'button', { type: 'button', class: 'chart-ui-btn chart-ui-surface-btn', 'data-settings-action': 'cancel' });
    append(footer, applyButton, cancelButton);
    append(frame, head, tablist, banner, panel, footer);
    append(candidate, frame);
    append(host, candidate);
    dialog = candidate;
    closeButton.setAttribute('aria-label', tr('close'));
    closeButton.textContent = '×';
    disposers.push(on(closeButton, 'click', () => close()));
    disposers.push(on(cancelButton, 'click', () => close()));
    disposers.push(on(frame, 'submit', (event) => { event.preventDefault(); applyDrafts(); }));
    // Backdrop clicks land on the dialog element itself; the frame fills the rest.
    disposers.push(on(dialog, 'click', (event) => { if (event.target === dialog) close(); }));
    // `close` fires for every way out (button, Escape, backdrop, apply), so cleanup lives in one place.
    disposers.push(on(dialog, 'close', onClosed));
    disposers.push(on(tablist, 'keydown', onTabKey));
  }

  /* ---------------------------------- opening --------------------------------- */
  function open(ids, invoker = null) {
    if (destroyed) throw new InteractionError('The settings dialog has been destroyed', { code: 'UI_DESTROYED', field: 'dialog' });
    ensureDialog();
    // Activating again while open reuses the same dialog: one element, one subscription.
    const reuse = session !== null;
    session = {
      ids: [...ids],
      drafts: new Map(),
      errors: new Map(),
      activeTab: reuse ? session.activeTab : null,
      // Opened from code nothing holds focus (the body does): the chart region is where focus belongs afterwards.
      invoker: reuse ? session.invoker : ((invoker && invoker !== doc.body ? invoker : doc.activeElement !== doc.body ? doc.activeElement : null) ?? chart.container),
    };
    unsubscribeStore ??= store.subscribe?.(onStoreChange) ?? null;
    render();
    if (!dialog.open) dialog.showModal();
    focusActiveTab();
  }

  /* --------------------------------- rendering -------------------------------- */
  function describe() {
    const { drawings, missing } = liveDrawings();
    if (drawings.length === 0) return { description: null, missing, drawings };
    return { description: describeDrawingSettings({ drawings, locale: localeOf(chart), context: context() }), missing, drawings };
  }

  function titleFor(description) {
    if (!description) return tr('titleMany', { count: session.ids.length });
    return description.count === 1
      ? tr('titleOne', { tool: t(localeOf(chart), `tool.${description.types[0]}`) })
      : tr('titleMany', { count: description.count });
  }

  function render() {
    const focusKey = dialog && doc.activeElement && contains(dialog, doc.activeElement) ? doc.activeElement.getAttribute?.('data-field') : null;
    const { description, missing, drawings } = describe();
    titleNode.textContent = titleFor(description);
    applyButton.textContent = tr('apply');
    cancelButton.textContent = tr('cancel');
    closeButton.setAttribute('aria-label', tr('close'));
    clearElement(tablist);
    clearElement(panel);
    session.view = { description, drawings };
    if (missing.length > 0) {
      showBanner(missing.map((id) => tr('removed', { id })).join('; '));
    } else if (!session.bannerSticky) {
      hideBanner();
    }
    if (!description) {
      applyButton.setAttribute('disabled', '');
      return;
    }
    if (!session.activeTab || !description.tabs.some((tab) => tab.id === session.activeTab)) session.activeTab = description.tabs[0]?.id ?? null;
    tablist.setAttribute('aria-label', tr('tabs'));
    for (const tab of description.tabs) {
      const selected = tab.id === session.activeTab;
      const button = createElement(doc, 'button', {
        type: 'button', role: 'tab', id: `${prefix}-tab-${tab.id}`, 'aria-selected': String(selected),
        'aria-controls': `${prefix}-panel`, tabindex: selected ? '0' : '-1', 'data-tab': tab.id, class: 'chart-drawing-settings-tab',
      }, tab.label);
      disposers.push(on(button, 'click', () => selectTab(tab.id)));
      append(tablist, button);
    }
    panel.setAttribute('id', `${prefix}-panel`);
    panel.setAttribute('aria-labelledby', `${prefix}-tab-${session.activeTab}`);
    const active = description.tabs.find((tab) => tab.id === session.activeTab);
    if (description.locked) {
      append(panel, createElement(doc, 'p', { class: 'chart-drawing-settings-note', 'data-locked-note': true }, tr('lockedNote')));
    }
    for (const group of active?.groups ?? []) append(panel, renderGroup(group));
    if (active?.id === 'style') append(panel, renderStyleTools(description, drawings));
    if (description.locked) applyButton.setAttribute('disabled', ''); else applyButton.removeAttribute('disabled');
    if (focusKey) {
      focusElement(findField(focusKey));
    }
  }

  function renderGroup(group) {
    const fieldset = createElement(doc, 'fieldset', { class: 'chart-drawing-settings-group', 'data-group': group.id });
    append(fieldset, createElement(doc, 'legend', {}, group.label));
    for (const field of group.fields) append(fieldset, renderField(field));
    return fieldset;
  }

  function currentValue(field) {
    return session.drafts.has(field.id) ? { value: session.drafts.get(field.id), mixed: false } : { value: field.value, mixed: field.mixed };
  }

  function setDraft(field, value) {
    session.drafts.set(field.id, value);
    session.errors.delete(field.id);
  }

  function errorNode(field, id) {
    const node = createElement(doc, 'p', { id, class: 'chart-drawing-settings-error', 'data-error-for': field.id, hidden: !session.errors.has(field.id) });
    if (session.errors.has(field.id)) node.textContent = session.errors.get(field.id);
    return node;
  }

  function wire(control, field, errorId, extra = {}) {
    control.setAttribute('data-field', field.id);
    if (!field.enabled) control.setAttribute('disabled', '');
    if (session.errors.has(field.id)) {
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', errorId);
    }
    for (const [name, value] of Object.entries(extra)) control.setAttribute(name, value);
  }

  function reasonNode(field) {
    return field.enabled || !field.reason ? null : createElement(doc, 'span', { class: 'chart-drawing-settings-reason' }, field.reason);
  }

  function renderField(field) {
    const row = createElement(doc, 'div', { class: `chart-drawing-settings-field chart-drawing-settings-${field.type}`, 'data-field-row': field.id });
    const inputId = nextId('field');
    const errorId = `${inputId}-error`;
    const { value, mixed } = currentValue(field);
    const label = createElement(doc, 'label', { for: inputId, class: 'chart-drawing-settings-label' }, field.label);
    if (field.type === 'boolean') {
      const box = createElement(doc, 'input', { type: 'checkbox', id: inputId });
      box.checked = value === true;
      box.indeterminate = mixed;
      wire(box, field, errorId);
      disposers.push(on(box, 'change', () => { box.indeterminate = false; setDraft(field, box.checked); }));
      append(row, box, label);
    } else if (field.type === 'select') {
      const select = createElement(doc, 'select', { id: inputId });
      if (mixed) append(select, createElement(doc, 'option', { value: '', disabled: true, selected: true }, tr('mixed')));
      for (const option of field.limits.options) append(select, createElement(doc, 'option', { value: String(option.value) }, option.label));
      if (!mixed) select.value = String(value);
      wire(select, field, errorId);
      disposers.push(on(select, 'change', () => {
        const picked = field.limits.options.find((option) => String(option.value) === select.value);
        if (picked) setDraft(field, picked.value);
      }));
      append(row, label, select);
    } else if (field.type === 'number') {
      const input = createElement(doc, 'input', { type: 'number', id: inputId, min: field.limits.min, max: field.limits.max, step: field.limits.step });
      input.value = mixed ? '' : String(value);
      if (mixed) input.setAttribute('placeholder', tr('mixed'));
      wire(input, field, errorId);
      disposers.push(on(input, 'input', () => setDraft(field, input.value === '' ? Number.NaN : Number(input.value))));
      append(row, label, input);
    } else if (field.type === 'color') {
      const input = createElement(doc, 'input', { type: 'text', id: inputId, spellcheck: 'false', autocomplete: 'off' });
      input.value = mixed ? '' : String(value);
      if (mixed) input.setAttribute('placeholder', tr('mixed'));
      wire(input, field, errorId);
      const swatch = createElement(doc, 'input', { type: 'color', 'aria-label': tr('swatch', { label: field.label }), class: 'chart-drawing-settings-swatch' });
      swatch.value = HEX.test(input.value) ? input.value : '#000000';
      if (!field.enabled) swatch.setAttribute('disabled', '');
      disposers.push(on(input, 'input', () => { setDraft(field, input.value); if (HEX.test(input.value)) swatch.value = input.value; }));
      disposers.push(on(swatch, 'input', () => { input.value = swatch.value; setDraft(field, swatch.value); }));
      append(row, label, input, swatch);
    } else if (field.type === 'text') {
      const multiline = field.limits?.multiline === true;
      const input = createElement(doc, multiline ? 'textarea' : 'input', { id: inputId, ...(multiline ? { rows: 3 } : { type: 'text' }) });
      input.value = mixed ? '' : String(value);
      if (mixed) input.setAttribute('placeholder', tr('mixed'));
      wire(input, field, errorId);
      disposers.push(on(input, 'input', () => setDraft(field, input.value)));
      append(row, label, input);
    } else if (field.type === 'levels') {
      return renderLevels(field, value, errorId);
    } else if (field.type === 'anchors') {
      return renderAnchors(field, value, errorId);
    }
    append(row, reasonNode(field), errorNode(field, errorId));
    return row;
  }

  /* --------------------------- level and anchor editors --------------------------- */
  function renderLevels(field, initial, errorId) {
    const wrapper = createElement(doc, 'div', { class: 'chart-drawing-settings-field chart-drawing-settings-levels', 'data-field-row': field.id });
    const tool = session.view.drawings[0].type;
    const rows = createElement(doc, 'div', { class: 'chart-drawing-settings-level-rows' });
    let levels = clone(initial);

    function commit() { setDraft(field, clone(levels)); }

    function rebuild(focusIndex = null) {
      clearElement(rows);
      levels.forEach((level, index) => {
        const n = index + 1;
        const item = createElement(doc, 'div', { class: 'chart-drawing-settings-level', role: 'group', 'aria-label': `${field.label} ${n}` });
        const visible = createElement(doc, 'input', { type: 'checkbox', 'aria-label': tr('levelVisible', { n }), 'data-field': field.id });
        visible.checked = level.visible !== false;
        const coefficient = createElement(doc, 'input', { type: 'number', step: 'any', 'aria-label': tr('levelCoefficient', { n }), 'data-field': field.id });
        coefficient.value = String(level.coefficient);
        const label = createElement(doc, 'input', { type: 'text', 'aria-label': tr('levelLabel', { n }), 'data-field': field.id });
        label.value = level.label ?? '';
        const colour = createElement(doc, 'input', { type: 'text', placeholder: tr('levelInherit'), 'aria-label': tr('levelColor', { n }), 'data-field': field.id });
        colour.value = level.color ?? '';
        const opacity = createElement(doc, 'input', { type: 'number', min: 0, max: 1, step: 0.05, 'aria-label': tr('levelOpacity', { n }), 'data-field': field.id });
        opacity.value = String(level.opacity ?? 1);
        const remove = createElement(doc, 'button', { type: 'button', class: 'chart-ui-btn chart-ui-surface-btn', 'aria-label': tr('levelRemove', { n }), 'data-field': field.id }, '−');
        const controls = [visible, coefficient, label, colour, opacity, remove];
        if (!field.enabled) for (const control of controls) control.setAttribute('disabled', '');
        disposers.push(on(visible, 'change', () => { levels[index].visible = visible.checked; commit(); }));
        disposers.push(on(coefficient, 'input', () => { levels[index].coefficient = coefficient.value === '' ? Number.NaN : Number(coefficient.value); commit(); }));
        disposers.push(on(label, 'input', () => {
          if (label.value === '') delete levels[index].label; else levels[index].label = label.value;
          commit();
        }));
        disposers.push(on(colour, 'input', () => {
          if (colour.value === '') delete levels[index].color; else levels[index].color = colour.value;
          commit();
        }));
        disposers.push(on(opacity, 'input', () => { levels[index].opacity = opacity.value === '' ? Number.NaN : Number(opacity.value); commit(); }));
        disposers.push(on(remove, 'click', () => { levels.splice(index, 1); commit(); rebuild(Math.min(index, levels.length - 1)); }));
        append(item, visible, coefficient, label, colour, opacity, remove);
        append(rows, item);
      });
      if (focusIndex !== null && focusIndex >= 0) focusElement(rows.children[focusIndex]?.children[1]);
    }
    rebuild();

    const add = createElement(doc, 'button', { type: 'button', class: 'chart-ui-btn chart-ui-surface-btn', 'data-field': field.id }, tr('levelAdd'));
    const reset = createElement(doc, 'button', { type: 'button', class: 'chart-ui-btn chart-ui-surface-btn', 'data-field': field.id }, tr('levelReset'));
    if (!field.enabled) { add.setAttribute('disabled', ''); reset.setAttribute('disabled', ''); }
    disposers.push(on(add, 'click', () => {
      // A new coefficient the list does not have yet; the model refuses duplicates when applying.
      const next = levels.reduce((max, level) => Math.max(max, Number.isFinite(level.coefficient) ? level.coefficient : 0), 0) + 1;
      levels.push({ coefficient: Number(next.toPrecision(12)), visible: true, opacity: 1 });
      commit();
      rebuild(levels.length - 1);
    }));
    disposers.push(on(reset, 'click', () => { levels = fibDefaultLevels(tool); commit(); rebuild(0); }));
    // Column captions for sighted users; each control still carries its own full accessible name.
    const head = createElement(doc, 'div', { class: 'chart-drawing-settings-level chart-drawing-settings-level-head', 'aria-hidden': 'true' });
    for (const key of ['colVisible', 'colCoefficient', 'colLabel', 'colColor', 'colOpacity']) append(head, createElement(doc, 'span', {}, tr(key)));
    append(wrapper, createElement(doc, 'span', { class: 'chart-drawing-settings-label', id: `${errorId}-label` }, field.label), head, rows, add, reset, reasonNode(field), errorNode(field, errorId));
    return wrapper;
  }

  function renderAnchors(field, initial, errorId) {
    const wrapper = createElement(doc, 'div', { class: 'chart-drawing-settings-field chart-drawing-settings-anchors', 'data-field-row': field.id });
    let anchors = clone(initial);
    const commit = () => setDraft(field, clone(anchors));
    anchors.forEach((anchor, index) => {
      const n = index + 1;
      const item = createElement(doc, 'div', { class: 'chart-drawing-settings-anchor', role: 'group', 'aria-label': tr('anchorTitle', { n }) });
      if (anchor.anchorBarId !== undefined) {
        const bar = createElement(doc, 'input', { type: 'text', readonly: true, 'aria-label': tr('anchorBar', { n }), 'data-field': field.id });
        bar.value = anchor.anchorBarId;
        append(item, bar);
      }
      if (field.limits.offset) {
        const offset = createElement(doc, 'input', { type: 'number', step: 'any', 'aria-label': tr('anchorOffset', { n }), 'data-field': field.id });
        offset.value = String(anchor.offset);
        if (!field.enabled) offset.setAttribute('disabled', '');
        disposers.push(on(offset, 'input', () => { anchors[index].offset = offset.value === '' ? Number.NaN : Number(offset.value); commit(); }));
        append(item, offset);
      }
      if (field.limits.price) {
        const price = createElement(doc, 'input', { type: 'number', step: 'any', 'aria-label': tr('anchorPrice', { n }), 'data-field': field.id });
        price.value = String(anchor.price);
        if (!field.enabled) price.setAttribute('disabled', '');
        if (session.errors.has(field.id)) { price.setAttribute('aria-describedby', errorId); }
        disposers.push(on(price, 'input', () => { anchors[index].price = price.value === '' ? Number.NaN : Number(price.value); commit(); }));
        append(item, price);
      }
      append(wrapper, item);
    });
    append(wrapper, reasonNode(field), errorNode(field, errorId));
    return wrapper;
  }

  /* ------------------------------ saved and shared styles ----------------------------- */
  function renderStyleTools(description, drawings) {
    const section = createElement(doc, 'fieldset', { class: 'chart-drawing-settings-group chart-drawing-settings-saved', 'data-group': 'saved' });
    append(section, createElement(doc, 'legend', {}, tr('savedStyles')));
    const single = description.types.length === 1;
    const saved = single ? store.listStyles(description.types[0]) : [];
    const selectId = nextId('saved');
    const select = createElement(doc, 'select', { id: selectId, 'data-field': 'saved-style' });
    if (saved.length === 0) append(select, createElement(doc, 'option', { value: '', disabled: true, selected: true }, tr('noSaved')));
    for (const entry of saved) append(select, createElement(doc, 'option', { value: entry.id }, entry.name));
    const applySaved = createElement(doc, 'button', { type: 'button', class: 'chart-ui-btn chart-ui-surface-btn', 'data-settings-action': 'apply-saved' }, tr('applySaved'));
    if (saved.length === 0 || description.locked) applySaved.setAttribute('disabled', '');
    if (description.locked) select.setAttribute('disabled', '');
    disposers.push(on(applySaved, 'click', () => runAction(() => {
      applySavedDrawingStyle(store, session.ids, select.value);
      return tr('savedApplied');
    })));
    append(section, createElement(doc, 'label', { for: selectId }, tr('savedStyle')), select, applySaved);

    const nameId = nextId('name');
    const name = createElement(doc, 'input', { type: 'text', id: nameId, 'data-field': 'style-name' });
    const save = createElement(doc, 'button', { type: 'button', class: 'chart-ui-btn chart-ui-surface-btn', 'data-settings-action': 'save-style' }, tr('saveStyle'));
    if (description.count !== 1) {
      name.setAttribute('disabled', '');
      save.setAttribute('disabled', '');
      append(section, createElement(doc, 'p', { class: 'chart-drawing-settings-note' }, tr('saveOne')));
    }
    disposers.push(on(save, 'click', () => runAction(() => {
      const entry = saveDrawingStyle(store, session.ids[0], name.value);
      return { text: tr('savedAs', { name: entry.name }), keepOpen: true };
    })));
    append(section, createElement(doc, 'label', { for: nameId }, tr('styleName')), name, save);

    const shared = typeof sharedStyle === 'function' ? sharedStyle() : null;
    if (shared && drawings.some((drawing) => drawing.ownStyle === true)) {
      const back = createElement(doc, 'button', { type: 'button', class: 'chart-ui-btn chart-ui-surface-btn', 'data-settings-action': 'use-shared' }, tr('shared'));
      if (description.locked) back.setAttribute('disabled', '');
      disposers.push(on(back, 'click', () => runAction(() => {
        const plan = planDrawingStyle(drawings, shared, { includeOwn: true, ownStyle: false, groups: store.listGroups?.() ?? [] });
        if (plan.skippedLocked.length > 0) {
          throw Object.assign(new Error(t(localeOf(chart), 'drawingSettings.reason.locked')), { code: 'locked' });
        }
        store.updateBatch(plan.updates);
        return tr('sharedApplied');
      })));
      append(section, back);
    }
    return section;
  }

  /* ---------------------------------- behaviour ---------------------------------- */
  function selectTab(id) {
    session.activeTab = id;
    render();
    focusActiveTab();
  }

  function focusActiveTab() {
    for (const node of tablist.children) if (node.getAttribute('aria-selected') === 'true') { focusElement(node); return; }
    focusElement(applyButton);
  }

  function onTabKey(event) {
    const tabs = [...tablist.children];
    const index = tabs.findIndex((node) => node === doc.activeElement);
    if (index < 0) return;
    let next = null;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    selectTab(tabs[next].getAttribute('data-tab'));
  }

  function showBanner(text) {
    banner.textContent = text;
    banner.removeAttribute('hidden');
  }
  function hideBanner() {
    banner.textContent = '';
    banner.setAttribute('hidden', '');
  }

  /** Shows a failure next to the field that caused it, or in the banner when it belongs to none. */
  function report(error) {
    const message = error?.message ?? String(error);
    const text = tr('failed', { message });
    const fieldId = typeof error?.field === 'string' ? error.field : null;
    session.bannerSticky = false;
    if (fieldId && session.view?.description?.tabs.some((tab) => tab.groups.some((group) => group.fields.some((field) => field.id === fieldId)))) {
      session.errors.set(fieldId, message);
      const tab = session.view.description.tabs.find((entry) => entry.groups.some((group) => group.fields.some((field) => field.id === fieldId)));
      if (tab) session.activeTab = tab.id;
      render();
      focusElement(findField(fieldId));
    } else if (error?.code === 'unknown-drawing') {
      showBanner(tr('removed', { id: error.id ?? '' }));
    } else {
      showBanner(text);
    }
    announce(text, { error: true });
  }

  function runAction(fn) {
    if (!session) return;
    applying = true;
    try {
      const result = fn();
      const outcome = typeof result === 'string' ? { text: result } : result;
      announce(outcome.text);
      if (outcome.keepOpen) render(); else close();
    } catch (error) {
      report(error);
    } finally {
      applying = false;
    }
  }

  function applyDrafts() {
    if (!session) return;
    const changes = [...session.drafts].map(([fieldId, value]) => ({ fieldId, value }));
    if (changes.length === 0) {
      announce(tr('noChanges'));
      return;
    }
    runAction(() => {
      applyDrawingSettings(store, { ids: session.ids, changes, context: context() });
      return tr('applied');
    });
  }

  function onStoreChange() {
    if (!session || applying) return;
    // External edits are reflected right away; drafts stay, and a removed drawing is reported, never recreated.
    render();
  }

  function onClosed() {
    // A queued close event can arrive after the same dialog has been reopened.
    if (dialog?.open) return;
    const invoker = session?.invoker;
    unsubscribeStore?.();
    unsubscribeStore = null;
    session = null;
    const target = invoker && invoker.isConnected !== false ? invoker : chart.container;
    focusElement(target);
  }

  function close() {
    if (dialog?.open) dialog.close();
    else if (session) onClosed();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    unsubscribeStore?.();
    unsubscribeStore = null;
    for (const dispose of disposers.splice(0)) dispose();
    session = null;
    if (dialog) {
      if (dialog.open) dialog.close();
      if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
    }
    dialog = null;
    unsubscribeActivation?.();
  }

  let unsubscribeActivation = null;
  if (interaction && typeof interaction.subscribe === 'function') {
    unsubscribeActivation = interaction.subscribe('drawingActivate', (event) => {
      try { open(event.drawingIds, doc.activeElement); } catch (error) { announce(error.message, { error: true }); }
    });
  }

  return {
    open: (ids, invoker) => open(ids, invoker),
    close,
    destroy,
    get isOpen() { return Boolean(dialog?.open); },
    get element() { return dialog; },
  };
}
