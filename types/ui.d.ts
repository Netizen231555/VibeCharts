import type { Chart, ChartUIOptions, UIHandle, UiController, UiLayout, UiPresetName, UiRegion } from './index.js';
export type { ChartUIOptions, UIHandle, UiController, UiLayout, UiPartContext, UiPartFactory, UiPartInstance, UiPartSpec, UiPresetName, UiRegion } from './index.js';

/** Group of a drawing-rail tool; the rail draws a thin separator where the group changes. */
export type DrawingRailGroup = 'lines' | 'channels' | 'shapes' | 'annotations' | 'analysis';
/** Rail tool id: exactly the key of the drawing library tool it arms (`chart.interaction.armDrawing(id)`). */
export type DrawingRailToolId =
  | 'segment' | 'ray' | 'line' | 'horizontalLevel' | 'horizontalRay' | 'verticalLine' | 'arrow' | 'angle' | 'polyline' | 'brush' | 'bezier'
  | 'parallelChannel' | 'regressionChannel' | 'pitchfork' | 'fibRetracement' | 'fibExtension' | 'fibFan' | 'fibArcs' | 'fibTimeZones'
  | 'rectangle' | 'ellipse' | 'triangle'
  | 'text' | 'callout' | 'flag' | 'priceLabel' | 'marker'
  | 'measure' | 'anchoredVwap';
export interface DrawingRailTool {
  readonly id: DrawingRailToolId;
  readonly group: DrawingRailGroup;
  readonly labelKey: string;
}

export function createChartUI(chart: Chart, options?: ChartUIOptions): UIHandle;
export function createUiController(chart: Chart, options?: Record<string, unknown>): UiController;
export function validateLayout(
  input?: UiPresetName | UiLayout,
  context?: { parts?: Record<string, unknown>; access?: Array<{ id: string; keyboard: unknown; menu: unknown }> },
): { regions: Record<UiRegion, string[]>; parts: Map<string, unknown>; omitted: string[]; without: string[]; uncovered: string[] };
export function createIcon(document: Document, name: string, options?: { size?: number }): SVGElement;
export function hasIcon(name: string): boolean;
export function createToolbarModel(input: Record<string, unknown>): Record<string, unknown>;
export function activateControl(input: Record<string, unknown>): unknown;
export function findControl(input: Record<string, unknown>): unknown;
export function computeResponsiveLayout(input: Record<string, unknown>): Record<string, unknown>;
export function createTheme(name: 'light' | 'dark'): Record<string, string>;
export function directionLabel(value: number | null): string;
export function valueWithDirection(value: number | null, options?: Record<string, unknown>): string;

export const DEFAULT_CHART_LAYOUT: Readonly<UiLayout>;
export const PRESETS: Readonly<Record<UiPresetName, Readonly<UiLayout>>>;
export const REGIONS: readonly UiRegion[];
export const BUILTIN_PARTS: Readonly<Record<string, { regions: readonly UiRegion[]; controls: readonly string[] }>>;
export const STATE_KEYS: readonly string[];
export const ICON_NAMES: readonly string[];
export const CHART_TYPES: readonly string[];
export const DRAWING_TOOLS: readonly DrawingRailTool[];
export const INDICATORS: readonly string[];
export const NARROW_WIDTH: number;
export const THEMES: Readonly<Record<string, Record<string, string>>>;
export const THEME_NAMES: readonly string[];
