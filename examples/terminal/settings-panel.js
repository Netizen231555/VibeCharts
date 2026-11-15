// The settings dialog of the terminal example: tabs of colour, number, toggle and select controls that edit the
// settings store, plus a section that restyles the selected drawings. Controls write to the store as the user drags
// (the host applies it live); the dialog itself is re-rendered only on structural changes (tab, theme, reset, import,
// selection), never while a colour is being dragged. It is not modal: the chart behind it stays usable, so a drawing
// can be selected and restyled while the dialog is open.
import { TABS, FIELDS, DRAWING_FIELDS } from './settings-model.js';
import { planDrawingStyle } from 'vibecharts/ui';

const PRESETS = {
  classic: { up: '#3fa77f', down: '#d9645a', volumeUp: '#089981', volumeDown: '#f23645' },
  safe: { up: '#4a9fd0', down: '#e0a84a', volumeUp: '#4a9fd0', volumeDown: '#e0a84a' },
  mono: { up: '#d0d7de', down: '#6b7785', volumeUp: '#d0d7de', volumeDown: '#6b7785' },
};

const toHexContext = document.createElement('canvas').getContext('2d');
/** A colour string in any CSS notation as #rrggbb (the colour input accepts nothing else). */
function toHex(color) {
  toHexContext.fillStyle = '#000000';
  toHexContext.fillStyle = color;
  const resolved = toHexContext.fillStyle;
  return /^#[0-9a-f]{6}$/i.test(resolved) ? resolved : '#000000';
}

function element(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (value !== undefined && value !== false) node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children);
  return node;
}

export function createSettingsPanel({ settings, t, getTheme, setTheme, getChart, button, onError, onAnnounce }) {
  let activeTab = 'chart';
  const dialog = element('div', { class: 'settings-dialog', role: 'dialog', 'aria-label': t('settings.title'), hidden: true });
  const themeGroup = element('div', { class: 'settings-themes', role: 'group', 'aria-label': t('settings.theme') });
  const tablist = element('div', { class: 'settings-tabs', role: 'tablist' });
  const body = element('div', { class: 'settings-body', role: 'tabpanel' });
  const fileInput = element('input', { type: 'file', accept: 'application/json', hidden: true });
  const close = element('button', { type: 'button', class: 'settings-close', 'aria-label': t('settings.close'), title: t('settings.close') }, '×');
  const fail = (key) => (error) => onError(t(key, { message: error.message }));

  /* ------------------------------ controls ------------------------------ */
  function control(field, labelText, value, { onInput, onChange }) {
    const id = `settings-${field.key.replace(/\W/g, '-')}-${Math.random().toString(36).slice(2, 7)}`;
    const label = element('label', { class: `field field-${field.type}`, for: id }, element('span', {}, labelText));
    let input;
    if (field.type === 'select') {
      input = element('select', { id, 'data-key': field.key });
      for (const option of field.options) input.append(element('option', { value: option }, t(`settings.opt.${option}`)));
      input.value = value;
      input.addEventListener('change', () => onChange(input.value));
    } else if (field.type === 'bool') {
      input = element('input', { id, type: 'checkbox', 'data-key': field.key });
      input.checked = value;
      input.addEventListener('change', () => onChange(input.checked));
    } else if (field.type === 'number') {
      input = element('input', { id, type: 'range', min: field.min, max: field.max, step: field.step, 'data-key': field.key });
      input.value = String(value);
      const output = element('output', { for: id }, String(value));
      input.addEventListener('input', () => { output.textContent = input.value; onInput?.(Number(input.value)); });
      input.addEventListener('change', () => onChange(Number(input.value)));
      label.append(input, output);
      return label;
    } else {
      input = element('input', { id, type: 'color', 'data-key': field.key });
      input.value = toHex(value);
      input.addEventListener('input', () => onInput?.(input.value));
      input.addEventListener('change', () => onChange(input.value));
    }
    label.append(input);
    return label;
  }

  function section(title, ...children) {
    return element('section', { class: 'settings-section' }, element('h3', {}, title), ...children);
  }

  /* --------------------------- theme-bound tabs --------------------------- */
  function themeField(field) {
    const theme = getTheme();
    const value = settings.values(theme)[field.key];
    const write = (next) => {
      try { settings.set(theme, field.key, next); } catch (error) { fail('settings.error.save')(error); }
    };
    return control(field, t(`settings.f.${field.key}`), value, {
      onInput: field.type === 'color' ? write : undefined,
      onChange: (next) => {
        write(next);
        if (field.key === 'candle.linked') renderBody();
      },
    });
  }

  function presetControl() {
    const select = element('select', { 'aria-label': t('settings.presets') });
    select.append(element('option', { value: '' }, t('settings.preset.none')));
    for (const name of Object.keys(PRESETS)) select.append(element('option', { value: name }, t(`settings.preset.${name}`)));
    select.addEventListener('change', () => {
      const preset = PRESETS[select.value];
      if (!preset) return;
      const theme = getTheme();
      try {
        for (const [key, value] of Object.entries({
          'candle.up': preset.up, 'candle.down': preset.down, 'candle.borderUp': preset.up, 'candle.borderDown': preset.down,
          'candle.wickUp': preset.up, 'candle.wickDown': preset.down, 'volume.up': preset.volumeUp, 'volume.down': preset.volumeDown,
        })) settings.set(theme, key, value);
      } catch (error) { fail('settings.error.save')(error); }
      renderBody();
    });
    return element('label', { class: 'field field-select' }, element('span', {}, t('settings.presets')), select);
  }

  function renderThemeTab(tab) {
    const values = settings.values(getTheme());
    const fields = FIELDS.filter((field) => field.tab === tab && !(field.unlessLinked && values['candle.linked']));
    const nodes = fields.map(themeField);
    if (tab === 'candles') nodes.unshift(presetControl());
    body.replaceChildren(section(t(`settings.tab.${tab}`), ...nodes));
  }

  /* ------------------------------ drawings ------------------------------- */
  // One planner feeds the live preview and the commit, so what the pointer shows is what the release writes.
  function planFor(chart, drawings, key, value, options) {
    return planDrawingStyle(drawings, { [key]: value }, { keys: [key], groups: chart.drawings.listGroups(), ...options });
  }

  function selectionSection() {
    const chart = getChart();
    const container = element('div', { class: 'settings-selection' });
    const ids = chart ? chart.drawings.getSelection() : [];
    const drawings = chart ? chart.drawings.list().filter((drawing) => ids.includes(drawing.id)) : [];
    if (drawings.length === 0) {
      container.append(element('p', { class: 'settings-hint' }, t('settings.drawings.selectHint')));
      return container;
    }
    // A style chosen here is an individual choice: it is written with ownStyle, so shared edits leave it alone.
    const individual = { includeOwn: true, ownStyle: true };
    const keys = DRAWING_FIELDS.map((field) => field.key).filter((key) => drawings.every((drawing) => key in drawing.style));
    for (const field of DRAWING_FIELDS.filter((entry) => keys.includes(entry.key))) {
      const first = drawings[0].style[field.key];
      container.append(control(field, t(`settings.d.${field.key}`), first, {
        // A live preview while dragging; one undoable change when the control is released.
        onInput: (value) => {
          chart.drawings.setDragPreview(planFor(chart, drawings, field.key, value, individual).updates);
          chart.requestRender();
        },
        onChange: (value) => {
          chart.drawings.setDragPreview(null);
          try {
            const plan = planFor(chart, drawings, field.key, value, individual);
            if (plan.skippedLocked.length > 0) throw new Error(t('settings.drawings.lockedSelection'));
            if (plan.updates.length > 0) chart.drawings.updateBatch(plan.updates);
          } catch (error) { fail('settings.error.save')(error); }
          chart.requestRender();
        },
      }));
    }
    return container;
  }

  // A shared control edit reaches the default of new drawings and every existing drawing that has no individual
  // style and is not locked, as one undo step; the preview and the commit filter exactly the same way.
  function sharedPreview(key, value) {
    const chart = getChart();
    if (!chart) return;
    chart.drawings.setDragPreview(planFor(chart, chart.drawings.list(), key, value).updates);
    chart.requestRender();
  }
  function sharedCommit(key, value) {
    writeDrawing(key, value);
    const chart = getChart();
    if (!chart) return;
    chart.drawings.setDragPreview(null);
    try {
      // Recomputed now: drawings may have been locked, deleted or restyled since the preview.
      const plan = planFor(chart, chart.drawings.list(), key, value);
      if (plan.updates.length > 0) {
        chart.drawings.updateBatch(plan.updates);
        onAnnounce(t('settings.drawings.sharedApplied', { count: plan.updates.length }));
      }
    } catch (error) { fail('settings.error.save')(error); }
    chart.requestRender();
  }

  function renderDrawingsTab() {
    const values = settings.drawingValues();
    const defaults = DRAWING_FIELDS.map((field) => control(field, t(`settings.d.${field.key}`), values[field.key], {
      onInput: field.type === 'color' ? (value) => { writeDrawing(field.key, value); sharedPreview(field.key, value); } : (value) => sharedPreview(field.key, value),
      onChange: (value) => sharedCommit(field.key, value),
    }));
    body.replaceChildren(
      section(t('settings.drawings.selected'), selectionSection()),
      section(t('settings.drawings.new'), element('p', { class: 'settings-hint' }, t('settings.drawings.sharedHint')), ...defaults),
    );
  }
  function writeDrawing(key, value) {
    try { settings.setDrawing(key, value); } catch (error) { fail('settings.error.save')(error); }
  }

  /* -------------------------------- layout -------------------------------- */
  function renderBody() {
    if (activeTab === 'drawings') renderDrawingsTab(); else renderThemeTab(activeTab);
    for (const tab of tablist.children) {
      const selected = tab.dataset.tab === activeTab;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    body.setAttribute('aria-labelledby', `settings-tab-${activeTab}`);
  }

  function renderThemes() {
    for (const node of themeGroup.querySelectorAll('button')) node.setAttribute('aria-pressed', String(node.dataset.choice === getTheme()));
  }

  for (const name of ['dark', 'light']) {
    // Not `data-theme`: the page stylesheet restyles anything carrying that attribute as a whole theme.
    const choice = element('button', { type: 'button', 'data-choice': name }, t(name === 'dark' ? 'settings.themeDark' : 'settings.themeLight'));
    choice.addEventListener('click', () => { setTheme(name); renderThemes(); renderBody(); });
    themeGroup.append(choice);
  }
  for (const tab of TABS) {
    const node = element('button', { type: 'button', role: 'tab', id: `settings-tab-${tab}`, 'data-tab': tab }, t(`settings.tab.${tab}`));
    node.addEventListener('click', () => { activeTab = tab; renderBody(); });
    tablist.append(node);
  }
  tablist.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    activeTab = TABS[(TABS.indexOf(activeTab) + step + TABS.length) % TABS.length];
    renderBody();
    tablist.querySelector(`[data-tab="${activeTab}"]`).focus();
  });

  const resetTab = element('button', { type: 'button' }, t('settings.resetTab'));
  resetTab.addEventListener('click', () => {
    try {
      if (activeTab === 'drawings') settings.resetDrawings();
      else settings.resetKeys(getTheme(), FIELDS.filter((field) => field.tab === activeTab).map((field) => field.key));
    } catch (error) { fail('settings.error.save')(error); }
    renderBody();
  });
  const resetAll = element('button', { type: 'button' }, t('settings.resetAll'));
  resetAll.addEventListener('click', () => {
    try { settings.resetAll(); } catch (error) { fail('settings.error.save')(error); }
    renderBody();
  });
  const exportButton = element('button', { type: 'button' }, t('settings.export'));
  exportButton.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([settings.exportJson()], { type: 'application/json' }));
    const link = element('a', { href: url, download: 'vibecharts-terminal-settings.json' });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const importButton = element('button', { type: 'button' }, t('settings.import'));
  importButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      settings.importJson(await file.text());
      onAnnounce(t('settings.imported'));
    } catch (error) { fail('settings.error.import')(error); }
    renderBody();
  });

  const header = element('header', {}, element('h2', {}, t('settings.title')), close);
  const footer = element('footer', {}, resetTab, resetAll, exportButton, importButton, fileInput);
  dialog.append(header, themeGroup, tablist, body, footer);
  document.body.append(dialog);

  function open() {
    dialog.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    renderThemes();
    renderBody();
    tablist.querySelector('[aria-selected="true"]').focus();
  }
  function closeDialog() {
    if (dialog.hidden) return;
    dialog.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    getChart()?.drawings.setDragPreview(null);
    button.focus();
  }
  close.addEventListener('click', closeDialog);
  dialog.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); closeDialog(); } });
  button.addEventListener('click', () => (dialog.hidden ? open() : closeDialog()));

  return {
    /** Re-renders the selected-drawing section when the selection or a style changes while it is on screen. */
    refreshSelection() {
      if (dialog.hidden || activeTab !== 'drawings') return;
      const focusedKey = document.activeElement?.dataset?.key;
      const holder = body.querySelector('.settings-selection');
      if (!holder) return;
      holder.replaceWith(selectionSection());
      if (focusedKey) body.querySelector(`.settings-selection [data-key="${focusedKey}"]`)?.focus();
    },
    get isOpen() { return !dialog.hidden; },
  };
}
