let nextListId = 0;

/** Replace a native select's presentation while retaining its change event and value. */
export function enhanceSelect(select) {
  const doc = select.ownerDocument;
  const wrapper = doc.createElement('span');
  wrapper.className = 'chart-custom-select';
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'chart-custom-select-button';
  button.setAttribute('role', 'combobox');
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  const id = select.id;
  if (id) { select.removeAttribute('id'); button.id = id; }
  for (const attr of ['aria-label', 'aria-labelledby', 'aria-describedby', 'aria-invalid', 'data-field', 'data-key']) {
    if (select.hasAttribute(attr)) button.setAttribute(attr, select.getAttribute(attr));
  }
  button.disabled = select.disabled;
  const list = doc.createElement('span');
  list.className = 'chart-custom-select-list';
  list.id = `chart-custom-select-${++nextListId}`;
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  button.setAttribute('aria-controls', list.id);
  const options = [...select.options];
  const nodes = options.map((option, index) => {
    const item = doc.createElement('span');
    item.id = `${list.id}-${index}`;
    item.className = 'chart-custom-select-option';
    item.setAttribute('role', 'option');
    item.textContent = option.textContent;
    if (option.disabled) item.setAttribute('aria-disabled', 'true');
    list.appendChild(item);
    return item;
  });
  if (id) list.setAttribute('aria-labelledby', id);
  else if (select.hasAttribute('aria-label')) list.setAttribute('aria-label', select.getAttribute('aria-label'));
  let active = Math.max(0, select.selectedIndex);
  let opened = false;
  function sync() {
    button.textContent = options[select.selectedIndex]?.textContent ?? '';
    nodes.forEach((node, i) => {
      node.setAttribute('aria-selected', String(i === select.selectedIndex));
      node.classList.toggle('is-active', i === active);
    });
    if (opened && nodes[active]) button.setAttribute('aria-activedescendant', nodes[active].id);
    else button.removeAttribute('aria-activedescendant');
  }
  function close() {
    if (!opened) return;
    opened = false;
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    doc.removeEventListener('pointerdown', outside, true);
    sync();
  }
  function outside(event) { if (!wrapper.contains(event.target)) close(); }
  function open() {
    if (button.disabled || opened) return;
    opened = true;
    active = Math.max(0, select.selectedIndex);
    list.hidden = false;
    const boundary = wrapper.closest('.chart-drawing-settings-panel, .settings-body');
    const outer = boundary?.getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    const below = (outer ? Math.min(outer.bottom, doc.defaultView.innerHeight) : doc.defaultView.innerHeight) - rect.bottom;
    const above = rect.top - (outer ? Math.max(outer.top, 0) : 0);
    const upward = below < 160 && above > below;
    list.style.top = upward ? 'auto' : 'calc(100% + 4px)';
    list.style.bottom = upward ? 'calc(100% + 4px)' : 'auto';
    list.style.maxHeight = `${Math.max(40, Math.min(200, (upward ? above : below) - 8))}px`;
    button.setAttribute('aria-expanded', 'true');
    doc.addEventListener('pointerdown', outside, true);
    sync();
  }
  function move(step) {
    if (!options.length) return;
    for (let n = 0; n < options.length; n += 1) {
      active = (active + step + options.length) % options.length;
      if (!options[active].disabled) break;
    }
    sync();
    nodes[active]?.scrollIntoView({ block: 'nearest' });
  }
  function choose(index) {
    if (!options[index] || options[index].disabled) return;
    const changed = select.selectedIndex !== index;
    select.selectedIndex = index;
    active = index;
    close();
    sync();
    if (changed) select.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
    button.focus();
  }
  button.addEventListener('click', () => { if (opened) close(); else open(); });
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && opened) { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'Tab') { close(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!opened) open(); else move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (opened && (event.key === 'Home' || event.key === 'End')) {
      event.preventDefault();
      active = event.key === 'Home' ? -1 : 0;
      move(event.key === 'Home' ? 1 : -1);
    } else if (opened && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      choose(active);
    }
  });
  list.addEventListener('click', (event) => {
    const index = nodes.indexOf(event.target.closest('[role="option"]'));
    if (index >= 0) {
      event.preventDefault();
      event.stopPropagation();
      choose(index);
    }
  });
  select.replaceWith(wrapper);
  select.hidden = true;
  select.setAttribute('aria-hidden', 'true');
  select.tabIndex = -1;
  wrapper.append(button, list, select);
  sync();
  return close;
}

/** Enhance the selects in a newly rendered settings panel. */
export function enhanceSelects(root) {
  if (typeof root.querySelectorAll !== 'function') return () => {};
  const disposers = [...root.querySelectorAll('select')].map(enhanceSelect);
  return () => { for (const dispose of disposers) dispose(); };
}
