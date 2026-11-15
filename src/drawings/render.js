import { paintText } from './text-layout.js';

// Rise and fall colours of geometry that carries a `tone` (the measure tool); the drawing's own colour is not used.
const TONES = {
  up: { line: '#2f9e6f', area: 'rgba(47, 158, 111, 0.16)', box: '#27805a' },
  down: { line: '#d0555b', area: 'rgba(208, 85, 91, 0.16)', box: '#b8434a' },
};

export function drawPrimitive(ctx, primitive, fill, plain = false, fillAlpha = 1) {
  const p = primitive;
  if (p.kind === 'text') {
    if (p.textLayout) paintText(ctx, p); else ctx.fillText(String(p.text), p.x, p.y);
    return;
  }
  const tone = plain ? undefined : TONES[p.tone];
  if (tone) {
    ctx.save();
    ctx.strokeStyle = tone.line;
    ctx.fillStyle = p.role === 'measure-area' ? tone.area : tone.line;
    ctx.setLineDash([]);
  }
  try {
    ctx.beginPath();
    switch (p.kind) {
      case 'segment': case 'line': case 'ray':
        ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); break;
      case 'zone': case 'polygon': case 'polyline': case 'marker': case 'bezier':
        if (!p.points.length) return;
        ctx.moveTo(p.points[0].x, p.points[0].y);
        for (let i = 1; i < p.points.length; i += 1) ctx.lineTo(p.points[i].x, p.points[i].y);
        if (p.kind === 'polygon' || p.kind === 'zone') ctx.closePath();
        break;
      case 'ellipse': ctx.ellipse(p.cx, p.cy, p.rx, p.ry, 0, 0, Math.PI * 2); break;
      case 'circle': ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2); break;
      case 'arc': ctx.arc(p.cx, p.cy, p.r, p.startAngle, p.endAngle); break;
      case 'ring': {
        const start = p.full ? 0 : p.startAngle;
        const end = p.full ? Math.PI * 2 : p.endAngle;
        ctx.arc(p.cx, p.cy, p.r, start, end);
        ctx.lineTo(p.cx + p.innerRadius * Math.cos(end), p.cy + p.innerRadius * Math.sin(end));
        ctx.arc(p.cx, p.cy, p.innerRadius, end, start, true);
        ctx.closePath();
        break;
      }
      default: throw new Error(`Unsupported drawing primitive: ${p.kind}`);
    }
    if (p.kind === 'zone' || p.kind === 'ring') {
      ctx.fill();
    } else if (tone) {
      if (p.kind === 'polygon') ctx.fill();
    } else if (fill && p.fillable === true) {
      // Fill pass at its own alpha (canvas closes an open path with an implicit chord); the stroke keeps the base alpha.
      const base = ctx.globalAlpha;
      ctx.globalAlpha = fillAlpha;
      ctx.fill();
      ctx.globalAlpha = base;
    }
    if (p.kind === 'marker') ctx.lineWidth = p.width;
    if (p.stroke !== false) ctx.stroke();
  } finally {
    if (tone) ctx.restore();
  }
}

// A label is plain text at its point, or a badge (`box`) of centred lines placed above or below the point and kept
// inside the visible rectangle.
function drawLabel(ctx, label, rect) {
  if (label.textLayout) { paintText(ctx, label); return; }
  if (!label.box) { ctx.fillText(String(label.text), label.x, label.y); return; }
  const tone = TONES[label.box.tone] ?? TONES.up;
  ctx.save();
  try {
    ctx.font = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.setLineDash([]);
    const lines = label.lines ?? [String(label.text)];
    const padX = 8;
    const padY = 5;
    const lineHeight = 16;
    const width = Math.max(...lines.map(line => ctx.measureText(line).width)) + padX * 2;
    const height = lines.length * lineHeight + padY * 2 - 4;
    let x = label.x - width / 2;
    let y = label.placement === 'below' ? label.y : label.y - height;
    x = Math.max(rect.x + 2, Math.min(rect.x + rect.width - width - 2, x));
    y = Math.max(rect.y + 2, Math.min(rect.y + rect.height - height - 2, y));
    ctx.globalAlpha = 1;
    ctx.fillStyle = tone.box;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, width, height, 4); else ctx.rect(x, y, width, height);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((line, index) => ctx.fillText(line, x + width / 2, y + padY + lineHeight / 2 - 2 + index * lineHeight));
  } finally { ctx.restore(); }
}

export function drawLayout(ctx, layout, rect, preview = false, selected = false) {
  ctx.save();
  try {
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.width, rect.height); ctx.clip();
    ctx.strokeStyle = layout.style.color; ctx.fillStyle = layout.style.color;
    ctx.globalAlpha = layout.style.opacity; ctx.lineWidth = layout.style.width ?? 1;
    ctx.setLineDash(preview || layout.style.dash === 'dashed' ? [6, 4] : layout.style.dash === 'dotted' ? [2, 3] : []);
    const fillAlpha = layout.style.opacity * (layout.style.fillOpacity ?? 1);
    if (selected) {
      ctx.save();
      ctx.strokeStyle = '#2962ff';
      ctx.fillStyle = '#2962ff';
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = (layout.style.width ?? 1) + 5;
      ctx.setLineDash([]);
      for (const primitive of layout.primitives) {
        if (primitive.stroke === false) continue;
        drawPrimitive(ctx, primitive, false, true);
      }
      ctx.restore();
    }
    for (const primitive of layout.primitives) {
      if (primitive.color !== undefined || primitive.opacity !== undefined) {
        ctx.save();
        ctx.strokeStyle = primitive.color ?? layout.style.color;
        ctx.fillStyle = primitive.color ?? layout.style.color;
        ctx.globalAlpha = primitive.opacity ?? layout.style.opacity;
        drawPrimitive(ctx, primitive, layout.style.fill === true, false, fillAlpha);
        ctx.restore();
      } else drawPrimitive(ctx, primitive, layout.style.fill === true, false, fillAlpha);
    }
    for (const label of layout.labels) {
      if (label.selectedOnly === true && !selected) continue;
      if (label.color !== undefined || label.opacity !== undefined || label.align) {
        ctx.save();
        ctx.fillStyle = label.color ?? layout.style.color;
        ctx.globalAlpha = label.opacity ?? layout.style.opacity;
        ctx.textAlign = label.align ?? 'left';
        drawLabel(ctx, label, rect);
        ctx.restore();
      } else drawLabel(ctx, label, rect);
    }
    if (selected) {
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#2962ff';
      ctx.fillStyle = '#fff';
      for (const handle of layout.handles) {
        ctx.beginPath(); ctx.arc(handle.x, handle.y, 4, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
    }
  } finally { ctx.restore(); }
}
