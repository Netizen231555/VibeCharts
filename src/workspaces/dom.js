/**
 * Tiny DOM helpers. Every node operation works on the node passed in, so the
 * workspace never reads a global `document`/`window` and can run against a
 * host-provided document (including a test double).
 */
export function documentOf(node) {
  return node?.ownerDocument ?? null;
}

export function createElement(parent, tag, attributes = {}) {
  const doc = documentOf(parent);
  if (!doc || typeof doc.createElement !== 'function') return null;
  const element = doc.createElement(tag);
  if (attributes.className) element.className = attributes.className;
  if (attributes.text !== undefined) element.textContent = String(attributes.text);
  if (attributes.style && element.style) Object.assign(element.style, attributes.style);
  if (attributes.attributes) {
    for (const [name, value] of Object.entries(attributes.attributes)) {
      if (value !== undefined && value !== null) element.setAttribute(name, String(value));
    }
  }
  if (parent) parent.appendChild(element);
  return element;
}

export function appendChild(parent, child) {
  if (parent && child && typeof parent.appendChild === 'function') parent.appendChild(child);
  return child;
}

export function clearChildren(node) {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function removeElement(node) {
  if (!node) return;
  if (typeof node.remove === 'function') node.remove();
  else if (node.parentNode && typeof node.parentNode.removeChild === 'function') node.parentNode.removeChild(node);
}

export function setAttr(node, name, value) {
  if (node && typeof node.setAttribute === 'function') {
    if (value === undefined || value === null) node.removeAttribute(name);
    else node.setAttribute(name, String(value));
  }
}

export function setText(node, text) {
  if (node) node.textContent = String(text);
}

export function setStyle(node, styles) {
  if (!node) return;
  if (node.style) Object.assign(node.style, styles);
}

export function listen(node, type, handler) {
  if (node && typeof node.addEventListener === 'function') node.addEventListener(type, handler);
  return () => {
    if (node && typeof node.removeEventListener === 'function') node.removeEventListener(type, handler);
  };
}

export function focusElement(node) {
  if (node && typeof node.focus === 'function') node.focus();
}
