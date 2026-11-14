/**
 * Theme tokens. Switching a theme changes presentation only: background,
 * grid, axes, candles, lines, crosshair and focus colour. It never touches
 * data, the visible range or the selection, and gain/loss is never conveyed by
 * colour alone (the UI adds a shape and a text label).
 */
import { InteractionError } from '../interaction/errors.js';
import { t } from './messages.js';

export const THEME_NAMES = Object.freeze(['light', 'dark']);

export const THEMES = Object.freeze({
  light: Object.freeze({
    background: '#ffffff',
    grid: '#e5e7eb',
    axis: '#6b7280',
    text: '#111827',
    candleUp: '#0f766e',
    candleDown: '#b91c1c',
    candleEqual: '#6b7280',
    line: '#1d4ed8',
    crosshair: '#334155',
    focus: '#0b63ce',
    menuBackground: '#ffffff',
    menuBorder: '#d1d5db',
  }),
  dark: Object.freeze({
    background: '#0f172a',
    grid: '#1e293b',
    axis: '#94a3b8',
    text: '#e2e8f0',
    candleUp: '#34d399',
    candleDown: '#f87171',
    candleEqual: '#94a3b8',
    line: '#60a5fa',
    crosshair: '#cbd5e1',
    focus: '#7dd3fc',
    menuBackground: '#111827',
    menuBorder: '#334155',
  }),
});

export function createTheme(mode) {
  if (!THEME_NAMES.includes(mode)) {
    throw new InteractionError(`Unknown theme ${mode}`, { code: 'INVALID_THEME', field: 'theme' });
  }
  return {
    mode,
    tokens: { ...THEMES[mode] },
    toggle() {
      return mode === 'light' ? 'dark' : 'light';
    },
  };
}

/**
 * Direction is conveyed with a text label and a shape marker, not only colour.
 */
export function directionLabel(open, close, locale = 'en-US') {
  if (typeof open !== 'number' || typeof close !== 'number' || !Number.isFinite(open) || !Number.isFinite(close)) {
    return { direction: 'unknown', shape: '?', label: t(locale, 'direction.unknown'), colorKey: 'candleEqual' };
  }
  if (close > open) return { direction: 'up', shape: '▲', label: t(locale, 'direction.up'), colorKey: 'candleUp' };
  if (close < open) return { direction: 'down', shape: '▼', label: t(locale, 'direction.down'), colorKey: 'candleDown' };
  return { direction: 'equal', shape: '=', label: t(locale, 'direction.equal'), colorKey: 'candleEqual' };
}

export function valueWithDirection(value, open, close, locale = 'en-US') {
  const direction = directionLabel(open, close, locale);
  return {
    text: `${direction.shape} ${value}`,
    direction: direction.direction,
    label: direction.label,
    shape: direction.shape,
  };
}
