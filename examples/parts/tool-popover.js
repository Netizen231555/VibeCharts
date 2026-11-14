// Recipe: every drawing tool behind one button, in a popup panel grouped by the model.
// Copy this file into your project. It uses the package entry point `vibecharts/ui` and the controller handed to a part.
import { createIcon, hasIcon } from 'vibecharts/ui';

let instances = 0;

/**
 * Part factory: `layout.parts = { toolPopover: { create: toolPopover, regions: ['top'], controls: ['tool:', 'clearDrawings'] } }`.
 * Declaring the covered control ids lets layout validation accept a layout without the built-in rail; do not also list
 * them in `layout.without`, which disables those controls in the model.
 */
export function toolPopover(controller, { document: doc }) {
  instances += 1;
  const id = `recipe-popover-${instances}`;
  const disposers = [];
  const view = doc.defaultView;

  const model = () => controller.model().groups.flatMap((group) => group.controls);
  const tools = () => controller.model().groups.find((group) => group.id === 'tools')?.controls ?? [];

  const root = doc.createElement('div');
  root.className = 'recipe-popover';

  const trigger = doc.createElement('button');
  trigger.type = 'button';
  trigger.className = 'chart-ui-btn recipe-popover-trigger';
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', `${id}-panel`);
  const triggerIcon = doc.createElement('span');
  triggerIcon.className = 'recipe-popover-icon';
  const triggerText = doc.createElement('span');
  trigger.append(triggerIcon, triggerText);

  // A group, not a menu: the entries are toggle buttons and must keep `aria-pressed`.
  const panel = doc.createElement('div');
  panel.id = `${id}-panel`;
  panel.className = 'recipe-popover-panel';
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', controller.t('rail.label'));
  panel.hidden = true;

  /** @type {Array<{ button: HTMLButtonElement, kind: 'cursor'|'tool'|'clear', controlId: string|null, reason: HTMLElement }>} */
  const items = [];
  let reasonCounter = 0;

  function addItem(parent, { kind, controlId, label, iconName }) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'chart-ui-btn recipe-popover-item';
    if (hasIcon(iconName)) button.append(createIcon(doc, iconName, { size: 18 }));
    const text = doc.createElement('span');
    text.textContent = label;
    const reason = doc.createElement('span');
    reason.id = `${id}-reason-${reasonCounter += 1}`;
    reason.className = 'chart-ui-sr';
    button.setAttribute('aria-describedby', reason.id);
    button.append(text, reason);
    if (kind !== 'clear') button.setAttribute('aria-pressed', 'false');
    parent.append(button);
    items.push({ button, kind, controlId, reason });
  }

  addItem(panel, { kind: 'cursor', controlId: null, label: controller.t('rail.cursor'), iconName: 'cursor' });
  const sections = new Map();
  for (const control of tools()) {
    const key = control.group ?? '';
    if (!sections.has(key)) {
      const section = doc.createElement('div');
      section.className = 'recipe-popover-group';
      section.setAttribute('role', 'group');
      const name = control.groupLabel ?? controller.t('rail.label');
      section.setAttribute('aria-label', name);
      const heading = doc.createElement('span');
      heading.className = 'recipe-popover-heading';
      heading.setAttribute('aria-hidden', 'true');
      heading.textContent = name;
      section.append(heading);
      sections.set(key, section);
      panel.append(section);
    }
    addItem(sections.get(key), { kind: 'tool', controlId: control.id, label: control.label, iconName: control.value });
  }
  const clearing = model().find((control) => control.id === 'clearDrawings');
  if (clearing) addItem(panel, { kind: 'clear', controlId: clearing.id, label: clearing.label, iconName: 'clear' });
  root.append(trigger, panel);

  /* ------------------------------------ state ------------------------------------ */
  function paint() {
    const byId = new Map(model().map((control) => [control.id, control]));
    const active = controller.get('tool');
    const activeControl = tools().find((control) => control.value === active) ?? null;
    for (const item of items) {
      if (item.kind === 'cursor') { item.button.setAttribute('aria-pressed', String(active === null)); continue; }
      const control = byId.get(item.controlId);
      if (item.kind === 'tool') item.button.setAttribute('aria-pressed', String(control.pressed === true));
      // Stays focusable; the reason is read through aria-describedby and shown as a tooltip.
      if (control.enabled === false) item.button.setAttribute('aria-disabled', 'true'); else item.button.removeAttribute('aria-disabled');
      item.reason.textContent = control.enabled === false ? control.reason : '';
      item.button.title = control.enabled === false ? control.reason : '';
    }
    const current = activeControl ? activeControl.label : controller.t('rail.cursor');
    triggerText.textContent = activeControl ? activeControl.label : controller.t('rail.label');
    triggerIcon.replaceChildren();
    const iconName = activeControl ? activeControl.value : 'cursor';
    if (hasIcon(iconName)) triggerIcon.append(createIcon(doc, iconName, { size: 18 }));
    trigger.setAttribute('aria-label', `${controller.t('rail.label')}: ${current}`);
  }
  paint();
  disposers.push(controller.subscribe(['tool', 'capabilities', 'drawings'], paint));

  /* ----------------------------------- open/close ----------------------------------- */
  let opened = false;
  let openDisposers = [];

  // Fixed positioning keeps the panel clear of a scrolling bar; it opens upward when there is no room below.
  function place() {
    const rect = trigger.getBoundingClientRect();
    const width = doc.documentElement.clientWidth || view.innerWidth;
    const height = doc.documentElement.clientHeight || view.innerHeight;
    panel.style.maxHeight = '';
    const natural = panel.offsetHeight;
    const below = height - rect.bottom - 10;
    const above = rect.top - 10;
    const up = natural > below && above > below;
    const room = Math.max(120, up ? above : below);
    panel.style.maxHeight = `${room}px`;
    panel.style.left = `${Math.max(4, Math.min(rect.left, width - panel.offsetWidth - 4))}px`;
    panel.style.top = `${up ? Math.max(4, rect.top - 4 - Math.min(natural, room)) : rect.bottom + 4}px`;
  }

  function close({ restoreFocus = true } = {}) {
    if (!opened) return;
    opened = false;
    for (const dispose of openDisposers.splice(0)) dispose();
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  }

  function open() {
    if (opened) return;
    opened = true;
    paint();
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    place();
    const target = items.find((item) => item.button.getAttribute('aria-pressed') === 'true') ?? items[0];
    target.button.focus();
    const onPointerDown = (event) => { if (!root.contains(event.target)) close({ restoreFocus: false }); };
    const onResize = () => place();
    doc.addEventListener('pointerdown', onPointerDown, true);
    view.addEventListener('resize', onResize);
    openDisposers.push(() => doc.removeEventListener('pointerdown', onPointerDown, true), () => view.removeEventListener('resize', onResize));
  }

  /* ----------------------------------- events ----------------------------------- */
  const onTrigger = () => (opened ? close() : open());
  const onTriggerKey = (event) => {
    if (event.key === 'ArrowDown' && !opened) { event.preventDefault(); open(); }
  };
  const onPanelKey = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    const index = items.findIndex((item) => item.button === event.target || item.button.contains(event.target));
    if (index < 0) return;
    let next = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = index + 1;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    items[(next + items.length) % items.length].button.focus();
  };
  const onItem = (item) => () => {
    if (item.kind === 'cursor') {
      const active = controller.get('tool');
      const control = tools().find((entry) => entry.value === active);
      if (control) controller.run(control.id); // choosing the active tool again drops it
      close();
      return;
    }
    const result = controller.run(item.controlId);
    // A refusal keeps the panel open: the reason was announced and is readable on the entry.
    if (result.ok === false) return;
    close();
  };

  trigger.addEventListener('click', onTrigger);
  trigger.addEventListener('keydown', onTriggerKey);
  panel.addEventListener('keydown', onPanelKey);
  disposers.push(() => trigger.removeEventListener('click', onTrigger), () => trigger.removeEventListener('keydown', onTriggerKey), () => panel.removeEventListener('keydown', onPanelKey));
  for (const item of items) {
    const handler = onItem(item);
    item.button.addEventListener('click', handler);
    disposers.push(() => item.button.removeEventListener('click', handler));
  }

  return {
    element: root,
    destroy() {
      close({ restoreFocus: false });
      for (const dispose of disposers.splice(0)) dispose();
    },
  };
}
