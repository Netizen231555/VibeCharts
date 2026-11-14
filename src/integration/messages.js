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
    'alerts.status.active': 'active',
    'alerts.status.paused': 'paused',
    'alerts.status.completed': 'completed',
    'alerts.status.expired': 'expired',
    'alerts.status.error': 'error',
    'alerts.status.unknown': 'unknown',
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
    'alerts.status.active': 'активен',
    'alerts.status.paused': 'на паузе',
    'alerts.status.completed': 'сработал',
    'alerts.status.expired': 'истёк',
    'alerts.status.error': 'ошибка',
    'alerts.status.unknown': 'неизвестно',
    'datafeed.operation': 'источник данных',
    'datafeed.unavailable': 'Источник недоступен или отключён',
  },
});
