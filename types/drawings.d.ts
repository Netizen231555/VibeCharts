import type { AlertEngine, DrawingStore } from './index.js';

/** Both flags default to false. A tool without the corresponding coordinate rejects true. */
export interface DrawingAxisLabels {
  price?: boolean;
  time?: boolean;
}

/** Line tools default to all figures off and always false; measure defaults to all on and always true. */
export interface DrawingStats {
  priceRange?: boolean;
  percent?: boolean;
  bars?: boolean;
  time?: boolean;
  position?: 'start' | 'center' | 'end';
  always?: boolean;
}

/** Caption text is limited to 200 characters and three lines. */
export interface DrawingCaption {
  text: string;
  color?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  align?: 'start' | 'center' | 'end';
}

export interface DrawingTextStyle {
  size?: number;
  bold?: boolean;
  italic?: boolean;
  align?: 'start' | 'center' | 'end';
}

export interface DrawingTextProperties {
  label?: DrawingCaption | null;
  textStyle?: DrawingTextStyle;
}

export interface DrawingAxisLabelEntry {
  axis: 'price' | 'time';
  anchorIndex: number;
  price?: number;
  logical?: number | null;
  unavailable?: 'no-time';
}

export interface DrawingLayoutLabel {
  x: number;
  y: number;
  text?: string;
  lines?: string[];
  selectedOnly?: boolean;
  [key: string]: unknown;
}

export interface DrawingLayout {
  axisLabels?: DrawingAxisLabelEntry[];
  labels: DrawingLayoutLabel[];
  [key: string]: unknown;
}

export class DrawingError extends Error {
  readonly code?: string;
  readonly field?: string;
}

export function createDrawingStore(options: {
  context: { instrumentId: string; interval: string; sourceId: string; view?: string };
  geometry: Record<string, (...args: unknown[]) => unknown>;
  historyLimit: number;
  alertEngine?: AlertEngine;
  drawingChartId?: string;
  deferNotifications?: (deliver: () => void) => boolean;
}): DrawingStore;

export function validateStyle(input: Record<string, unknown>): Record<string, unknown>;
export function completeStyle(input: Record<string, unknown>): Record<string, unknown>;
export function defaultStyle(type: string): Record<string, unknown>;

export const DRAWINGS_FORMAT: string;
export const DRAWINGS_SCHEMA_VERSION: number;
export const DRAWINGS_PITCHFORK_VARIANTS: readonly string[];
export const DRAWING_TOOLS: Readonly<Record<string, unknown>>;
export const DRAWING_TOOL_TYPES: readonly string[];
export const PITCHFORK_VARIANTS: readonly string[];
export const STYLE_FAMILIES: Readonly<Record<string, unknown>>;
