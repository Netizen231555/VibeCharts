import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enhanceSelect } from '../src/ui/custom-select.js';

class Element {
  constructor(doc) { this.ownerDocument = doc; this.attrs = {}; this.listeners = {}; this.children = []; this.style = {}; this.classList = { toggle() {} }; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  hasAttribute(key) { return Object.hasOwn(this.attrs, key); }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  appendChild(child) { this.children.push(child); }
  append(...children) { this.children.push(...children); }
  contains(element) { return this.children.includes(element); }
  closest() { return null; }
  getBoundingClientRect() { return { top: 100, bottom: 140 }; }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView() {}
}

function fixture() {
  const doc = { defaultView: { innerHeight: 800, Event: class { constructor(type) { this.type = type; } } }, createElement() { return new Element(this); }, addEventListener() {}, removeEventListener() {} };
  const select = new Element(doc);
  select.id = 'style';
  select.disabled = false;
  select.selectedIndex = 0;
  select.options = [{ textContent: 'Solid', disabled: false }, { textContent: 'Dashed', disabled: false }];
  select.replaceWith = wrapper => { select.wrapper = wrapper; };
  select.dispatchEvent = event => { select.change = event.type; };
  enhanceSelect(select);
  return { select, button: select.wrapper.children[0], list: select.wrapper.children[1] };
}

test('clicking an option selects it once and closes the list', () => {
  const { select, button, list } = fixture();
  button.listeners.click();
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  let prevented = false;
  list.listeners.click({ target: { closest: () => list.children[1] }, preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(select.selectedIndex, 1);
  assert.equal(select.change, 'change');
  assert.equal(button.textContent, 'Dashed');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(prevented, true);
});

test('Escape closes the list without changing selection or escaping to the dialog', () => {
  const { select, button } = fixture();
  button.listeners.click();
  let stopped = false;
  button.listeners.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() { stopped = true; } });
  assert.equal(select.selectedIndex, 0);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(stopped, true);
});
