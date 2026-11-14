/**
 * Integration-layer interface text; language follows the chart `locale` option.
 * A key missing from either table throws instead of falling back.
 */
import { createTranslator } from '../i18n.js';

export const translate = createTranslator({
  en: {
    'alerts.region': 'Backend alert geometry',
    'alerts.stateActive': 'active',
    'alerts.stateUnknownGeometry': 'last confirmed active geometry, reconciliation unknown',
    'alerts.stateUnknownShort': 'last confirmed active, reconciliation unknown',
    'alerts.region.line': 'Alert {id}: {state}; revision {revision}; {anchors}',
    'alerts.canvas.line': 'Alert {id}: {state} (revision {revision})',
    'datafeed.operation': 'data source',
    'datafeed.unavailable': 'The data source is unavailable or disconnected',
  },
  ru: {
    'alerts.region': 'Геометрия backend-алертов',
    'alerts.stateActive': 'активен',
    'alerts.stateUnknownGeometry': 'последняя подтверждённая активная геометрия, согласование неизвестно',
    'alerts.stateUnknownShort': 'последняя подтверждённая активная, согласование неизвестно',
    'alerts.region.line': 'Алерт {id}: {state}; ревизия {revision}; {anchors}',
    'alerts.canvas.line': 'Алерт {id}: {state} (ревизия {revision})',
    'datafeed.operation': 'источник данных',
    'datafeed.unavailable': 'Источник недоступен или отключён',
  },
});
