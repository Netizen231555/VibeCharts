/**
 * Semantic toolbar model. Controls are buttons, toggles and selects with
 * explicit names; an unavailable action is disabled together with a reason and
 * never acts as a no-op.
 */
import { InteractionError } from '../interaction/errors.js';

export const CHART_TYPES = Object.freeze([
  { id: 'candles', label: 'Свечи' },
  { id: 'bars', label: 'OHLC-бары' },
  { id: 'line', label: 'Линия закрытия' },
]);

export const INDICATORS = Object.freeze([
  { id: 'sma20', label: 'SMA(20)' },
  { id: 'ema20', label: 'EMA(20)' },
]);

export const DRAWING_TOOLS = Object.freeze([
  { id: 'trendLine', label: 'Отрезок' },
  { id: 'horizontalLine', label: 'Горизонтальный уровень' },
  { id: 'verticalLine', label: 'Вертикальный уровень' },
  { id: 'rectangle', label: 'Прямоугольник' },
  { id: 'fibRetracement', label: 'Фибоначчи' },
]);

const REASONS = Object.freeze({
  chartType: 'Смена типа графика не подключена',
  indicator: 'Выбор индикатора не подключён',
  drawing: 'Инструмент построения не подключён',
  clear: 'Очистка рисунков не подключена',
  undo: 'Нечего отменять',
  redo: 'Нечего повторять',
  interval: 'Переключение интервала не подключено',
  navigation: 'Навигация графика недоступна',
  theme: 'Управление темой недоступно',
  table: 'Таблица данных недоступна',
  logScale: 'Переключение шкалы цены недоступно',
  logScalePercent: 'Процентная шкала: переключение на логарифмическую недоступно',
  logScaleNone: 'Ценовая шкала недоступна',
  drawingSnap: 'Привязка рисунков недоступна',
  crosshair: 'Клавиатурное перекрестие недоступно',
});

/** Log toggle availability: the host hook, a scale to act on, and not a percent scale (its base is owned by the host). */
function logScaleAvailability(current, capabilities) {
  if (capabilities.canLogScale === false) return { enabled: false, reason: REASONS.logScale };
  if (current.priceMode === 'percent') return { enabled: false, reason: REASONS.logScalePercent };
  if (current.priceMode === null) return { enabled: false, reason: REASONS.logScaleNone };
  return { enabled: true, reason: null };
}

export function createToolbarModel({ current = {}, capabilities = {} } = {}) {
  if (typeof current !== 'object' || current === null) {
    throw new InteractionError('Toolbar current state must be an object', { code: 'INVALID_TOOLBAR', field: 'current' });
  }
  const chartTypes = current.chartTypes || CHART_TYPES;
  const indicators = current.indicators || INDICATORS;
  const tools = current.tools || DRAWING_TOOLS;
  const intervals = current.intervals || [];

  return {
    groups: [
      {
        id: 'chartType',
        label: 'Тип графика',
        controls: chartTypes.map((entry) => ({
          id: `chartType:${entry.id}`,
          kind: 'toggle',
          label: entry.label,
          pressed: current.chartType === entry.id,
          enabled: capabilities.canChangeChartType !== false,
          reason: capabilities.canChangeChartType === false ? REASONS.chartType : null,
          action: 'chartType',
          value: entry.id,
        })),
      },
      {
        id: 'indicators',
        label: 'Индикатор',
        controls: indicators.map((entry) => ({
          id: `indicator:${entry.id}`,
          kind: 'toggle',
          label: entry.label,
          pressed: current.indicator === entry.id,
          enabled: capabilities.canSelectIndicator !== false,
          reason: capabilities.canSelectIndicator === false ? REASONS.indicator : null,
          action: 'indicator',
          value: entry.id,
        })),
      },
      {
        id: 'tools',
        label: 'Инструменты построения',
        controls: tools.map((entry) => ({
          id: `tool:${entry.id}`,
          kind: 'toggle',
          label: entry.label,
          pressed: current.tool === entry.id,
          enabled: capabilities.canDraw !== false,
          reason: capabilities.canDraw === false ? REASONS.drawing : null,
          action: 'tool',
          value: entry.id,
        })),
      },
      {
        id: 'actions',
        label: 'Действия',
        controls: [
          {
            id: 'clearDrawings',
            kind: 'button',
            label: 'Очистить рисунки',
            enabled: capabilities.canClearDrawings !== false,
            reason: capabilities.canClearDrawings === false ? REASONS.clear : null,
            action: 'clearDrawings',
          },
          {
            id: 'undo',
            kind: 'button',
            label: 'Отменить рисунок',
            enabled: capabilities.canUndo !== false,
            reason: capabilities.canUndo === false ? REASONS.undo : null,
            action: 'undo',
          },
          {
            id: 'redo',
            kind: 'button',
            label: 'Повторить рисунок',
            enabled: capabilities.canRedo !== false,
            reason: capabilities.canRedo === false ? REASONS.redo : null,
            action: 'redo',
          },
          ...[
            ['panLeft', 'Сдвинуть график влево'],
            ['panRight', 'Сдвинуть график вправо'],
            ['zoomIn', 'Увеличить масштаб графика'],
            ['zoomOut', 'Уменьшить масштаб графика'],
            ['priceZoomIn', 'Увеличить масштаб цены'],
            ['priceZoomOut', 'Уменьшить масштаб цены'],
            ['crosshairPrev', 'Предыдущий бар'],
            ['crosshairNext', 'Следующий бар'],
          ].map(([id, label]) => ({
            id, kind: 'button', label, action: id,
            enabled: capabilities.canKeyboardActions !== false,
            reason: capabilities.canKeyboardActions === false ? REASONS.navigation : null,
          })),
          {
            id: 'fitContent',
            kind: 'button',
            label: 'Подогнать данные',
            enabled: capabilities.canNavigate !== false,
            reason: capabilities.canNavigate === false ? REASONS.navigation : null,
            action: 'fitContent',
          },
          {
            id: 'scrollToRealTime',
            kind: 'button',
            label: 'К последнему бару',
            enabled: capabilities.canNavigate !== false,
            reason: capabilities.canNavigate === false ? REASONS.navigation : null,
            action: 'scrollToRealTime',
          },
          {
            id: 'priceAuto',
            kind: 'button',
            label: 'Автомасштаб цены',
            enabled: capabilities.canPriceAuto !== false,
            reason: capabilities.canPriceAuto === false ? REASONS.navigation : null,
            action: 'priceAuto',
          },
          {
            id: 'follow',
            kind: 'toggle',
            label: 'Следование последнему бару',
            pressed: current.follow === true,
            enabled: capabilities.canNavigate !== false,
            reason: capabilities.canNavigate === false ? REASONS.navigation : null,
            action: 'follow',
          },
          {
            id: 'crosshair',
            kind: 'toggle',
            label: 'Перекрестие с клавиатуры',
            pressed: current.crosshair === true,
            enabled: capabilities.canToggleCrosshair !== false,
            reason: capabilities.canToggleCrosshair === false ? REASONS.crosshair : null,
            action: 'crosshair',
          },
          {
            id: 'theme',
            kind: 'toggle',
            label: 'Тёмная тема',
            pressed: current.theme === 'dark',
            enabled: capabilities.canToggleTheme !== false,
            reason: capabilities.canToggleTheme === false ? REASONS.theme : null,
            action: 'theme',
          },
          {
            id: 'accessibleTable',
            kind: 'toggle',
            label: 'Таблица данных',
            pressed: current.tableVisible !== false,
            enabled: capabilities.canShowTable !== false,
            reason: capabilities.canShowTable === false ? REASONS.table : null,
            action: 'accessibleTable',
          },
          {
            id: 'logScale',
            kind: 'toggle',
            label: 'Логарифмическая шкала',
            pressed: current.priceMode === 'log',
            ...logScaleAvailability(current, capabilities),
            action: 'logScale',
          },
          {
            id: 'drawingSnap',
            kind: 'toggle',
            label: 'Привязка рисунков',
            // Strong snapping (set from the drawing dialog) also counts as on; the toggle then turns it off.
            pressed: typeof current.snapMode === 'string' && current.snapMode !== 'free',
            enabled: capabilities.canDrawingSnap !== false,
            reason: capabilities.canDrawingSnap === false ? REASONS.drawingSnap : null,
            action: 'drawingSnap',
          },
        ],
      },
      ...(intervals.length > 0
        ? [
            {
              id: 'interval',
              label: 'Интервал',
              controls: [
                {
                  id: 'interval',
                  kind: 'select',
                  label: 'Интервал',
                  value: current.interval || '',
                  options: intervals.map((entry) => ({ value: entry.id, label: entry.label })),
                  enabled: capabilities.canChangeInterval !== false,
                  reason: capabilities.canChangeInterval === false ? REASONS.interval : null,
                  action: 'interval',
                },
              ],
            },
          ]
        : []),
    ],
  };
}

export function findControl(model, id) {
  for (const group of model.groups) {
    const control = group.controls.find((entry) => entry.id === id);
    if (control) return { control, group };
  }
  return null;
}

export function activateControl(model, id, { disabled = null } = {}) {
  const found = findControl(model, id);
  if (!found) throw new InteractionError(`Unknown control ${id}`, { code: 'UNKNOWN_CONTROL', field: 'id' });
  if (found.control.enabled === false || disabled === true) {
    return { ok: false, code: 'CONTROL_DISABLED', id, reason: found.control.reason || 'Действие недоступно' };
  }
  return { ok: true, id, action: found.control.action, value: found.control.value };
}
