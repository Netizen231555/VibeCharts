import type { AlertEngine, DrawingStore } from './index.js';

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
