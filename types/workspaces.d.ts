import type { Chart, ChartState, ChartOptions, SeriesMetadata } from './index.js';

export class WorkspaceError extends Error {
  readonly code?: string;
  readonly field?: string;
}
export function isWorkspaceError(value: unknown): value is WorkspaceError;

export class TreeStore {
  constructor(options?: Record<string, unknown>);
  [key: string]: unknown;
}

export interface WorkspaceAnchor { anchorBarId: string; offset: number }
export interface WorkspaceSnapshot {
  kind: 'workspace-state';
  version: 2;
  charts: Array<{
    id: string;
    chartState: Record<string, unknown>;
    visibleRange: { from: WorkspaceAnchor; to: WorkspaceAnchor } | null;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}
export type WorkspaceTheme = {
  theme?: ChartOptions['theme'];
  layout?: ChartOptions['layout'];
  grid?: ChartOptions['grid'];
  sessions?: Pick<NonNullable<ChartOptions['sessions']>, 'visible' | 'color'>;
  crosshair?: NonNullable<ChartOptions['crosshair']>;
  timeScale?: Pick<NonNullable<ChartOptions['timeScale']>, 'visible' | 'borderColor' | 'textColor'>;
  priceScale?: ChartOptions['priceScale'];
};
export type WorkspaceTemplate =
  | { kind: 'layout'; version: 1; layout: Record<string, unknown> }
  | { kind: 'theme'; version: 1; theme: WorkspaceTheme }
  | { kind: 'preferences'; version: 1; preferences: Record<string, unknown> }
  | { kind: 'drawings'; version: 1; chartId: string; document: Record<string, unknown> }
  | { kind: 'indicators'; version: 1; charts: Array<{ chartId: string; indicators: Array<{
      id: string; type: string; source: string; pane: string; style: Record<string, unknown>;
      parameters: Record<string, unknown>; visible?: boolean; locked?: boolean; priceScaleId?: string;
    }> }> };

export interface Workspace {
  addChart(chartId: string, options?: Record<string, unknown>): Chart;
  removeChart(chartId: string): void;
  getChart(chartId: string): Chart | null;
  listCharts(): string[];
  getState(): WorkspaceSnapshot;
  restoreState(state: WorkspaceSnapshot): { charts: string[] };
  setLayout(layout: Record<string, unknown>): unknown;
  getLayout(): unknown;
  setTheme(theme: WorkspaceTheme): WorkspaceTheme;
  getTheme(): WorkspaceTheme;
  setPreferences(preferences: Record<string, unknown>): Record<string, unknown>;
  getPreferences(): Record<string, unknown>;
  exportPreferences(): Extract<WorkspaceTemplate, { kind: 'preferences' }>;
  savePreferences(write: (document: Extract<WorkspaceTemplate, { kind: 'preferences' }>) => unknown | Promise<unknown>): Promise<Extract<WorkspaceTemplate, { kind: 'preferences' }>>;
  exportTemplate(kind: WorkspaceTemplate['kind'], context?: { chartId?: string }): WorkspaceTemplate;
  importTemplate(document: WorkspaceTemplate): { kind: WorkspaceTemplate['kind']; action: 'import'; chartId: string | null };
  exportPng(chartId: string): Promise<Blob>;
  subscribe(listener: (event: Record<string, unknown>) => void): () => void;
  destroy(): void;
  addComparison(chartId: string, spec: ComparisonSpec): ComparisonResult;
  setComparisonData(comparisonId: string, points: Array<{ sourceBarId: string; value: number }>, mapping?: Record<string, string>): ComparisonResult;
  setComparisonBase(comparisonId: string, baseSlot: string): ComparisonResult;
  listComparisons(chartId?: string): ComparisonResult[];
  removeComparison(comparisonId: string): void;
  setMarkers(chartId: string, markers: EventMarker[], options?: { distance?: number }): unknown;
  clearMarkers(chartId: string): void;
  getMarkers(chartId: string): unknown;
  selectMarker(chartId: string, markerId: string): unknown;
  [key: string]: unknown;
}

export function createWorkspace(container: HTMLElement, options: { createChart(container: HTMLElement, options: Record<string, unknown>): Chart; [key: string]: unknown }): Workspace;
export function createSyncController(options: Record<string, unknown>): Record<string, unknown>;
export function exportChartPng(
  chart: Chart,
  options?: { chartId?: string; isAlive?: () => boolean; canvas?: HTMLCanvasElement | null }
): Promise<Blob>;
export function clusterMarkers(markers: unknown[], distance?: number): unknown[];
export function comparisonScale(input: Record<string, unknown>): Record<string, unknown>;
export interface PrimaryComparisonSource {
  seriesId: string;
  field: 'value' | 'open' | 'high' | 'low' | 'close' | 'volume';
}
export interface EventMarker { id: string; barId: string; text: string; details?: string }
export interface PrimaryComparisonResult {
  baseSlot: string;
  base: number | null;
  normalization: 'available' | 'unavailable';
  reason: 'missing-source' | 'missing-base' | 'zero-base' | null;
  points: Array<{ barId: string; value: number | null }>;
}
export interface ComparisonResult {
  id: string;
  chartId: string;
  name: string;
  mode: 'absolute' | 'percent';
  instrument: ComparisonSpec['instrument'];
  scale: { id: string; shared: boolean; label: string; units: string | null; currency?: string | null };
  base: { slot: string | null; value?: number; unavailable: boolean; reason?: string };
  normalization: 'available' | 'unavailable';
  reason: string | null;
  points: Array<{ barId: string; value: number | null; gap: string | null }>;
  gaps: string[];
  primary?: PrimaryComparisonResult;
}
export type ComparisonSpec = {
  id: string;
  instrument: { instrumentId: string; interval: string; sourceId: string };
  points: Array<{ sourceBarId: string; value: number }>;
  mapping?: Record<string, string>;
  units?: string;
  currency?: string;
  name?: string;
} & (
  | { mode: 'percent'; baseSlot: string; primary?: PrimaryComparisonSource | null }
  | { mode: 'absolute'; baseSlot?: string; primary?: null }
);
export function readPrimaryComparison(chart: Chart, primary: PrimaryComparisonSource): Array<{ barId: string; value: number | null }>;
export function computePrimaryComparison(chart: Chart, primary: PrimaryComparisonSource, baseSlot: string): PrimaryComparisonResult;
export function computeComparison(input: Record<string, unknown>, chart: Chart): ComparisonResult;
export function normalizeLayout(input: Record<string, unknown>): Record<string, unknown>;
export function anchorFromLogical(scale: Record<string, unknown>, logical: number): { anchorBarId: string; offset: number } | null;
export function logicalFromAnchor(scale: Record<string, unknown>, anchor: { anchorBarId: string; offset: number }): number | null;
export function normalizeAnchor(anchor: { anchorBarId: string; offset: number }): { anchorBarId: string; offset: number };

export const DEFAULT_CLUSTER_DISTANCE: number;
export const MAX_GRID_DIMENSION: number;
export const STATE_KIND: string;
export const STATE_VERSION: number;
export const TEMPLATE_KINDS: readonly string[];
export const TEMPLATE_VERSION: number;

export type { Chart, ChartState, SeriesMetadata };
