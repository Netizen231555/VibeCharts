/**
 * DOM-host interface text; language follows the chart `locale` option.
 * A key missing from either table throws.
 */
import { createTranslator } from '../i18n.js';

export const translate = createTranslator({
  en: {
    'labels.otherValues': 'Other values',
    'table.caption': 'Chart data, accessible alternative',
    'table.notProvided': 'not provided',
    'table.bar': 'Bar',
    'table.timeUtc': 'Time (UTC)',
    'table.sessionDate': 'Session date',
    'table.value': 'Value',
    'table.open': 'Open',
    'table.high': 'High',
    'table.low': 'Low',
    'table.close': 'Close',
    'table.direction': 'Direction',
    'table.volume': 'Volume',
    'table.noData': 'No data',
    'table.noVisibleData': 'No visible data',
    'table.up': 'up',
    'table.down': 'down',
    'table.unchanged': 'unchanged',
    'table.unavailable': 'unavailable',
  },
  ru: {
    'labels.otherValues': 'Другие значения',
    'table.caption': 'Данные графика, доступная альтернатива',
    'table.notProvided': 'не указано',
    'table.bar': 'Бар',
    'table.timeUtc': 'Время (UTC)',
    'table.sessionDate': 'Дата сессии',
    'table.value': 'Значение',
    'table.open': 'Открытие',
    'table.high': 'Максимум',
    'table.low': 'Минимум',
    'table.close': 'Закрытие',
    'table.direction': 'Направление',
    'table.volume': 'Объём',
    'table.noData': 'Нет данных',
    'table.noVisibleData': 'Нет видимых данных',
    'table.up': 'вверх',
    'table.down': 'вниз',
    'table.unchanged': 'без изменений',
    'table.unavailable': 'недоступно',
  },
});
