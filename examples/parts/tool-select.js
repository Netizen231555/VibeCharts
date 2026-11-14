// Recipe: the drawing tools as a labelled native <select>, built only from the controller model.
// Copy this file into your project; it needs nothing but the package entry point and the controller handed to a part.

let instances = 0;

/**
 * Part factory: `layout.parts = { toolSelect: { create: toolSelect, regions: ['top'], controls: ['tool:', 'clearDrawings'] } }`.
 * Declaring the covered control ids lets layout validation accept a layout without the built-in rail; do not also list
 * them in `layout.without`, which disables those controls in the model.
 */
export function toolSelect(controller, { document: doc }) {
  instances += 1;
  const id = `recipe-tool-select-${instances}`;
  const disposers = [];

  const root = doc.createElement('div');
  root.className = 'recipe-select';

  const label = doc.createElement('label');
  label.htmlFor = `${id}-field`;
  label.textContent = controller.t('rail.label');

  const select = doc.createElement('select');
  select.id = `${id}-field`;
  select.className = 'chart-ui-select';

  // A refused tool must stay reachable and explained, so the select is never `disabled`: it is `aria-disabled`
  // and its reason is read through `aria-describedby`.
  const reason = doc.createElement('span');
  reason.id = `${id}-reason`;
  reason.className = 'chart-ui-sr';
  select.setAttribute('aria-describedby', reason.id);

  const clear = doc.createElement('button');
  clear.type = 'button';
  clear.className = 'chart-ui-btn';

  const toolControls = () => controller.model().groups.find((group) => group.id === 'tools')?.controls ?? [];
  const clearControl = () => controller.model().groups.flatMap((group) => group.controls).find((control) => control.id === 'clearDrawings');

  // The tool list is static for a chart, so the options are built once; state is repainted on change.
  const cursor = doc.createElement('option');
  cursor.value = '';
  cursor.textContent = controller.t('rail.cursor');
  select.append(cursor);
  const groups = new Map();
  for (const control of toolControls()) {
    const key = control.group ?? '';
    if (!groups.has(key)) {
      const optgroup = doc.createElement('optgroup');
      optgroup.label = control.groupLabel ?? controller.t('rail.label');
      groups.set(key, optgroup);
      select.append(optgroup);
    }
    const option = doc.createElement('option');
    option.value = control.value;
    option.textContent = control.label;
    groups.get(key).append(option);
  }

  function paint() {
    const tools = toolControls();
    const active = controller.get('tool');
    select.value = tools.some((control) => control.value === active) ? active : '';
    const refused = tools.find((control) => control.enabled === false);
    if (refused) select.setAttribute('aria-disabled', 'true'); else select.removeAttribute('aria-disabled');
    reason.textContent = refused ? refused.reason : '';
    select.title = refused ? refused.reason : '';
    const clearing = clearControl();
    clear.textContent = clearing.label;
    if (clearing.enabled === false) clear.setAttribute('aria-disabled', 'true'); else clear.removeAttribute('aria-disabled');
    clear.title = clearing.enabled === false ? clearing.reason : '';
  }

  const onChange = () => {
    const picked = select.value;
    if (picked === '') {
      const active = controller.get('tool');
      const control = toolControls().find((entry) => entry.value === active);
      if (control) controller.run(control.id); // the tool action toggles the active tool off
    } else {
      controller.run(`tool:${picked}`); // a refusal is announced by the controller and returned, never thrown
    }
    paint(); // a refused choice returns the select to the real state
  };
  const onClear = () => { controller.run('clearDrawings'); };
  select.addEventListener('change', onChange);
  clear.addEventListener('click', onClear);
  disposers.push(() => select.removeEventListener('change', onChange), () => clear.removeEventListener('click', onClear));
  disposers.push(controller.subscribe(['tool', 'capabilities', 'drawings'], paint));

  root.append(label, select, reason, clear);
  paint();

  return {
    element: root,
    destroy() { for (const dispose of disposers.splice(0)) dispose(); },
  };
}
