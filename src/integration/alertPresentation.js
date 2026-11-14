import { alertLineModel, createAlertListModel } from '../alerts/ui.js';
import { createModuleScope } from '../core/module-scope.js';

/** Render levels only when their series or indicator output has a known binding. */
export function attachAlertPresentation(chart, engine, { chartId } = {}) {
  const model = createAlertListModel({ engine, onError: ({ operation, error }) => chart.surface.emit('error', { operation, error }) });
  let lines = [];
  // Uncommitted drag price; the engine definition is untouched until release.
  let drag = null;
  const unsubscribe = model.subscribe(() => { if (!chart._destroyed) chart.requestRender(); });
  const api = {
    list: () => model.list(),
    selectedId: () => model.selectedId(),
    select: id => model.select(id),
    subscribe: listener => model.subscribe(listener),
    getDiagnostics: () => model.getDiagnostics(),
    hitTest(point, paneId, radius = 5) {
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i];
        if (line.paneId === paneId && point.x >= line.rect.x && point.x <= line.rect.x + line.rect.width && Math.abs(point.y - line.y) <= radius) return line.id;
      }
      return null;
    },
    /**
     * Vertical drag of a constant-threshold level line. `null` when the line is
     * not drawn (no draggable level). Nothing reaches the engine before
     * `commit`, which throws on rejection so the caller can report it; the
     * preview is always dropped and the line snaps back to the stored price.
     */
    beginDrag(id) {
      const target = lines.find(line => line.id === id);
      if (!target || !target.constantSide) return null;
      const priceAt = y => {
        const price = chart.surface.yToPrice(y, target.binding);
        if (!Number.isFinite(price)) throw new TypeError('alert drag: price is not available at this position');
        return price;
      };
      const clear = () => { drag = null; if (!chart._destroyed) chart.requestRender(); };
      return {
        move(point) {
          drag = { id, price: priceAt(point.y) };
          chart.requestRender();
        },
        commit(point) {
          const price = priceAt(point.y);
          clear();
          const record = model.get(id);
          if (!record) throw new Error('alert drag: the alert no longer exists');
          const definition = engine.get(id).definition;
          const side = target.constantSide;
          return model.edit(id, { [side]: { ...definition[side], value: price } }, record.revision);
        },
        cancel: clear
      };
    }
  };
  const scope = createModuleScope(chart, 'alertUI', api, { subscriptions: ['subscribe'] });
  try {
    return chart.attach({
      name: 'alertUI',
      api: scope.api,
      hooks: {
        onRender({ ctx }) {
          const series = new Map(chart.series.list().map(entry => [entry.id, entry]));
          const next = [];
          for (const record of engine.list()) {
            const { definition } = record;
            const source = definition.left.kind === 'constant' ? definition.right : definition.right.kind === 'constant' ? definition.left : null;
            if (!source || (source.chartId && source.chartId !== chartId)) continue;
            const seriesId = source.kind === 'series'
              ? source.seriesId
              : source.kind === 'indicator'
                ? chart.indicators.get(source.indicatorId)?.getState().outputSeries[source.output]
                : null;
            const bound = series.get(seriesId);
            if (!bound || !bound.visible) continue;
            const binding = { paneId: bound.paneId, scaleId: bound.priceScaleId };
            const scale = chart.priceScale(binding.paneId, binding.scaleId);
            const line = alertLineModel(record, { scale: scale.mode });
            if (!line.displayable || line.kind !== 'level') continue;
            const rect = chart.surface.getVisibleRect(binding);
            const y = chart.surface.priceToY(drag?.id === record.id ? drag.price : line.value, binding);
            if (!rect || !Number.isFinite(y) || y < rect.y || y > rect.y + rect.height) continue;
            const selected = model.selectedId() === record.id;
            ctx.save();
            try {
              ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.width, rect.height); ctx.clip();
              ctx.strokeStyle = selected ? chart._theme.areaLine : chart._theme.mutedText;
              ctx.fillStyle = ctx.strokeStyle;
              ctx.lineWidth = selected ? 2 : 1;
              ctx.setLineDash(selected ? [] : [5, 4]);
              ctx.beginPath(); ctx.moveTo(rect.x, y); ctx.lineTo(rect.x + rect.width, y); ctx.stroke();
              ctx.font = '12px sans-serif';
              ctx.fillText(`${definition.name ?? definition.id} — ${record.evaluation.status}`, rect.x + 4, Math.max(rect.y + 12, y - 3), Math.max(0, rect.width - 8));
            } finally { ctx.restore(); }
            next.push({ id: record.id, paneId: bound.paneId, rect, y, binding, constantSide: definition.left.kind === 'constant' ? 'left' : 'right' });
          }
          lines = next;
        },
        onDestroy() { try { unsubscribe(); model.dispose(); lines = []; } finally { scope.dispose(); } }
      }
    });
  } catch (error) {
    unsubscribe();
    model.dispose();
    scope.dispose();
    throw error;
  }
}
