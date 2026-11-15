// Text metrics are measured in CSS pixels, independent of the canvas device-pixel transform.
export function layoutText(item, rect, context) {
  const style = item.textStyle;
  const font = style
    ? `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.size}px sans-serif`
    : context?.font ?? '10px sans-serif';
  const align = style?.align ?? context?.textAlign ?? 'start';
  const baseline = item.caption ? 'alphabetic' : (style ? 'alphabetic' : context?.textBaseline ?? 'alphabetic');
  const size = style?.size ?? (parseFloat(font.match(/([\d.]+)px/)?.[1]) || 10);
  const lineHeight = size * 1.2;
  const lines = String(item.text).split('\n');
  const metrics = [];
  if (context) {
    context.save();
    context.font = font;
    context.textAlign = align;
    context.textBaseline = baseline;
  }
  try {
    for (const line of lines) {
      const m = context?.measureText(line);
      const width = m?.width ?? line.length * size * 0.6;
      const factor = align === 'center' ? 0.5 : align === 'end' || align === 'right' ? 1 : 0;
      metrics.push({ left: Number.isFinite(m?.actualBoundingBoxLeft) ? m.actualBoundingBoxLeft : width * factor,
        right: Number.isFinite(m?.actualBoundingBoxRight) ? m.actualBoundingBoxRight : width * (1 - factor),
        ascent: m?.actualBoundingBoxAscent || size * 0.8, descent: m?.actualBoundingBoxDescent || size * 0.2 });
    }
  } finally { if (context) context.restore(); }
  let x = item.x, y = item.y;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  metrics.forEach((m, i) => {
    left = Math.min(left, x - m.left); right = Math.max(right, x + m.right);
    top = Math.min(top, y + i * lineHeight - m.ascent); bottom = Math.max(bottom, y + i * lineHeight + m.descent);
  });
  if (item.caption) {
    if (item.placement === 'above') { const dy = item.y - 4 - bottom; y += dy; top += dy; bottom += dy; }
    if (item.placement === 'inside') { const dy = item.y + 4 - top; y += dy; top += dy; bottom += dy; }
    if (item.placement === 'beside') {
      const dx = item.x + 4 - left;
      const fraction = align === 'start' ? 0 : align === 'end' ? 1 : 0.5;
      const dy = item.y - (top + (bottom - top) * fraction);
      x += dx; left += dx; right += dx; y += dy; top += dy; bottom += dy;
    }
    const dx = right - left > rect.width || left < rect.x ? rect.x - left : right > rect.x + rect.width ? rect.x + rect.width - right : 0;
    const dy = bottom - top > rect.height || top < rect.y ? rect.y - top : bottom > rect.y + rect.height ? rect.y + rect.height - bottom : 0;
    x += dx; left += dx; right += dx; y += dy; top += dy; bottom += dy;
  }
  const clippedLeft = Math.max(rect.x, left), clippedTop = Math.max(rect.y, top);
  const clippedRight = Math.min(rect.x + rect.width, right), clippedBottom = Math.min(rect.y + rect.height, bottom);
  return { x, y, font, align, baseline, lines, lineHeight,
    bounds: clippedRight >= clippedLeft && clippedBottom >= clippedTop
      ? { x: clippedLeft, y: clippedTop, width: clippedRight - clippedLeft, height: clippedBottom - clippedTop } : null };
}

export function paintText(ctx, item) {
  const text = item.textLayout;
  if (!text) return;
  ctx.save();
  try {
    ctx.font = text.font; ctx.textAlign = text.align; ctx.textBaseline = text.baseline;
    if (item.color !== undefined) ctx.fillStyle = item.color;
    text.lines.forEach((line, index) => ctx.fillText(line, text.x, text.y + index * text.lineHeight));
  } finally { ctx.restore(); }
}
