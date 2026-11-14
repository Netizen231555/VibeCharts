import { createDrawingStore } from '../drawings/index.js';
import { drawLayout, drawPrimitive } from '../drawings/render.js';
import { DRAWING_RESTORE_HOOKS } from '../drawings/store.js';
import { createModuleScope } from '../core/module-scope.js';

export function attachDrawings(chart, { context, historyLimit = 100, alertEngine = null, drawingChartId } = {}) {
  const surface = chart.surface;
  let activeBinding = {};
  const paneContext = binding => binding?.paneId === undefined || binding?.paneId === null
    ? { kind: 'source', scale: chart.indexScale() }
    : chart._paneXContext(binding.paneId);
  const geometry = {
    // Every x query belongs to the pane of the drawing: a derived pane has its own scale and element ids.
    resolveX: (anchor, binding) => surface.resolveAnchor(anchor, { paneId: binding?.paneId }),
    logicalToX: (logical, binding) => surface.logicalToX(logical, { paneId: binding?.paneId }),
    priceToY: (price, binding) => surface.priceToY(price, binding),
    yToPrice: (y, binding) => surface.yToPrice(y, binding),
    getVisibleRect: binding => surface.getVisibleRect(binding ?? activeBinding),
    paneKind: binding => paneContext(binding).kind,
    getIndexCount: binding => paneContext(binding).scale.length,
    getSlot: (index, binding) => {
      const context = paneContext(binding);
      if (context.kind !== 'derived') return chart.timeline.slotAt(index);
      const barId = context.scale.indexToBarId(index);
      return barId === null ? null : { barId };
    },
    indexOf: (id, binding) => paneContext(binding).scale.barIdToIndex(id),
    getSeriesValues: id => chart.series(id).data(),
    hasBinding: ({ paneId, scaleId }) => chart.getInteractionLayout().panes.some(pane => pane.id === paneId && pane.priceScales.some(scale => scale.id === scaleId))
  };
  const store = createDrawingStore({
    context, geometry, historyLimit, alertEngine, drawingChartId,
    deferNotifications(deliver) {
      if (!chart._restoreEvents) return false;
      chart._restoreEvents.push({ kind: 'callback', callback: deliver });
      return true;
    }
  });
  const scope = createModuleScope(chart, 'drawings', store, { subscriptions: ['subscribe'] });
  const alertRegion = alertEngine && chart.container?.ownerDocument?.createElement('div');
  if (alertRegion) {
    alertRegion.setAttribute('role', 'status');
    alertRegion.setAttribute('aria-live', 'polite');
    alertRegion.setAttribute('aria-label', 'Геометрия backend-алертов');
    Object.assign(alertRegion.style, { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)' });
    chart.container.appendChild(alertRegion);
  }
  let alertOverlays = null;
  const invalidate = () => { alertOverlays = null; if (!chart._destroyed) chart.requestRender(); };
  function overlays(drawings) {
    if (alertOverlays) return alertOverlays;
    const byId = new Map(drawings.map(drawing => [drawing.id, drawing]));
    const result = [];
    for (const record of alertEngine?.list?.() ?? []) {
      if (record.authority !== 'backend' || record.backend?.confirmedRevision !== record.revision ||
          record.backend?.confirmedStatus !== 'active') continue;
      for (const source of [record.definition.left, record.definition.right]) {
        if (source.kind !== 'drawing' || (drawingChartId && source.chartId && source.chartId !== drawingChartId)) continue;
        const drawing = byId.get(source.drawingId);
        if (!drawing) continue;
        const type = source.drawingType === 'horizontal' ? 'horizontalLevel' : source.drawingType;
        if (drawing.type !== type) continue;
        const anchors = source.drawingType === 'horizontal' ? [{ price: source.price }] : source.points;
        const different = anchors.length !== drawing.anchors.length || anchors.some((anchor, index) =>
          anchor.anchorBarId !== drawing.anchors[index].anchorBarId || anchor.offset !== drawing.anchors[index].offset ||
          anchor.price !== drawing.anchors[index].price);
        result.push({ drawing, anchors, different, id: record.id, revision: record.backend.confirmedRevision, unknown: record.backend.syncState === 'unknown' });
      }
    }
    alertOverlays = result;
    return result;
  }
  let unsubscribeAlerts = null, unsubscribe = null;
  try {
    if (typeof alertEngine?.subscribe === 'function') {
      const release = alertEngine.subscribe(invalidate);
      if (typeof release !== 'function') throw new TypeError('alertEngine.subscribe must return an unsubscribe function');
      unsubscribeAlerts = release;
    }
    unsubscribe = store.subscribe(invalidate);
    return chart.attach({ name: 'drawings', api: scope.api, hooks: {
      onExportState: () => store.export(),
      onValidateRestore(snapshot) {
        if (snapshot.modules?.drawings !== undefined) {
          createDrawingStore({ context, geometry, historyLimit }).import(snapshot.modules.drawings);
        }
      },
      onCaptureRestore: snapshot => snapshot.modules?.drawings === undefined ? null : store[DRAWING_RESTORE_HOOKS].capture(),
      onRollbackRestore: checkpoint => { if (checkpoint !== null) store[DRAWING_RESTORE_HOOKS].rollback(checkpoint); },
      onRestoreState(snapshot) {
        if (snapshot.modules?.drawings !== undefined) store.import(snapshot.modules.drawings);
      },
      onHistoryPreview(plan) {
        const removed = new Set(plan.removedBarIds);
        return { drawings: [...plan.drawings, ...store.list().filter(drawing => drawing.anchors.some(anchor => removed.has(anchor.anchorBarId))).map(drawing => ({ id: drawing.id }))] };
      },
      onRender({ ctx }) {
        const drawings = store.list();
        const selected = new Set(store.getSelection());
        for (const drawing of drawings) {
          activeBinding = { paneId: drawing.paneId, scaleId: drawing.scaleId };
          const layout = store.layout(drawing.id);
          if (!layout.visible || !layout.resolved) continue;
          drawLayout(ctx, layout, surface.getVisibleRect(activeBinding), false, selected.has(drawing.id));
        }
        const activeAlerts = overlays(drawings);
        if (alertRegion) {
          const text = activeAlerts.map(entry => {
            const anchors = entry.anchors.map(anchor => anchor.anchorBarId === undefined
              ? `${anchor.price}` : `${anchor.anchorBarId} + ${anchor.offset}: ${anchor.price}`).join('; ');
            return `Алерт ${entry.id}: ${entry.unknown ? 'последняя подтверждённая активная геометрия, согласование неизвестно' : 'активен'}; ревизия ${entry.revision}; ${anchors}`;
          }).join('. ');
          if (alertRegion.textContent !== text) alertRegion.textContent = text;
        }
        for (const entry of activeAlerts) {
          const drawing = { ...entry.drawing, anchors: entry.anchors };
          activeBinding = { paneId: drawing.paneId, scaleId: drawing.scaleId };
          const layout = store.layout(drawing);
          const rect = surface.getVisibleRect(activeBinding);
          if (!layout.visible || !layout.resolved || !rect || !layout.primitives.length) continue;
          const first = layout.primitives[0];
          ctx.save();
          try {
            ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.width, rect.height); ctx.clip();
            ctx.strokeStyle = layout.style.color;
            ctx.fillStyle = chart._options.layout.textColor ?? chart._theme.text;
            ctx.globalAlpha = layout.style.opacity;
            ctx.lineWidth = layout.style.width ?? 1;
            if (entry.different) {
              ctx.setLineDash([6, 4]);
              for (const primitive of layout.primitives) drawPrimitive(ctx, primitive, false);
            }
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
            ctx.font = `${chart._options.layout.fontSize ?? 12}px ${chart._options.layout.fontFamily ?? 'sans-serif'}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            const y = Math.max(rect.y + 12, Math.min(rect.y + rect.height - 2, (first.y1 ?? rect.y + 14) - 4));
            ctx.fillText(`Алерт ${entry.id}: ${entry.unknown ? 'последняя подтверждённая активная, согласование неизвестно' : 'активен'} (ревизия ${entry.revision})`, rect.x + 4, y);
          } finally { ctx.restore(); }
        }
        activeBinding = {};
      },
      onDestroy() { try { unsubscribe?.(); unsubscribeAlerts?.(); alertRegion?.remove(); } finally { scope.dispose(); } }
    } });
  } catch (error) { unsubscribe?.(); unsubscribeAlerts?.(); alertRegion?.remove(); scope.dispose(); throw error; }
}
