import type { Chart, ChartUIOptions, UIHandle, UiController, UiLayout, UiPresetName, UiRegion, UiModel, UiControl, UiControlGroup, UiActionResult, UiActionAccess, UiStateKey, UiReadKey } from './index.js';
export type { ChartUIOptions, UIHandle, UiController, UiLayout, UiPartContext, UiPartFactory, UiPartInstance, UiPartSpec, UiPresetName, UiRegion, UiModel, UiControl, UiControlGroup, UiActionResult, UiActionAccess, UiStateKey, UiReadKey } from './index.js';

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
export function createIcon(document: Document, name: string, options?: { size?: number; icons?: Readonly<Record<string, readonly string[]>> }): SVGElement;
export function hasIcon(name: string): boolean;
export interface UiToolbarCurrent {
  chartType?: string | null; indicator?: string | null; tool?: string | null; interval?: string;
  priceMode?: string | null; snapMode?: string | null; theme?: 'light' | 'dark'; follow?: boolean; crosshair?: boolean; tableVisible?: boolean;
  /** Replace the built-in lists; a tool entry is `{ id, label, group? }`. */
  chartTypes?: ReadonlyArray<{ id: string; label?: string; labelKey?: string }>;
  indicators?: ReadonlyArray<{ id: string; label?: string; labelKey?: string }>;
  tools?: ReadonlyArray<{ id: string; label?: string; labelKey?: string; group?: string; groupLabel?: string }>;
  intervals?: ReadonlyArray<{ id: string; label: string }>;
}
/** Pure: builds the control model from state and capabilities (`false` disables the matching controls with a reason). */
export function createToolbarModel(input?: { current?: UiToolbarCurrent; capabilities?: Record<string, boolean>; locale?: string }): UiModel;
export function activateControl(model: UiModel, id: string, options?: { disabled?: boolean | null; locale?: string }):
  | { ok: true; id: string; action: string; value: string | undefined }
  | { ok: false; code: 'CONTROL_DISABLED'; id: string; reason: string };
export function findControl(model: UiModel, id: string): { control: UiControl; group: UiControlGroup } | null;
export function computeResponsiveLayout(input: Record<string, unknown>): Record<string, unknown>;
export function createTheme(name: 'light' | 'dark'): Record<string, string>;
export function directionLabel(value: number | null): string;
export function valueWithDirection(value: number | null, options?: Record<string, unknown>): string;

export const DEFAULT_CHART_LAYOUT: Readonly<UiLayout>;
export const PRESETS: Readonly<Record<UiPresetName, Readonly<UiLayout>>>;
export const REGIONS: readonly UiRegion[];
export const BUILTIN_PARTS: Readonly<Record<string, { regions: readonly UiRegion[]; controls: readonly string[] }>>;
export const STATE_KEYS: readonly UiStateKey[];
export const ICON_NAMES: readonly string[];
export const CHART_TYPES: ReadonlyArray<{ readonly id: string; readonly labelKey: string }>;
export const DRAWING_TOOLS: readonly DrawingRailTool[];
export const INDICATORS: ReadonlyArray<{ readonly id: string; readonly label: string }>;
export const NARROW_WIDTH: number;
export const THEMES: Readonly<Record<string, Record<string, string>>>;
export const THEME_NAMES: readonly string[];

export interface DrawingSettingsField {
  readonly id: string;
  readonly tab: 'style' | 'text' | 'coordinates';
  readonly group: string;
  readonly order: number;
  readonly type: 'color' | 'number' | 'boolean' | 'select' | 'text' | 'levels' | 'anchors';
  readonly labelKey: string;
  readonly appliesTo: { readonly tools?: readonly string[]; readonly families?: readonly string[] };
}

export interface DrawingSettingsDescription {
  readonly ids: readonly string[];
  readonly types: readonly string[];
  readonly count: number;
  readonly locked: boolean;
  readonly tabs: readonly { readonly id: string; readonly label: string; readonly groups: readonly unknown[] }[];
}

/** Describes (and applies) the editable settings of selected drawings. Headless: no DOM. */
export function listDrawingSettingsFields(): readonly DrawingSettingsField[];
export const DRAWING_SETTINGS_TABS: readonly ['style', 'text', 'coordinates'];
export function describeDrawingSettings(input: { drawings: readonly object[]; locale?: string; context?: object }): DrawingSettingsDescription;
export function applyDrawingSettings(store: object, input: { ids: readonly string[]; changes: readonly { fieldId: string; value: unknown }[]; context?: object }): { changed: boolean };
export function applySavedDrawingStyle(store: object, ids: readonly string[], styleId: string): unknown;
export function saveDrawingStyle(store: object, id: string, name: string): unknown;
export function planDrawingStyle(drawings: readonly object[], style: object, options?: { keys?: readonly string[]; includeOwn?: boolean; ownStyle?: boolean; groups?: readonly object[] }): { updates: { id: string; patch: object }[]; skippedOwn: string[]; skippedLocked: string[] };

/** The optional drawing settings dialog, opened by `drawingActivate` (double click, Enter, `activateDrawing`). */
export function createDrawingSettingsDialog(options: {
  chart: Chart;
  doc: Document;
  host: HTMLElement;
  interaction?: { subscribe: (event: string, listener: (payload: unknown) => void) => () => void } | null;
  announce?: (text: string, options?: { error?: boolean }) => void;
  sharedStyle?: (() => (object | null)) | null;
}): { destroy(): void };
