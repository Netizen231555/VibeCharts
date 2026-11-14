import { createElement, append, clearElement, contains, focusElement } from '../interaction/dom.js';
import { DRAWING_TOOLS } from '../drawings/tools.js';

export function createDrawingControls({ chart, doc, host, interaction, announce }) {
  const store = chart && chart.drawings;
  if (!store || typeof store.snapshot !== 'function') return null;
  const section = createElement(doc, 'section', { class: 'chart-drawings', 'aria-label': 'Рисунки' });
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
    if (node.value.trim() === '' || !Number.isFinite(Number(node.value))) throw new Error(`${label}: требуется конечное число`);
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
    const state = store.snapshot();
    const selected = state.selection;
    clearElement(section);
    append(section, createElement(doc, 'h3', {}, 'Рисунки'));
    button(section, 'undo', 'Отменить рисунок', () => store.undo(), !state.canUndo);
    button(section, 'redo', 'Повторить рисунок', () => store.redo(), !state.canRedo);
    button(section, 'repeat', state.repeatMode ? 'Повторное построение: включено' : 'Повторное построение: выключено', () => store.setRepeatMode(!state.repeatMode)).setAttribute('aria-pressed', String(state.repeatMode));
    const construction = createElement(doc, 'div', { role: 'group', 'aria-label': 'Рисунок по координатам' });
    append(section, construction); append(construction, createElement(doc, 'h4', {}, 'Рисунок по координатам'));
    const toolLabel = createElement(doc, 'label', {});
    append(toolLabel, createElement(doc, 'span', {}, 'Тип рисунка'));
    const tool = createElement(doc, 'select', { 'aria-label': 'Тип рисунка', 'data-drawing-control': 'construction-type' });
    for (const type of Object.keys(DRAWING_TOOLS)) {
      const option = createElement(doc, 'option', { value: type }, type);
      if (type === constructionType) option.setAttribute('selected', '');
      append(tool, option);
    }
    tool.value = constructionType;
    tool.addEventListener('change', () => { constructionType = tool.value; });
    append(toolLabel, tool); append(construction, toolLabel);
    const pane = input(construction, 'construction-pane', 'ID панели', 'main');
    const scale = input(construction, 'construction-scale', 'ID ценовой шкалы', 'right');
    const anchors = textArea(construction, 'construction-anchors', 'Якоря (JSON: anchorBarId, offset, price)', '[]');
    const props = textArea(construction, 'construction-props', 'Свойства рисунка (JSON)', '{}');
    button(construction, 'construction-arm', 'Строить на графике', () => {
      interaction.armDrawing(tool.value, { paneId: pane.value, scaleId: scale.value, props: JSON.parse(props.value) });
    }, !(interaction && interaction.armDrawing && chart.surface));
    const activeTool = interaction && interaction.getTool && interaction.getTool();
    button(construction, 'interactive-finish', 'Завершить интерактивное построение', () => activeTool.finish(),
      !(activeTool && typeof activeTool.finish === 'function'));
    button(construction, 'interactive-cancel', 'Отменить интерактивное построение', () => interaction.cancelGesture(),
      !(activeTool && typeof activeTool.cancel === 'function'));
    if (interaction && interaction.setDrawingSnap && chart.surface) {
      const snap = interaction.getDrawingSnap();
      const snapLabel = createElement(doc, 'label', {});
      append(snapLabel, createElement(doc, 'span', {}, 'Привязка цены'));
      const mode = createElement(doc, 'select', { 'aria-label': 'Привязка цены', 'data-drawing-control': 'snap-mode' });
      for (const [value, label] of [['free', 'Свободно'], ['weak', 'Слабая OHLC'], ['strong', 'Сильная OHLC']]) {
        const option = createElement(doc, 'option', { value }, label);
        if (value === snap.mode) option.setAttribute('selected', '');
        append(mode, option);
      }
      mode.value = drafts.get('snap-mode') ?? snap.mode;
      mode.addEventListener('change', () => drafts.set('snap-mode', mode.value));
      append(snapLabel, mode); append(construction, snapLabel);
      const source = input(construction, 'snap-source', 'ID источника OHLC', snap.sourceId || '');
      const threshold = input(construction, 'snap-threshold', 'Порог цены в пикселях', snap.threshold ?? 5);
      const magnet = input(construction, 'snap-magnet', 'Магнит к центру (да или нет)', snap.magnet ? 'да' : 'нет');
      const magnetThreshold = input(construction, 'snap-magnet-threshold', 'Порог магнита в пикселях', snap.magnetThreshold ?? 5);
      const step = input(construction, 'snap-step', 'Шаг цены (пусто — без округления)', snap.step ?? '');
      button(construction, 'snap-apply', 'Применить привязку', () => {
        const thresholdValue = number(threshold, 'Порог цены');
        const magnetValue = number(magnetThreshold, 'Порог магнита');
        if (thresholdValue < 0 || magnetValue < 0 || !['да', 'нет'].includes(magnet.value)) throw new Error('Недопустимые параметры привязки');
        const stepValue = step.value.trim() === '' ? undefined : number(step, 'Шаг');
        if (stepValue !== undefined && stepValue <= 0) throw new Error('Шаг должен быть положительным');
        interaction.setDrawingSnap({ mode: mode.value, sourceId: source.value, threshold: thresholdValue,
          magnet: magnet.value === 'да', magnetThreshold: magnetValue, rounding: stepValue !== undefined, step: stepValue });
      });
    }
    button(construction, 'construction-finish', 'Завершить построение', () => {
      store.add({ type: tool.value, paneId: pane.value, scaleId: scale.value,
        anchors: JSON.parse(anchors.value), props: JSON.parse(props.value) });
      if (!store.getRepeatMode()) constructionType = 'segment';
      announce('Рисунок добавлен');
    });
    button(construction, 'construction-cancel', 'Отменить построение', () => {
      anchors.value = '[]'; props.value = '{}';
      announce('Построение отменено');
    });
    if (chart.timeline && typeof chart.timeline.slotAt === 'function') {
      append(construction, createElement(doc, 'p', {}, `Элементов шкалы: ${chart.timeline.length}. ID доступен в таблице данных.`));
    }
    const actions = createElement(doc, 'div', { role: 'group', 'aria-label': 'Действия с выделением' });
    append(section, actions);
    for (const [id, label, fn] of [
      ['forward', 'Вперёд', () => store.bringForward()], ['backward', 'Назад', () => store.sendBackward()],
      ['front', 'На передний план', () => store.bringToFront()], ['back', 'На задний план', () => store.sendToBack()],
      ['hide', 'Скрыть выделенное', () => store.setVisibility(selected, false)],
      ['lock', 'Заблокировать выделенное', () => store.setLocked(selected, true)],
      ['unlock', 'Разблокировать выделенное', () => store.setLocked(selected, false)],
      ['remove', 'Удалить выделенное', () => store.removeSelected()],
      ['ungroup-selection', 'Исключить из группы', () => store.removeFromGroup(selected)],
    ]) button(actions, id, label, fn, !selected.length);
    const groupName = input(section, 'group-name', 'Название новой группы', '');
    button(section, 'group-create', 'Создать группу', () => store.createGroup(groupName.value));
    for (const group of state.groups) {
      const row = createElement(doc, 'div', { role: 'group', 'aria-label': `Группа ${group.name} (${group.id})` });
      append(section, row); append(row, createElement(doc, 'span', {}, `${group.name} (${group.id})`));
      button(row, `group-select:${group.id}`, 'Выбрать группу', () => store.select(group.id));
      button(row, `group-add:${group.id}`, 'Добавить выделенное в группу', () => store.addToGroup(group.id, selected), !selected.length);
      for (const parent of state.groups.filter(item => item.id !== group.id)) {
        button(row, `group-parent:${group.id}:${parent.id}`, `Вложить в ${parent.name}`, () => store.setGroupParent(group.id, parent.id));
      }
      if (group.parentId !== null) button(row, `group-root:${group.id}`, 'Переместить группу в корень', () => store.setGroupParent(group.id, null));
      button(row, `group-visible:${group.id}`, group.visible ? 'Скрыть группу' : 'Показать группу', () => store.setVisibility(group.id, !group.visible));
      button(row, `group-lock:${group.id}`, group.locked ? 'Разблокировать группу' : 'Заблокировать группу', () => store.setLocked(group.id, !group.locked));
      button(row, `group-ungroup:${group.id}`, 'Разгруппировать', () => store.ungroup(group.id));
      const confirmation = input(row, `group-confirm:${group.id}`, 'Для удаления группы введите DELETE', '');
      button(row, `group-delete:${group.id}`, 'Удалить группу с рисунками', () => {
        if (confirmation.value !== 'DELETE') throw new Error('Подтвердите удаление группы');
        store.removeGroup(group.id, { confirm: true });
      });
    }
    for (const drawing of state.drawings) {
      const row = createElement(doc, 'div', { role: 'group', 'aria-label': `Рисунок ${drawing.id}` });
      append(section, row); append(row, createElement(doc, 'span', {}, `${drawing.type}: ${drawing.id}`));
      const chosen = selected.includes(drawing.id);
      const select = button(row, `select:${drawing.id}`, chosen ? 'Снять выделение' : 'Выбрать', () => {
        store.selectMany(chosen ? selected.filter(id => id !== drawing.id) : [...selected, drawing.id]);
        if (interaction && !chosen && typeof interaction.selectDrawing === 'function' && selected.length === 0) interaction.selectDrawing(drawing.id);
      }, !drawing.visible);
      select.setAttribute('aria-pressed', String(chosen));
      button(row, `visible:${drawing.id}`, drawing.visible ? 'Скрыть' : 'Показать', () => store.setVisibility(drawing.id, !drawing.visible));
      button(row, `lock:${drawing.id}`, drawing.locked ? 'Разблокировать' : 'Заблокировать', () => store.setLocked(drawing.id, !drawing.locked));
      button(row, `favorite:${drawing.id}`, store.isFavorite(drawing.type) ? 'Убрать инструмент из избранного' : 'В избранное', () => store.setFavorite(drawing.type, !store.isFavorite(drawing.type)));
      if (!chosen) continue;
      drawing.anchors.forEach((anchor, index) => {
        const fields = createElement(doc, 'div', { role: 'group', 'aria-label': `Якорь ${index + 1} рисунка ${drawing.id}` });
        append(row, fields);
        const bar = anchor.anchorBarId === undefined ? null : input(fields, `bar:${drawing.id}:${index}`, 'ID элемента', anchor.anchorBarId);
        const offset = bar ? input(fields, `offset:${drawing.id}:${index}`, 'Смещение', anchor.offset) : null;
        const price = anchor.price === undefined ? null : input(fields, `price:${drawing.id}:${index}`, 'Цена', anchor.price);
        button(fields, `anchor:${drawing.id}:${index}`, 'Применить координаты', () => {
          const anchors = drawing.anchors.map(item => ({ ...item }));
          if (bar) { anchors[index].anchorBarId = bar.value; anchors[index].offset = number(offset, 'Смещение'); }
          if (price) anchors[index].price = number(price, 'Цена');
          store.update(drawing.id, { anchors });
        });
      });
      const style = textArea(row, `style:${drawing.id}`, 'Стиль (JSON)', JSON.stringify(drawing.style));
      button(row, `apply-style:${drawing.id}`, 'Применить стиль', () => store.applyStyle(drawing.id, JSON.parse(style.value)));
      const props = textArea(row, `props:${drawing.id}`, 'Свойства (JSON)', JSON.stringify(drawing.props));
      button(row, `apply-props:${drawing.id}`, 'Применить свойства', () => store.update(drawing.id, { props: JSON.parse(props.value) }));
      const name = input(row, `style-name:${drawing.id}`, 'Название стиля', '');
      button(row, `save-style:${drawing.id}`, 'Сохранить стиль', () => store.saveStyle({ name: name.value, type: drawing.type, style: JSON.parse(style.value) }));
      for (const saved of store.listStyles(drawing.type)) button(row, `saved-style:${drawing.id}:${saved.id}`, `Применить стиль ${saved.name}`, () => {
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
