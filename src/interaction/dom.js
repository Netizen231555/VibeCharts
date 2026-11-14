/** Small DOM helpers; no framework, no innerHTML, no HTML from data. */
import { InteractionError } from './errors.js';

export function createElement(document, tagName, attributes = {}, text = null) {
  if (!document || typeof document.createElement !== 'function') {
    throw new InteractionError('A DOM document is required to build interaction UI', { code: 'MISSING_DOM', field: 'document' });
  }
  const element = document.createElement(tagName);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'text') continue;
    element.setAttribute(name, value === true ? '' : String(value));
  }
  if (text !== null && text !== undefined) element.textContent = String(text);
  return element;
}

export function clearElement(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
  return element;
}

export function append(parent, ...children) {
  for (const child of children) {
    if (child === null || child === undefined) continue;
    parent.appendChild(child);
  }
  return parent;
}

export function setStyle(element, styles) {
  if (!element.style) element.style = {};
  for (const [name, value] of Object.entries(styles)) {
    if (value === null || value === undefined) continue;
    if (typeof element.style.setProperty === 'function' && name.includes('-')) {
      element.style.setProperty(name, String(value));
    } else {
      element.style[name] = typeof value === 'number' ? `${value}px` : String(value);
    }
  }
}

export function on(target, type, handler, options = undefined) {
  if (!target || typeof target.addEventListener !== 'function') {
    throw new InteractionError('Event target does not support addEventListener', { code: 'MISSING_DOM', field: 'target' });
  }
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

export function pointFromEvent(event, container) {
  const clientX = typeof event.clientX === 'number' ? event.clientX : 0;
  const clientY = typeof event.clientY === 'number' ? event.clientY : 0;
  const rect = typeof container.getBoundingClientRect === 'function' ? container.getBoundingClientRect() : { left: 0, top: 0 };
  const scrollLeft = typeof container.scrollLeft === 'number' ? container.scrollLeft : 0;
  const scrollTop = typeof container.scrollTop === 'number' ? container.scrollTop : 0;
  return { x: clientX - (rect.left || 0) + scrollLeft, y: clientY - (rect.top || 0) + scrollTop };
}

export function isConnected(element) {
  if (!element) return false;
  if (element.isConnected !== undefined) return element.isConnected === true;
  let node = element;
  while (node && node.parentNode) node = node.parentNode;
  return Boolean(node && node.nodeType === 9);
}

export function focusElement(element) {
  if (element && typeof element.focus === 'function') {
    element.focus();
    return true;
  }
  return false;
}

export function contains(ancestor, node) {
  let current = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parentNode;
  }
  return false;
}

export function hide(element) {
  if (element) element.setAttribute('hidden', '');
}

export function show(element) {
  if (element) element.removeAttribute('hidden');
}
