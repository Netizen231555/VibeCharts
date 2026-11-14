export function drawPrimitive(ctx, primitive, fill) {
  const p = primitive;
  if (p.kind === 'text') { ctx.fillText(String(p.text), p.x, p.y); return; }
  ctx.beginPath();
  switch (p.kind) {
    case 'segment': case 'line': case 'ray':
      ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); break;
    case 'polygon': case 'polyline': case 'marker': case 'bezier':
      if (!p.points.length) return;
      ctx.moveTo(p.points[0].x, p.points[0].y);
      for (let i = 1; i < p.points.length; i += 1) ctx.lineTo(p.points[i].x, p.points[i].y);
      if (p.kind === 'polygon') ctx.closePath();
      break;
    case 'ellipse': ctx.ellipse(p.cx, p.cy, p.rx, p.ry, 0, 0, Math.PI * 2); break;
    case 'circle': ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2); break;
    case 'arc': ctx.arc(p.cx, p.cy, p.r, p.startAngle, p.endAngle); break;
    default: throw new Error(`Unsupported drawing primitive: ${p.kind}`);
  }
  if (p.kind === 'polygon' && fill) ctx.fill();
  if (p.kind === 'marker') ctx.lineWidth = p.width;
  ctx.stroke();
}

export function drawLayout(ctx, layout, rect, preview = false, selected = false) {
  ctx.save();
  try {
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.width, rect.height); ctx.clip();
    ctx.strokeStyle = layout.style.color; ctx.fillStyle = layout.style.fillColor ?? layout.style.color;
    ctx.globalAlpha = layout.style.opacity; ctx.lineWidth = layout.style.width ?? 1;
    ctx.setLineDash(preview || layout.style.dash === 'dashed' ? [6, 4] : layout.style.dash === 'dotted' ? [2, 3] : []);
    if (selected) {
      ctx.save();
      ctx.strokeStyle = '#2962ff';
      ctx.fillStyle = '#2962ff';
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = (layout.style.width ?? 1) + 5;
      ctx.setLineDash([]);
      for (const primitive of layout.primitives) drawPrimitive(ctx, primitive, false);
      ctx.restore();
    }
    for (const primitive of layout.primitives) drawPrimitive(ctx, primitive, layout.style.fill === true);
    ctx.fillStyle = layout.style.color;
    for (const label of layout.labels) ctx.fillText(String(label.text), label.x, label.y);
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
