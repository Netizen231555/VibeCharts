/**
 * Canvas color tokens. Themes never carry data; they only affect drawing.
 */
export const THEMES = Object.freeze({
  dark: Object.freeze({
    name: 'dark',
    background: '#0f141a',
    text: '#d7dee8',
    mutedText: '#8b98a8',
    grid: '#1e2833',
    axisBorder: '#26313d',
    crosshair: '#8b98a8',
    crosshairLabel: '#243040',
    focus: '#7dd3fc',
    up: '#2fa77a',
    down: '#e0615a',
    equal: '#b0bec5',
    wickUp: '#2fa77a',
    wickDown: '#e0615a',
    borderUp: '#278a65',
    borderDown: '#b94c47',
    volume: '#4a5a6a',
    areaLine: '#4f8cff',
    areaFill: 'rgba(79, 140, 255, 0.18)',
    baselineAboveLine: '#2fa77a',
    baselineBelowLine: '#e0615a',
    baselineAboveFill: 'rgba(47, 167, 122, 0.18)',
    baselineBelowFill: 'rgba(224, 97, 90, 0.18)',
    lastValueBackground: '#243040',
    lastValueText: '#f2f5f9'
  }),
  light: Object.freeze({
    name: 'light',
    background: '#ffffff',
    text: '#1f2328',
    mutedText: '#5b6572',
    grid: '#e6e8eb',
    axisBorder: '#d0d7de',
    crosshair: '#5b6572',
    crosshairLabel: '#e9edf2',
    focus: '#0b63ce',
    up: '#0a8f5b',
    down: '#d14343',
    equal: '#6b7280',
    wickUp: '#0a8f5b',
    wickDown: '#d14343',
    borderUp: '#087a4d',
    borderDown: '#b23636',
    volume: '#9aa4b2',
    areaLine: '#2563eb',
    areaFill: 'rgba(37, 99, 235, 0.16)',
    baselineAboveLine: '#0a8f5b',
    baselineBelowLine: '#d14343',
    baselineAboveFill: 'rgba(10, 143, 91, 0.14)',
    baselineBelowFill: 'rgba(209, 67, 67, 0.14)',
    lastValueBackground: '#e9edf2',
    lastValueText: '#1f2328'
  })
});

export function resolveTheme(name) {
  const theme = THEMES[name];
  if (!theme) throw new Error(`unknown theme "${name}"`);
  return theme;
}
