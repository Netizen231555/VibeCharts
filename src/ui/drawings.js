import { createElement, append, clearElement, contains, focusElement } from '../interaction/dom.js';
import { DRAWING_TOOLS } from '../drawings/tools.js';
import { t as translate, localeOf } from './messages.js';

export function createDrawingControls({ chart, doc, host, interaction, announce }) {
  const store = chart && chart.drawings;
  if (!store || typeof store.snapshot !== 'function') return null;
  // Resolved on every use so a locale change shows up on the next render.
  const t = (key, params) => translate(localeOf(chart), key, params);
  const section = createElement(doc, 'section', { class: 'chart-drawings', 'aria-label': t('drawings.title') });
  append(host, section);
  let busy = false;
  let constructionType = 'segment';
  const drafts = new Map();
  function clearAppliedDrafts(id) {
    const remove = (...keys) => keys.forEach(key => drafts.delete(key));
    if (id.startsWith('anchor:')) {
      const suffix = id.slice('anchor:'.length);
      remove(`bar:${suffix}`, `offset:${suffix}`, `price:${suffix}`);
    } else if (id.startsWith('apply-style:')) remove(`style:${id.slice('apply-style:'.length)}`);
    else if (id.startsWith('apply-props:')) remove(`props:${id.slice('apply-props:'.length)}`);
    else if (id.startsWith('save-style:')) remove(`style-name:${id.slice('save-style:'.length)}`);
    else if (id.startsWith('group-delete:')) remove(`group-confirm:${id.slice('group-delete:'.length)}`);
    else if (id === 'group-create') remove('group-name');
    else if (id === 'construction-finish' || id === 'construction-cancel') remove('construction-anchors', 'construction-props');
    else if (id === 'snap-apply') remove('snap-mode', 'snap-source', 'snap-threshold', 'snap-magnet', 'snap-magnet-threshold', 'snap-step');
  }
  const action = (id, fn) => {
    busy = true;
    try { fn(); clearAppliedDrafts(id); busy = false; render(); }
    catch (error) {
      busy = false;
      const blockers = error.blockers || (error.details && error.details.blockers);
      announce(`${error.message}${blockers && blockers.length ? `: ${blockers.join(', ')}` : ''}`, { error: true });
    }
  };
  function button(parent, id, label, fn, disabled = false) {
    const node = createElement(doc, 'button', { type: 'button', 'data-drawing-control': id }, label);
    if (disabled) node.setAttribute('disabled', '');
    else node.addEventListener('click', () => action(id, fn));
    append(parent, node);
    return node;
  }
  function input(parent, id, label, value, type = 'text') {
    const wrapper = createElement(doc, 'label', {});
    append(wrapper, createElement(doc, 'span', {}, label));
    const node = createElement(doc, 'input', { type, 'data-drawing-control': id, 'aria-label': label });
    node.value = drafts.get(id) ?? String(value ?? '');
    node.addEventListener('input', () => drafts.set(id, node.value));
    append(wrapper, node); append(parent, wrapper);
    return node;
  }
  function textArea(parent, id, label, value) {
    const wrapper = createElement(doc, 'label', {});
    append(wrapper, createElement(doc, 'span', {}, label));
    const node = createElement(doc, 'textarea', { 'data-drawing-control': id, 'aria-label': label });
    node.value = drafts.get(id) ?? value;
    node.addEventListener('input', () => drafts.set(id, node.value));
    append(wrapper, node); append(parent, wrapper); return node;
  }
  function number(node, label) {
    if (node.value.trim() === '' || !Number.isFinite(Number(node.value))) throw new Error(t('drawings.finiteRequired', { label }));
    return Number(node.value);
  }
  function find(root, id) {
    for (const child of root.children) {
      if (child.getAttribute('data-drawing-control') === id) return child;
      const result = find(child, id); if (result) return result;
    }
    return null;
  }
  function render() {
    const active = doc.activeElement;
    const focus = active && contains(section, active) && active.getAttribute('data-drawing-control');
    const selectionRange = focus && typeof active.selectionStart === 'number'
      ? { start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection } : null;
    const yes = t('drawings.yes');
    const no = t('drawings.no');
    const state = store.snapshot();
    const selected = state.selection;
    clearElement(section);
    section.setAttribute('aria-label', t('drawings.title'));
    append(section, createElement(doc, 'h3', {}, t('drawings.title')));
    button(section, 'undo', t('drawings.undo'), () => store.undo(), !state.canUndo);
    button(section, 'redo', t('drawings.redo'), () => store.redo(), !state.canRedo);
    button(section, 'repeat', t(state.repeatMode ? 'drawings.repeatOn' : 'drawings.repeatOff'), () => store.setRepeatMode(!state.repeatMode)).setAttribute('aria-pressed', String(state.repeatMode));
    const construction = createElement(doc, 'div', { role: 'group', 'aria-label': t('drawings.byCoordinates') });
    append(section, construction); append(construction, createElement(doc, 'h4', {}, t('drawings.byCoordinates')));
    const toolLabel = createElement(doc, 'label', {});
    append(toolLabel, createElement(doc, 'span', {}, t('drawings.type')));
    const tool = createElement(doc, 'select', { 'aria-label': t('drawings.type'), 'data-drawing-control': 'construction-type' });
    for (const type of Object.keys(DRAWING_TOOLS)) {
      const option = createElement(doc, 'option', { value: type }, type);
      if (type === constructionType) option.setAttribute('selected', '');
      append(tool, option);
    }
    tool.value = constructionType;
    tool.addEventListener('change', () => { constructionType = tool.value; });
    append(toolLabel, tool); append(construction, toolLabel);
    const pane = input(construction, 'construction-pane', t('drawings.paneId'), 'main');
    const scale = input(construction, 'construction-scale', t('drawings.scaleId'), 'right');
    const anchors = textArea(construction, 'construction-anchors', t('drawings.anchors'), '[]');
    const props = textArea(construction, 'construction-props', t('drawings.drawingProps'), '{}');
    button(construction, 'construction-arm', t('drawings.arm'), () => {
      interaction.armDrawing(tool.value, { paneId: pane.value, scaleId: scale.value, props: JSON.parse(props.value) });
    }, !(interaction && interaction.armDrawing && chart.surface));
    const activeTool = interaction && interaction.getTool && interaction.getTool();
    button(construction, 'interactive-finish', t('drawings.interactiveFinish'), () => activeTool.finish(),
      !(activeTool && typeof activeTool.finish === 'function'));
    button(construction, 'interactive-cancel', t('drawings.interactiveCancel'), () => interaction.cancelGesture(),
      !(activeTool && typeof activeTool.cancel === 'function'));
    if (interaction && interaction.setDrawingSnap && chart.surface) {
      const snap = interaction.getDrawingSnap();
      const snapLabel = createElement(doc, 'label', {});
      append(snapLabel, createElement(doc, 'span', {}, t('drawings.snapPrice')));
      const mode = createElement(doc, 'select', { 'aria-label': t('drawings.snapPrice'), 'data-drawing-control': 'snap-mode' });
      for (const [value, label] of [['free', t('drawings.snapFree')], ['weak', t('drawings.snapWeak')], ['strong', t('drawings.snapStrong')]]) {
        const option = createElement(doc, 'option', { value }, label);
        if (value === snap.mode) option.setAttribute('selected', '');
        append(mode, option);
      }
      mode.value = drafts.get('snap-mode') ?? snap.mode;
      mode.addEventListener('change', () => drafts.set('snap-mode', mode.value));
      append(snapLabel, mode); append(construction, snapLabel);
      const source = input(construction, 'snap-source', t('drawings.snapSource'), snap.sourceId || '');
      const threshold = input(construction, 'snap-threshold', t('drawings.snapThreshold'), snap.threshold ?? 5);
      const magnet = input(construction, 'snap-magnet', t('drawings.snapMagnet'), snap.magnet ? yes : no);
      const magnetThreshold = input(construction, 'snap-magnet-threshold', t('drawings.snapMagnetThreshold'), snap.magnetThreshold ?? 5);
      const step = input(construction, 'snap-step', t('drawings.snapStep'), snap.step ?? '');
      button(construction, 'snap-apply', t('drawings.snapApply'), () => {
        const thresholdValue = number(threshold, t('drawings.priceThresholdName'));
        const magnetValue = number(magnetThreshold, t('drawings.magnetThresholdName'));
        if (thresholdValue < 0 || magnetValue < 0 || ![yes, no].includes(magnet.value)) throw new Error(t('drawings.invalidSnap'));
        const stepValue = step.value.trim() === '' ? undefined : number(step, t('drawings.stepName'));
        if (stepValue !== undefined && stepValue <= 0) throw new Error(t('drawings.stepPositive'));
        interaction.setDrawingSnap({ mode: mode.value, sourceId: source.value, threshold: thresholdValue,
          magnet: magnet.value === yes, magnetThreshold: magnetValue, rounding: stepValue !== undefined, step: stepValue });
      });
    }
    button(construction, 'construction-finish', t('drawings.finish'), () => {
      store.add({ type: tool.value, paneId: pane.value, scaleId: scale.value,
        anchors: JSON.parse(anchors.value), props: JSON.parse(props.value) });
      if (!store.getRepeatMode()) constructionType = 'segment';
      announce(t('drawings.added'));
    });
    button(construction, 'construction-cancel', t('drawings.cancel'), () => {
      anchors.value = '[]'; props.value = '{}';
      announce(t('drawings.cancelled'));
    });
    if (chart.timeline && typeof chart.timeline.slotAt === 'function') {
      append(construction, createElement(doc, 'p', {}, t('drawings.timelineInfo', { count: chart.timeline.length })));
    }
    const actions = createElement(doc, 'div', { role: 'group', 'aria-label': t('drawings.selectionActions') });
    append(section, actions);
    for (const [id, label, fn] of [
      ['forward', t('drawings.forward'), () => store.bringForward()], ['backward', t('drawings.backward'), () => store.sendBackward()],
      ['front', t('drawings.front'), () => store.bringToFront()], ['back', t('drawings.back'), () => store.sendToBack()],
      ['hide', t('drawings.hideSelected'), () => store.setVisibility(selected, false)],
      ['lock', t('drawings.lockSelected'), () => store.setLocked(selected, true)],
      ['unlock', t('drawings.unlockSelected'), () => store.setLocked(selected, false)],
      ['remove', t('drawings.removeSelected'), () => store.removeSelected()],
      ['ungroup-selection', t('drawings.ungroupSelection'), () => store.removeFromGroup(selected)],
    ]) button(actions, id, label, fn, !selected.length);
    const groupName = input(section, 'group-name', t('drawings.groupName'), '');
    button(section, 'group-create', t('drawings.groupCreate'), () => store.createGroup(groupName.value));
    for (const group of state.groups) {
      const row = createElement(doc, 'div', { role: 'group', 'aria-label': t('drawings.groupAria', { name: group.name, id: group.id }) });
      append(section, row); append(row, createElement(doc, 'span', {}, `${group.name} (${group.id})`));
      button(row, `group-select:${group.id}`, t('drawings.groupSelect'), () => store.select(group.id));
      button(row, `group-add:${group.id}`, t('drawings.groupAdd'), () => store.addToGroup(group.id, selected), !selected.length);
      for (const parent of state.groups.filter(item => item.id !== group.id)) {
        button(row, `group-parent:${group.id}:${parent.id}`, t('drawings.groupNest', { name: parent.name }), () => store.setGroupParent(group.id, parent.id));
      }
      if (group.parentId !== null) button(row, `group-root:${group.id}`, t('drawings.groupRoot'), () => store.setGroupParent(group.id, null));
      button(row, `group-visible:${group.id}`, t(group.visible ? 'drawings.groupHide' : 'drawings.groupShow'), () => store.setVisibility(group.id, !group.visible));
      button(row, `group-lock:${group.id}`, t(group.locked ? 'drawings.groupUnlock' : 'drawings.groupLock'), () => store.setLocked(group.id, !group.locked));
      button(row, `group-ungroup:${group.id}`, t('drawings.ungroup'), () => store.ungroup(group.id));
      const confirmation = input(row, `group-confirm:${group.id}`, t('drawings.groupConfirm'), '');
      button(row, `group-delete:${group.id}`, t('drawings.groupDelete'), () => {
        if (confirmation.value !== 'DELETE') throw new Error(t('drawings.groupDeleteConfirm'));
        store.removeGroup(group.id, { confirm: true });
      });
    }
    for (const drawing of state.drawings) {
      const row = createElement(doc, 'div', { role: 'group', 'aria-label': t('drawings.drawingAria', { id: drawing.id }) });
      append(section, row); append(row, createElement(doc, 'span', {}, `${drawing.type}: ${drawing.id}`));
      const chosen = selected.includes(drawing.id);
      const select = button(row, `select:${drawing.id}`, t(chosen ? 'drawings.deselect' : 'drawings.select'), () => {
        store.selectMany(chosen ? selected.filter(id => id !== drawing.id) : [...selected, drawing.id]);
        if (interaction && !chosen && typeof interaction.selectDrawing === 'function' && selected.length === 0) interaction.selectDrawing(drawing.id);
      }, !drawing.visible);
      select.setAttribute('aria-pressed', String(chosen));
      button(row, `visible:${drawing.id}`, t(drawing.visible ? 'drawings.hide' : 'drawings.show'), () => store.setVisibility(drawing.id, !drawing.visible));
      button(row, `lock:${drawing.id}`, t(drawing.locked ? 'drawings.unlock' : 'drawings.lock'), () => store.setLocked(drawing.id, !drawing.locked));
      button(row, `favorite:${drawing.id}`, t(store.isFavorite(drawing.type) ? 'drawings.unfavorite' : 'drawings.favorite'), () => store.setFavorite(drawing.type, !store.isFavorite(drawing.type)));
      if (!chosen) continue;
      drawing.anchors.forEach((anchor, index) => {
        const fields = createElement(doc, 'div', { role: 'group', 'aria-label': t('drawings.anchorAria', { index: index + 1, id: drawing.id }) });
        append(row, fields);
        const bar = anchor.anchorBarId === undefined ? null : input(fields, `bar:${drawing.id}:${index}`, t('drawings.itemId'), anchor.anchorBarId);
        const offset = bar ? input(fields, `offset:${drawing.id}:${index}`, t('drawings.offset'), anchor.offset) : null;
        const price = anchor.price === undefined ? null : input(fields, `price:${drawing.id}:${index}`, t('drawings.price'), anchor.price);
        button(fields, `anchor:${drawing.id}:${index}`, t('drawings.applyCoordinates'), () => {
          const anchors = drawing.anchors.map(item => ({ ...item }));
          if (bar) { anchors[index].anchorBarId = bar.value; anchors[index].offset = number(offset, t('drawings.offset')); }
          if (price) anchors[index].price = number(price, t('drawings.price'));
          store.update(drawing.id, { anchors });
        });
      });
      const style = textArea(row, `style:${drawing.id}`, t('drawings.style'), JSON.stringify(drawing.style));
      button(row, `apply-style:${drawing.id}`, t('drawings.applyStyle'), () => store.applyStyle(drawing.id, JSON.parse(style.value)));
      const props = textArea(row, `props:${drawing.id}`, t('drawings.props'), JSON.stringify(drawing.props));
      button(row, `apply-props:${drawing.id}`, t('drawings.applyProps'), () => store.update(drawing.id, { props: JSON.parse(props.value) }));
      const name = input(row, `style-name:${drawing.id}`, t('drawings.styleName'), '');
      button(row, `save-style:${drawing.id}`, t('drawings.saveStyle'), () => store.saveStyle({ name: name.value, type: drawing.type, style: JSON.parse(style.value) }));
      for (const saved of store.listStyles(drawing.type)) button(row, `saved-style:${drawing.id}:${saved.id}`, t('drawings.applySaved', { name: saved.name }), () => {
        store.applyStyle(drawing.id, saved.id);
        drafts.delete(`style:${drawing.id}`);
      });
    }
    if (focus) {
      const replacement = find(section, focus);
      if (replacement && !replacement.hasAttribute('disabled')) {
        focusElement(replacement);
        if (selectionRange && typeof replacement.setSelectionRange === 'function') replacement.setSelectionRange(selectionRange.start, selectionRange.end, selectionRange.direction);
      } else focusElement(section);
    }
  }
  section.setAttribute('tabindex', '-1');
  const unsubscribe = store.subscribe(() => { if (!busy) render(); });
  const unsubscribeSelection = interaction && interaction.subscribe ? interaction.subscribe('selectionChange', () => { if (!busy) render(); }) : null;
  const unsubscribeTool = interaction && interaction.subscribe ? interaction.subscribe('toolChange', () => { if (!busy) render(); }) : null;
  render();
  return { render, detach() { unsubscribe(); if (unsubscribeSelection) unsubscribeSelection(); if (unsubscribeTool) unsubscribeTool(); if (section.parentNode) section.parentNode.removeChild(section); } };
}
