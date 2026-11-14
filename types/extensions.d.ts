import type { Chart, ChartSurface, IndexScale, Pane, Slot, Timeline } from './index.js';

export interface ExtensionDataContext { instrumentId: string; interval: string; sourceId: string; view: string }
export interface ExtensionAnchor { anchorBarId: string; offset: number; price?: number; time?: number }
export interface ExtensionSeriesPoint { barId: string; value: number; time?: number }
export interface ExtensionSeriesConfig {
  points: ExtensionSeriesPoint[];
  [key: string]: unknown;
}
export interface ExtensionDrawingConfig {
  anchors?: ExtensionAnchor[];
  price?: number;
  [key: string]: unknown;
}
export interface ExtensionIndicatorPoint {
  barId: string;
  time?: number;
  [field: string]: number | string | undefined;
}
export interface ExtensionIndicatorConfig {
  inputFields: string[];
  units: Record<string, string>;
  outputs: Record<string, string>;
  points: ExtensionIndicatorPoint[];
  parameters?: Record<string, unknown>;
  [key: string]: unknown;
}
export type ExtensionIndicatorResult = Record<string, Array<{ barId: string; value: number | null; time?: number }>>;
export interface ExtensionControl {
  id: string;
  name: string;
  role: string;
  render?: () => Node | string | null | undefined;
  onActivate: (...args: unknown[]) => unknown;
}
export interface ExtensionContext {
  indexScale(): IndexScale;
  timeline: Timeline | Slot[];
  series: Chart['series'];
  subscribe(event: string, handler: (...args: unknown[]) => void): () => void;
  requestRender(): unknown;
  addControl(control: ExtensionControl): () => void;
  removeControl(release: () => void): void;
  resolveAnchor(anchor: ExtensionAnchor): number | null;
  reportError(operation: string, error: unknown): void;
}
export interface ExtensionRenderLayout {
  width: number; height: number; leftWidth: number; rightWidth: number;
  plotX: number; plotWidth: number; plotHeight: number;
  timeAxis: { x: number; y: number; width: number; height: number };
  panes: Array<{ pane: Pane; x: number; y: number; width: number; height: number }>;
}
export interface ExtensionImplementation<Config = Record<string, unknown>, State = unknown> {
  state?: State;
  init?(): void;
  render?(ctx: CanvasRenderingContext2D, surface: ChartSurface, layout: ExtensionRenderLayout): unknown;
  compute?(points: Array<Record<string, unknown>>, parameters: Record<string, unknown>): Record<string, unknown>;
  update?(config: Config): void;
  importState?(state: State): void;
  dispose?(implementation: ExtensionImplementation<Config, State>, context: ExtensionContext): void;
}
export interface ExtensionDefinition<Config = Record<string, unknown>, State = unknown> {
  id: string;
  version: string;
  apiRange: string;
  type: string;
  schemaVersion: string | number;
  factory(context: ExtensionContext, config: Config): ExtensionImplementation<Config, State>;
  validate?(config: Config, state?: State): void;
  cleanup?(implementation: ExtensionImplementation<Config, State>, context: ExtensionContext): void;
  exportState?(state: State | undefined, config: Config): unknown;
  importState?(implementation: ExtensionImplementation<Config, State>, state: State, context: ExtensionContext): void;
}
export type SeriesExtensionDefinition<State = unknown> = ExtensionDefinition<ExtensionSeriesConfig, State> & { type: 'series' };
export type DrawingExtensionDefinition<State = unknown> = ExtensionDefinition<ExtensionDrawingConfig, State> & { type: 'drawing' };
export type IndicatorExtensionDefinition<State = unknown> = Omit<ExtensionDefinition<ExtensionIndicatorConfig, State>, 'type' | 'factory'> & {
  type: 'indicator';
  factory(context: ExtensionContext, config: ExtensionIndicatorConfig): ExtensionImplementation<ExtensionIndicatorConfig, State> & {
    compute(points: ExtensionIndicatorPoint[], parameters: Record<string, unknown>): ExtensionIndicatorResult;
  };
};
export interface ExtensionRegistration {
  id: string; version: string; type: string; unregister(): void;
}
export interface ExtensionInstance<Config = Record<string, unknown>, State = unknown> {
  id: string; instanceId: string; type: string; renderable: boolean;
  readonly state: State | undefined;
  readonly config: Config;
  render(ctx: CanvasRenderingContext2D, surface: ChartSurface, layout: ExtensionRenderLayout): unknown;
  compute(): Record<string, unknown>;
  update(config: Config): void;
  dispose(): void;
}
export interface ExtensionRecord {
  id: string; type: string; version: string; schemaVersion: string | number;
  config: Record<string, unknown>; state: unknown;
}
export interface ExtensionDocument { version: 2; context: ExtensionDataContext; instances: ExtensionRecord[] }
export interface ExtensionEvent { operation: string; id: string; instanceId?: string }
export interface ExtensionErrorEvent { id: string; operation: string; error: unknown }
export interface ExtensionRegistry {
  register<Config = Record<string, unknown>, State = unknown>(extension: ExtensionDefinition<Config, State>): ExtensionRegistration;
  unregister(id: string): void;
  create<Config = Record<string, unknown>, State = unknown>(id: string, config: Config, importedState?: State): ExtensionInstance<Config, State>;
  listRegistrations(): Array<{ id: string; version: string; apiRange: string; type: string; schemaVersion: string | number }>;
  listInstances(): ExtensionInstance[];
  readonly counts: { registrations: number; instances: number };
  disposeAll(): void;
  subscribe(listener: (event: ExtensionEvent) => void): () => void;
  exportState(): ExtensionDocument;
  importState(state: ExtensionDocument): ExtensionInstance[];
}
export function createExtensionRegistry(options: {
  chartContext: {
    context: ExtensionDataContext | (() => ExtensionDataContext);
    timeline: Timeline | Slot[];
    indexScale(): IndexScale;
    series: Chart['series'];
    subscribe(event: string, handler: (...args: unknown[]) => void): () => void;
    requestRender(): unknown;
    addControl(control: ExtensionControl): (() => void) | void;
    removeControl(id: string): void;
  };
  onError?: (event: ExtensionErrorEvent) => void;
}): ExtensionRegistry;
export function parseSemverRange(range: string): { operator: string; version: string; parts: number[] };
export function satisfiesRange(version: string, range: string): boolean;
export const API_VERSION: string;
