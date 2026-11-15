import type { ExtensionRegistry } from './extensions.js';
import type { DrawingLayout } from './drawings.js';
export type { DrawingAxisLabels, DrawingStats, DrawingAxisLabelEntry, DrawingLayoutLabel, DrawingLayout, DrawingCaption, DrawingTextStyle, DrawingTextProperties, FibonacciTool, FibonacciOption, FibonacciLevel, NormalizedFibonacciLevel, FibonacciProperties, RegressionChannelProperties, RegressionCorrelation } from './drawings.js';

export type UnixMilliseconds = number;
export function timeFromUnixSeconds(seconds: number): UnixMilliseconds;
export function timeFromOffsetString(value: string): UnixMilliseconds;

export interface SessionDate {
  year: number;
  month: number;
  day: number;
}

export interface Slot {
  barId: string;
  time?: UnixMilliseconds;
  sessionDate?: SessionDate;
}

export interface OhlcPoint {
  barId: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
  buyVolume?: number | null;
  sellVolume?: number | null;
}

export interface NumericPoint {
  barId: string;
  value: number;
}

export type SeriesPoint = OhlcPoint | NumericPoint;

export type SeriesType = 'candlestick' | 'bar' | 'line' | 'histogram' | 'area' | 'baseline';
export type PriceScaleMode = 'linear' | 'log' | 'percent';
export type PriceScaleSide = 'left' | 'right';
export type DerivedType = 'heikinAshi' | 'renko' | 'kagi' | 'pointAndFigure';

export interface SeriesMetadata {
  instrumentId: string;
  interval: string;
  sourceId: string;
  board?: string;
  market?: string;
  instrumentType?: string;
  currency?: string;
  priceUnit?: string;
  volumeUnit?: string;
  priceStep?: number;
  observedAt?: UnixMilliseconds;
  delayMs?: number;
  timeZone?: string;
  calendar?: { timeZone: string };
}

export type PriceLineStyle = 'solid' | 'dashed' | 'dotted';
export type LastValueColorMode = 'neutral' | 'direction';

export interface PriceLineOptions {
  /** When the object is given and `visible` is omitted, the line is drawn. */
  visible?: boolean;
  style?: PriceLineStyle;
  /** `null` follows the label colour. */
  color?: string | null;
  width?: number;
}

/** Autoscale margins as fractions of the pane height: each in [0, 1), sum below 1. */
export interface PriceScaleMargins {
  top: number;
  bottom: number;
}

export interface SeriesOptions {
  id?: string;
  priceScaleId?: string;
  metadata?: SeriesMetadata;
  visible?: boolean;
  lastValueVisible?: boolean;
  title?: string;
  priceLine?: PriceLineOptions;
  lastValueColorMode?: LastValueColorMode;
  upColor?: string;
  downColor?: string;
  equalColor?: string;
  borderUpColor?: string;
  borderDownColor?: string;
  borderEqualColor?: string;
  wickUpColor?: string;
  wickDownColor?: string;
  wickEqualColor?: string;
  borderVisible?: boolean;
  wickVisible?: boolean;
  color?: string;
  lineWidth?: number;
  basePrice?: number;
  fillColor?: string;
  lineColor?: string;
  aboveLineColor?: string;
  belowLineColor?: string;
  aboveFillColor?: string;
  belowFillColor?: string;
}

export interface CrosshairStyleOptions {
  visible?: boolean;
  color?: string | null;
  labelBackground?: string | null;
  /** Text colour of the price and time plates; `null` inherits `layout.textColor`. */
  labelTextColor?: string | null;
  /** Trusted host function; errors are reported as chart `error` events and hide the plate. */
  timeFormatter?: ((time: UnixMilliseconds, slot: Slot) => string) | null;
}

export interface ChartOptions {
  theme?: 'dark' | 'light';
  locale?: string;
  timeZone?: string;
  layout?: {
    background?: string | null;
    textColor?: string | null;
    fontSize?: number;
    fontFamily?: string;
  };
  grid?: { visible?: boolean; color?: string | null };
  sessions?: { visible?: boolean; color?: string | null; starts?: string[] };
  crosshair?: CrosshairStyleOptions | null;
  timeScale?: {
    visible?: boolean;
    barSpacing?: number;
    borderColor?: string | null;
    textColor?: string | null;
    rightOffset?: number;
    slotLabel?: ((barId: string | null, slot: Slot | null, index: number) => string) | null;
    /** `index` (default) keeps equally spaced ticks; `time` aligns ticks to calendar boundaries. */
    tickMode?: 'index' | 'time';
  };
  priceScale?: { borderColor?: string | null; textColor?: string | null; tickSpacing?: number | null; margins?: PriceScaleMargins | null };
  autoSize?: boolean;
  accessibilityLabel?: string;
  countdown?: { visible?: boolean; placement?: 'corner' | 'label' };
}

export type ApplyOptionsPatch = Omit<ChartOptions, 'crosshair'> & {
  crosshair?:
    | (CrosshairStyleOptions & {
        anchorBarId?: string;
        offset?: number;
        price?: number | null;
      })
    | null;
};

export interface HistoryRemovalPlan {
  operation: 'removeHistoryBefore';
  boundaryBarId: string;
  revision: number;
  removedBarIds: string[];
  seriesRevisions: Array<{ id: string; revision: number }>;
  series: Array<{ seriesId: string; pointCount: number }>;
  drawings: Array<{ id: string; [key: string]: unknown }>;
  alerts: Array<{ id: string; [key: string]: unknown }>;
  affectsIndicators: boolean;
  affectsDerived: boolean;
}

export class Timeline {
  readonly revision: number;
  readonly length: number;
  slotAt(index: number): Slot | null;
  indexOf(barId: string): number | null;
  toArray(): Slot[];
  listSlots(): Slot[];
  setTimeline(slots: Slot[]): Timeline;
  append(slots: Slot[]): Timeline;
  prepend(slots: Slot[]): Timeline;
  previewRemoveHistoryBefore(barId: string): HistoryRemovalPlan;
  removeHistoryBefore(plan: HistoryRemovalPlan): {
    removedBarIds: string[];
    boundaryBarId: string;
    revision: number;
  };
}

export class IndexScale {
  readonly name: string;
  readonly width: number;
  readonly barSpacing: number;
  readonly rightOffset: number;
  readonly follow: boolean;
  readonly length: number;
  indexToCoordinate(index: number): number | null;
  coordinateToIndex(x: number): number | null;
  barIdToIndex(barId: string): number | null;
  indexToBarId(index: number): string | null;
  barIdToCoordinate(barId: string): number | null;
  coordinateToLogical(x: number): number | null;
  logicalToCoordinate(logical: number): number | null;
  getVisibleRange(): { from: number; to: number } | null;
  setVisibleRange(range: { from: number; to: number }): void;
  fitContent(): void;
  scrollToRealTime(): void;
  timeToIndex(time: UnixMilliseconds): number | null;
  isFollowingRealTime(): boolean;
  setFollowRealTime(enabled: boolean): void;
  slots(): Slot[];
  setWidth(width: number): void;
  setBarSpacing(barSpacing: number, anchorX?: number): void;
  setRightOffset(rightOffset: number): void;
}

export class PriceScale {
  readonly name: string;
  readonly id: string;
  readonly side: PriceScaleSide;
  readonly visible: boolean;
  readonly inverted: boolean;
  readonly mode: PriceScaleMode;
  readonly base: number | null;
  readonly autoScale: boolean;
  /** Draws the scale's series inside the pane without an axis column, grid, labels or last-value labels. */
  readonly overlay: boolean;
  readonly height: number;
  /** Own autoscale margins as fractions of the pane height; `null` uses the chart `priceScale.margins`. */
  readonly margins: { top: number; bottom: number } | null;
  setHeight(height: number): void;
  setSide(side: PriceScaleSide): void;
  setInverted(inverted: boolean): void;
  setVisible(visible: boolean): void;
  setAutoScale(enabled: boolean): void;
  setOverlay(enabled: boolean): void;
  setMargins(margins: { top: number; bottom: number } | null): void;
  isAutoScale(): boolean;
  setVisibleRange(range: { min: number; max: number }): void;
  getVisibleRange(): { min: number; max: number } | null;
  setMode(mode: PriceScaleMode, options?: { base?: number }): void;
  priceToCoordinate(price: number): number | null;
  coordinateToPrice(y: number): number | null;
}

export interface SeriesAdapter {
  id: string;
  type: SeriesType;
  setData(data: SeriesPoint[], metadata?: SeriesMetadata): Series;
  update(point: SeriesPoint): Series;
  prepend(data: SeriesPoint[]): Series;
  correct(point: SeriesPoint): Series;
  data(): SeriesPoint[];
  metadata(): SeriesMetadata | null;
  options(): Omit<SeriesOptions, 'id' | 'priceScaleId' | 'metadata' | 'visible' | 'title'>;
  setOptions(patch: Omit<SeriesOptions, 'id' | 'priceScaleId' | 'metadata' | 'visible' | 'title'>): void;
}

export class Series {
  readonly id: string;
  readonly type: SeriesType;
  readonly revision: number;
  readonly length: number;
  readonly isOhlc: boolean;
  pane: Pane;
  priceScaleId: string;
  metadata(): SeriesMetadata | null;
  data(): SeriesPoint[];
  point(barId: string): SeriesPoint | null;
  lastPoint(): SeriesPoint | null;
  setData(data: SeriesPoint[], metadata?: SeriesMetadata): Series;
  update(point: SeriesPoint): Series;
  prepend(data: SeriesPoint[]): Series;
  correct(point: SeriesPoint): Series;
}

export interface Pane {
  readonly id: string;
  order: number;
  height: number | null;
  minHeight: number;
  visible: boolean;
  readonly priceScales: Map<string, PriceScale>;
  readonly series: Set<Series>;
}

export interface PaneDescriptor {
  id: string;
  order: number;
  height?: number;
  minHeight: number;
  visible: boolean;
  seriesIds: string[];
}

export interface PaneLayoutInput {
  id: string;
  order?: number;
  height?: number;
  minHeight?: number;
  visible?: boolean;
  seriesIds?: string[];
}

export interface PriceScaleDescriptor {
  paneId: string;
  scaleId: string;
  range: { min: number; max: number } | null;
  autoScale: boolean;
  mode: PriceScaleMode;
  base: number | null;
  side: PriceScaleSide;
  inverted: boolean;
  visible: boolean;
  overlay: boolean;
  margins: { top: number; bottom: number } | null;
}

export interface InteractionLayout {
  width: number;
  height: number;
  devicePixelRatio: number;
  rect: { x: number; y: number; width: number; height: number };
  panes: Array<{
    id: string;
    order: number;
    visible: boolean;
    height: number;
    minHeight: number;
    plot: { x: number; y: number; width: number; height: number };
    priceScales: Array<{
      id: string;
      side: PriceScaleSide;
      rect: { x: number; y: number; width: number; height: number };
      inverted: boolean;
    }>;
    indexAxis: null;
  }>;
}

export interface SeriesValueEntry {
  seriesId: string;
  paneId: string;
  type: SeriesType;
  values: SeriesPoint | null;
}

export interface CrosshairState {
  barId: string;
  offset: number;
  logical: number | null;
  price: number | null;
  paneId: string | null;
}

export interface ChartState {
  id: string;
  context: { instrumentId: string; interval: string; sourceId: string } | null;
  contexts: Array<{ instrumentId: string; interval: string; sourceId: string }>;
  panes: PaneDescriptor[];
  series: Array<{
    id: string;
    type: SeriesType;
    paneId: string;
    priceScaleId: string;
    visible: boolean;
    lastValueVisible: boolean;
    title: string | null;
    metadata: SeriesMetadata | null;
  }>;
  derived: Array<{
    id: string;
    type: DerivedType;
    sourceId: string;
    parameters: Record<string, number>;
    visible: boolean;
  }>;
  visibleRange: { from: number; to: number } | null;
  crosshair: CrosshairState | null;
  priceScales: PriceScaleDescriptor[];
  options: ChartOptions;
  modules: Record<string, unknown>;
}

export interface RestoreStateInput {
  id?: string;
  context?: ChartState['context'];
  contexts?: ChartState['contexts'];
  options?: ChartOptions;
  panes?: PaneLayoutInput[];
  visibleRange?: { from: number; to: number } | null;
  crosshair?: { anchorBarId: string; offset: number; price?: number | null } | null;
  series?: Array<{
    id?: string;
    seriesId?: string;
    type?: SeriesType;
    paneId?: string;
    priceScaleId?: string;
    metadata?: SeriesMetadata | null;
    visible?: boolean;
    lastValueVisible?: boolean;
    title?: string;
  }>;
  derived?: Array<{
    id: string;
    type?: DerivedType;
    sourceId?: string;
    parameters?: Record<string, number>;
    visible?: boolean;
  }>;
  priceScales?: PriceScaleDescriptor[];
  modules?: Record<string, unknown>;
}

export interface BatchSeriesEntry {
  series?: Series | string;
  seriesId?: string;
  points?: SeriesPoint[];
  data?: SeriesPoint[];
  operation?: 'append' | 'prepend' | 'update' | 'correct' | 'setData';
  metadata?: SeriesMetadata;
}

export interface Batch {
  timeline?: { op?: 'append' | 'prepend'; type?: 'append' | 'prepend'; slots: Slot[] };
  series?: BatchSeriesEntry[];
}

export interface ReplaceDataInput {
  slots: Slot[];
  series?: Array<{
    series?: Series | string;
    seriesId?: string;
    points?: SeriesPoint[];
    data?: SeriesPoint[];
  }>;
}

export interface DerivedElement {
  id: string;
  type: DerivedType;
  completionBarId: string;
  barIds: string[];
  previousElementId: string | null;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  direction?: 'up' | 'down';
  fromPrice?: number;
  fromIndex?: number;
  toPrice?: number;
  toIndex?: number;
  kind?: 'X' | 'O';
  level?: number;
  column?: number;
}

export interface DerivedSelection {
  elementId: string | null;
  resolved: boolean;
  element: DerivedElement | null;
}

export class DerivedView {
  readonly id: string;
  readonly type: DerivedType;
  readonly sourceId: string;
  readonly revision: number;
  readonly length: number;
  visible: boolean;
  parameters(): Record<string, number>;
  indexScale(): IndexScale;
  elements(): DerivedElement[];
  element(elementId: string): DerivedElement | null;
  barIdToElement(barId: string): string | null;
  elementToBarId(elementId: string): string | null;
  sourceBarIds(elementId: string): string[];
  hitTest(point: { x: number; y: number }, radius?: number): { element: DerivedElement; sourceBarIds: string[]; sourceValues: Array<OhlcPoint | null> } | null;
  setParameters(parameters: Record<string, number>): DerivedView;
  setVisible(visible: boolean): void;
  setSelection(elementId: string | null): void;
  getSelection(): DerivedSelection;
  remove(): void;
}

export interface ModuleHooks {
  onDataChange?(payload: Record<string, unknown>): void;
  onBeforeDataCommit?(context: {
    kind: 'series' | 'batch' | 'replace' | 'historyRemove';
    operation?: string;
    timelineOp?: 'append' | 'prepend' | 'remove' | null;
    slots?: Slot[];
    series?: Array<{ series: Series; prepared: unknown }>;
  }):
    | void
    | { series?: BatchSeriesEntry[] }
    | BatchSeriesEntry[];
  onSeriesRemoved?(series: Series): void;
  onBeforeSeriesRemove?(series: Series): void;
  onReset?(): void;
  onTimelineChange?(event: { kind: string; count?: number; paneId?: string; precommitted?: boolean }): void;
  onHistoryPreview?(plan: HistoryRemovalPlan): {
    drawings?: Array<{ id: string; [key: string]: unknown }>;
    alerts?: Array<{ id: string; [key: string]: unknown }>;
    affectsIndicators?: boolean;
    affectsDerived?: boolean;
  };
  onBeforeHistoryRemove?(plan: HistoryRemovalPlan): void;
  onHistoryRemoved?(event: { removedBarIds: string[]; boundaryBarId: string; precommitted?: boolean }): void;
  onCrosshairMove?(payload: Record<string, unknown>): void;
  onVisibleRangeChange?(payload: Record<string, unknown>): void;
  onResize?(payload: { width: number; height: number; devicePixelRatio: number }): void;
  onRender?(context: { ctx: CanvasRenderingContext2D; chart: Chart; layout: unknown }): void;
  onExportState?(state: ChartState): unknown;
  onValidateRestore?(snapshot: RestoreStateInput): void;
  onCaptureRestore?(snapshot: RestoreStateInput): unknown;
  onRollbackRestore?(checkpoint: unknown, previous: RestoreStateInput): void;
  onRestoreState?(snapshot: RestoreStateInput): void;
  onDestroy?(): void;
  onError?(error: unknown): void;
}

export interface ChartModule {
  name: string;
  api: unknown;
  hooks?: ModuleHooks;
}

export interface SeriesFacade {
  (seriesId: string): SeriesAdapter;
  list(): Array<{
    id: string;
    type: SeriesType;
    paneId: string;
    priceScaleId: string;
    visible: boolean;
  }>;
  remove(seriesId: string): void;
  add(spec: { type: SeriesType; options?: SeriesOptions; pane?: Pane | string; paneId?: string }): Series;
  setVisible(seriesId: string, visible: boolean): void;
}

export interface ChartSurface {
  readonly container: HTMLElement;
  readonly canvas: HTMLCanvasElement | null;
  readonly overlay: HTMLElement | null;
  readonly status: HTMLElement | null;
  readonly alert: HTMLElement | null;
  readonly table: HTMLElement | null;
  readonly element: HTMLElement | null;
  readonly layout: InteractionLayout;
  readonly panes: PaneDescriptor[];
  readonly locale: string;
  readonly timeZone: string;
  requestRender(): void;
  subscribe(event: string, handler: (payload: unknown) => void): () => void;
  emit(event: string, payload: unknown): void;
  resolveAnchor(anchor: { anchorBarId: string; offset: number }): number | null;
  anchorToX(anchor: { anchorBarId: string; offset: number }): number | null;
  xToAnchor(x: number): { anchorBarId: string; offset: number } | null;
  logicalToX(logical: number): number | null;
  xToLogical(x: number): number | null;
  priceToY(price: number, binding?: { paneId?: string; scaleId?: string }): number | null;
  yToPrice(y: number, binding?: { paneId?: string; scaleId?: string }): number | null;
  getVisibleRect(binding?: { paneId?: string }): { x: number; y: number; width: number; height: number } | null;
  getStateSnapshot(): ChartState;
  getSeriesValues(barId: string): SeriesValueEntry[];
  onPointer(
    id: string,
    type: string,
    handler: EventListener,
    options?: AddEventListenerOptions
  ): () => void;
  onKeyboard(
    id: string,
    type: string,
    handler: EventListener,
    options?: AddEventListenerOptions
  ): () => void;
  addOverlay(element: HTMLElement): (() => void) | undefined;
  addControl(control: {
    id: string;
    name: string;
    role: string;
    render?: () => HTMLElement | string | null;
    onActivate?: () => void;
  }): (() => void) | undefined;
  removeControl(id: string): void;
}

export type ChartEventName =
  | 'datachange'
  | 'visibleRangeChange'
  | 'crosshairMove'
  | 'resize'
  | 'destroy'
  | 'error'
  | 'render';

export interface ChartEventMap {
  datachange: {
    chartId: string;
    kind: string;
    seriesId?: string;
    operation?: string;
    barId?: string;
    barIds?: string[];
    removedBarIds?: string[];
    boundaryBarId?: string;
    range: { from: number; to: number } | null;
  };
  visibleRangeChange: {
    chartId: string;
    range: { from: number; to: number } | null;
    priceScales?: PriceScaleDescriptor[];
    derivedId?: string;
  };
  crosshairMove: {
    chartId: string;
    barId: string | null;
    index?: number | null;
    offset?: number;
    logical?: number | null;
    insideHistory?: boolean;
    price?: number | null;
    paneId?: string | null;
    time?: UnixMilliseconds;
    sessionDate?: SessionDate;
    series?: SeriesValueEntry[];
  };
  resize: { chartId: string; width: number; height: number; devicePixelRatio: number };
  destroy: { chartId: string };
  error: { chartId: string; operation: string; error: unknown };
  render: { chartId: string; revision: number };
}

export interface AlertObservation {
  version: string;
  stream?: IndexFeedContext;
  prevVersion?: string | null;
  state?: 'partial' | 'closed' | null;
  barId?: string | null;
  time?: UnixMilliseconds | null;
  index?: number | null;
  values?: Record<string, number | null> | null;
  error?: { message: string; sourceKey?: string } | null;
  correct?: boolean;
  gap?: boolean;
  snapshot?: boolean;
}

export interface AlertSnapshot {
  version: string;
  stream?: IndexFeedContext;
  values?: Record<string, number | null>;
  barId?: string | null;
  time?: UnixMilliseconds | null;
  index?: number | null;
  state?: 'partial' | 'closed' | null;
}

export type AlertBackendStatus = 'active' | 'paused' | 'completed' | 'expired' | 'error' | 'unknown';
export interface AlertBackendDefinition {
  id: string;
  revision: number;
  authority: 'backend';
  left: Record<string, unknown>;
  right: Record<string, unknown>;
  operation: 'above' | 'below' | 'crossUp' | 'crossDown';
  mode: 'once' | 'repeating';
  [key: string]: unknown;
}
export interface AlertBackendConfirmation {
  outcome: 'confirmed';
  alertId: string;
  revision: number;
  status: AlertBackendStatus;
  definition?: AlertBackendDefinition;
  confirmation?: { indicators: Array<{ formula: string; params: Record<string, unknown>; output: string; semanticVersion: string }> };
}
export type AlertBackendMutationResult = AlertBackendConfirmation |
  { outcome: 'rejected'; error: { message: string; fields?: Array<{ path: string; message: string }> } } |
  { outcome: 'conflict'; currentRevision?: number } |
  { outcome: 'unknown'; error?: unknown; requestId?: string };
export type AlertBackendMessage =
  | { type: 'status'; alertId: string; revision: number; status: AlertBackendStatus; confirmation?: AlertBackendConfirmation['confirmation'] }
  | { type: 'event'; event: {
      eventId: string; alertId: string; revision: number;
      operation: 'above' | 'below' | 'crossUp' | 'crossDown';
      observationMode: 'closed' | 'partial'; observationVersion: string;
      sources: { left: string; right: string };
      left: number; right: number; d: number; barId?: string; time?: number;
      delivery?: { status: 'pending' | 'delivered' | 'failed' | 'unknown'; error?: unknown };
      [key: string]: unknown;
    } }
  | { type: 'error'; error: unknown };
export interface AlertBackendAdapter {
  idempotency: { supported: boolean; scope: string };
  create(definition: AlertBackendDefinition, requestId: string): AlertBackendMutationResult;
  read(alertId: string): (AlertBackendConfirmation & { definition: AlertBackendDefinition }) | { outcome: 'error'; error: unknown };
  update(alertId: string, definition: AlertBackendDefinition, expectedRevision: number, requestId: string): AlertBackendMutationResult;
  pause(alertId: string, expectedRevision: number, requestId: string): AlertBackendMutationResult;
  resume(alertId: string, expectedRevision: number, requestId: string): AlertBackendMutationResult;
  delete(alertId: string, expectedRevision: number, requestId: string): AlertBackendMutationResult;
  subscribe(listener: (message: AlertBackendMessage) => void): () => void;
}

export interface AlertEngine {
  add(definition: Record<string, unknown>): Record<string, unknown>;
  get(id: string): Record<string, unknown>;
  list(): Array<Record<string, unknown>>;
  update(id: string, patch: Record<string, unknown>, expectedRevision: number): Record<string, unknown>;
  prepareUpdates(updates: Array<{ id: string; patch: Record<string, unknown>; expectedRevision: number }>): { commit(): Array<Record<string, unknown>> };
  markSourceRemoved(source: Record<string, unknown>, reason?: string): { blocked: number };
  markSourceAvailable(source: Record<string, unknown>): { blocked: number };
  pause(id: string, expectedRevision: number): Record<string, unknown>;
  resume(id: string, expectedRevision: number): Record<string, unknown>;
  setGeometryResolved(id: string, resolved: boolean): Record<string, unknown>;
  remove(id: string): { removed: true; alertId: string };
  getRetired(id: string): Record<string, unknown>;
  events(alertId: string): Array<Record<string, unknown>>;
  subscribe(listener: (event: Record<string, unknown>) => void): () => void;
  observe(observation: AlertObservation): { evaluated: number; skipped: number; eventIds: string[] };
  confirmSnapshot(snapshot: AlertSnapshot): Record<string, unknown>;
  startSession(): void;
  stopSession(): void;
  disconnect(): void;
  disconnectStream(stream: IndexFeedContext): Record<string, unknown>;
  reconnect(): void;
  setBackendAdapter(adapter: AlertBackendAdapter | null): { attached: boolean };
  getBackendState(): Record<string, unknown>;
  backendCreate(definition: Record<string, unknown>): { outcome: 'confirmed' | 'unknown'; alertId: string; revision?: number; status?: string; requestId: string | null };
  backendResume(id: string, expectedRevision: number): { outcome: 'confirmed' | 'unknown'; alertId: string; revision?: number; status?: string; requestId: string | null };
  backendDelete(id: string, expectedRevision: number): { outcome: 'confirmed' | 'unknown'; alertId: string; revision?: number; status?: string; requestId: string | null };
  backendRead(id: string): { outcome: 'confirmed' | 'unknown' | 'error'; alertId: string; revision?: number; status?: string; requestId?: string | null };
  backendUpdate(id: string, patch: Record<string, unknown>, expectedRevision: number): { outcome: 'confirmed' | 'unknown'; alertId: string; revision?: number; status?: string; requestId: string | null };
  backendPause(id: string, expectedRevision: number): { outcome: 'confirmed' | 'unknown'; alertId: string; revision?: number; status?: string; requestId: string | null };
  getPendingBackendDefinitions(): ReadonlyArray<Readonly<Record<string, unknown>>>;
}

export interface AlertPresentation {
  list(): Array<Record<string, unknown>>;
  selectedId(): string | null;
  select(id: string | null): string | null;
  hitTest(point: { x: number; y: number }, paneId: string, radius?: number): string | null;
  subscribe(listener: (event: Record<string, unknown>) => void): () => void;
  getDiagnostics(): { listenerErrorCount: number; lastListenerError: unknown };
}

export class Chart {
  readonly id: string;
  readonly timeline: Timeline;
  readonly container: HTMLElement | null;
  readonly canvas: HTMLCanvasElement | null;
  readonly element: HTMLElement | null;
  readonly surface: ChartSurface;
  readonly integration: ChartSurface;
  readonly series: SeriesFacade;
  readonly renderRevision: number;
  datafeed?: DatafeedController;
  connectDatafeed?: (source: IndexDatafeed, context: IndexFeedContext) => Promise<DatafeedControllerState>;
  alerts?: AlertEngine;
  drawings?: DrawingStore;
  addIndicator?: (spec: IndicatorSpec) => IndicatorHandle;
  indicators?: IndicatorModule;
  indicator?: (id: string) => IndicatorHandle | null;
  interaction?: InteractionHandle;
  ui?: UIHandle;
  readonly presentedRevision: number;

  indexScale(): IndexScale;
  priceScale(pane?: Pane | string | null, scaleId?: string): PriceScale;
  addPane(options?: {
    id?: string;
    order?: number;
    height?: number;
    minHeight?: number;
    visible?: boolean;
  }): Pane;
  removePane(pane: Pane | string): void;
  addSeries(type: SeriesType, options?: SeriesOptions, pane?: Pane | string): Series;
  removeSeries(series: Series | string): void;
  applyBatch(batch: Batch): Chart;
  replaceData(data: ReplaceDataInput): Chart;
  resetData(): void;
  applyOptions(patch: ApplyOptionsPatch): Chart;
  resize(width: number, height: number): Chart;
  subscribe<E extends ChartEventName>(event: E, handler: (payload: ChartEventMap[E]) => void): () => void;
  destroy(): void;
  getPanes(): PaneDescriptor[];
  applyPaneLayout(panes: PaneLayoutInput[]): void;
  getInteractionLayout(): InteractionLayout;
  getSeriesValues(barId: string): SeriesValueEntry[];
  getState(): ChartState;
  restoreState(snapshot: RestoreStateInput): Chart;
  addDerivedView(
    type: DerivedType,
    source: Series | string,
    options?: { parameters?: Record<string, number>; id?: string; visible?: boolean }
  ): DerivedView;
  removeDerivedView(view: DerivedView | string): void;
  derivedViews(): DerivedView[];
  setCrosshair(barId: string | null, price?: number | null, pane?: Pane | string | null): void;
  setCrosshairAnchor(
    anchor: { anchorBarId: string; offset: number; price?: number | null } | null,
    pane?: Pane | string | null
  ): void;
  getCrosshair(): CrosshairState | null;
  setBarCloseTime(barId: string | null, closeTime: UnixMilliseconds | null): void;
  attach(module: ChartModule): () => void;
  detach(name: string): void;
  requestRender(): void;
  whenRendered(revision?: number): Promise<number>;
  exportPng(): Promise<Blob>;
}

export class ChartError extends Error {
  readonly code: string;
  readonly operation?: string;
  readonly field?: string;
  readonly index?: number;
  readonly barId?: string;
  readonly seriesId?: string;
  constructor(
    code: string,
    message: string,
    details?: {
      operation?: string;
      field?: string;
      index?: number;
      barId?: string;
      seriesId?: string;
      cause?: unknown;
    }
  );
}

export function createChart(container: HTMLElement, options?: ChartOptions): Chart;

export interface DrawingSnapOptions {
  mode?: 'free' | 'weak' | 'strong';
  threshold?: number;
  magnet?: boolean;
  magnetThreshold?: number;
  rounding?: boolean;
  step?: number;
  sourceId?: string;
  /** Hold-to-snap key (one, or a list: any of them counts): while held, snap is strong with the bar-centre magnet. Default `['alt', 'meta']` (Option or Cmd on a Mac); shift is reserved for the horizontal constraint. */
  modifier?: 'alt' | 'ctrl' | 'meta' | Array<'alt' | 'ctrl' | 'meta'> | null;
}

/** Which properties a drawing has depends on its type: lines have colour, width, dash and opacity; filled shapes (rectangle, ellipse, triangle, channels, regression, polyline, bezier, brush) also fill and fillOpacity and paint their interior with `color`; text has colour and opacity; markers colour, width and opacity. */
export interface DrawingStyle {
  color: string;
  width: number;
  dash: 'solid' | 'dashed' | 'dotted';
  fill: boolean;
  /** Alpha of the interior paint; the effective fill alpha is `opacity * fillOpacity` (default 0.18). */
  fillOpacity: number;
  opacity: number;
}
/** For anchor-ordered tools, extend before the first / after the last anchor; rectangles use screen left / right. Both members are required when supplied. */
export interface DrawingExtend {
  left: boolean;
  right: boolean;
}

/** Arrowheads at the first and last ends of the visible geometry. Both members are required when supplied. */
export interface DrawingArrows {
  start: boolean;
  end: boolean;
}

/** Line option props, supported by the tools described in the drawing contract.
 * Extension defaults: segment, arrow, angle, rectangle and anchoredVwap neither side;
 * ray, fibFan and pitchfork right; line and parallelChannel both.
 * Arrows default to neither end except arrow (end); midpoint defaults to false.
 */
export interface DrawingLineOptions {
  extend?: DrawingExtend;
  arrows?: DrawingArrows;
  midpoint?: boolean;
}


export interface DrawingToolHandle {
  readonly id: string;
  readonly active: boolean;
  readonly pending: boolean;
  finish(): void;
  cancel(reason?: string): void;
}

export type KeyboardAction = 'panLeft' | 'panRight' | 'zoomIn' | 'zoomOut' |
  'priceZoomIn' | 'priceZoomOut' | 'priceAuto' | 'cancel' | 'contextMenu' |
  'toggleCrosshair' | 'crosshairPrev' | 'crosshairNext' |
  'nudgeLeft' | 'nudgeRight' | 'nudgeUp' | 'nudgeDown' |
  'nudgeLeftTen' | 'nudgeRightTen' | 'nudgeUpTen' | 'nudgeDownTen' |
  'duplicateSelection' | 'toggleDrawingsVisible' | 'toggleDrawingsLocked';
export type KeyboardBindings = Partial<Record<KeyboardAction, string | null>>;
export type KeyboardButtonAction = 'panLeft' | 'panRight' | 'zoomIn' | 'zoomOut' |
  'priceZoomIn' | 'priceZoomOut' | 'crosshairPrev' | 'crosshairNext';
export interface InteractionOptions extends Record<string, unknown> {
  bindings?: KeyboardBindings;
  instructions?: string;
}

export interface InteractionHandle {
  destroy(): void;
  detach(): void;
  getState(): Record<string, unknown>;
  keyboard: {
    activate(action: KeyboardButtonAction): { ok: boolean; reason?: string; result?: unknown };
    setBindings(bindings: KeyboardBindings): Partial<Record<KeyboardAction, string>>;
    getBindings(): Partial<Record<KeyboardAction, string>>;
    resolveEvent(event: KeyboardEvent, meta?: { target?: EventTarget | null }): unknown;
    handleKey(event: KeyboardEvent): void;
    setCrosshairActive(active: boolean): boolean;
    readonly crosshairActive: boolean;
  };
  setDrawingSnap(options: DrawingSnapOptions): DrawingSnapOptions;
  getDrawingSnap(): DrawingSnapOptions;
  /** The style every new drawing starts with (properties a type does not have are skipped); `null` clears it. */
  setDrawingStyle(style: Partial<DrawingStyle> | null): Partial<DrawingStyle>;
  getDrawingStyle(): Partial<DrawingStyle>;
  /** Linear <-> log on the primary price scale of the pane (active pane by default); a percent scale is left unchanged. */
  toggleLogScale(paneId?: string): { applied: boolean; mode?: 'linear' | 'log'; reason?: string; paneId?: string; scaleId?: string };
  /** Mode of the pane's primary price scale (active pane by default), or `null` without a scale. */
  getPriceScaleMode(paneId?: string): 'linear' | 'log' | 'percent' | null;
  /** Request settings for the supplied drawings, or the current selection when omitted. */
  activateDrawing(ids?: string[]): void;
  subscribe(event: 'drawingActivate', listener: (event: { drawingIds: string[]; drawingId: string; source: 'pointer' | 'keyboard' | 'api' }) => void): () => void;
  armDrawing(type: string, options?: { paneId?: string; scaleId?: string; props?: Record<string, unknown> }): DrawingToolHandle;
  cancelGesture(reason?: string): { cancelled: boolean };
  [key: string]: unknown;
}

/** `top` and `start` render before the chart, `end` and `bottom` after it; `overlay` and `menu` float over the plot. */
export type UiRegion = 'top' | 'start' | 'end' | 'overlay' | 'bottom' | 'menu';
export type UiPresetName = 'full' | 'compact';

/** Where parts go. `without` lists control ids (or `prefix:`) the host removes on purpose. */
export interface UiLayout {
  top?: string[];
  start?: string[];
  end?: string[];
  overlay?: string[];
  bottom?: string[];
  menu?: string[];
  without?: string[];
}

export interface UiPartContext {
  document: Document;
  region: UiRegion;
  id: string;
  host: Element;
  chartContainer: Element;
  layout: Record<string, unknown>;
}

export interface UiPartInstance {
  element: Element;
  destroy?(): void;
}

/** Keys of readable state (`controller.get`). */
export type UiReadKey = 'theme' | 'chartType' | 'indicator' | 'tool' | 'interval' | 'follow' | 'crosshair' | 'tableVisible' | 'priceMode' | 'snapMode';
/** Keys a host can subscribe to; the read keys plus status and structural changes. */
export type UiStateKey = UiReadKey | 'status' | 'message' | 'data' | 'panes' | 'indicatorErrors' | 'derived' | 'drawings' | 'capabilities';

/** One control of the model. `pressed` is set on toggles, `value` on tools, selects and chart-type/indicator toggles. */
export interface UiControl {
  /** Unique id: `tool:<name>`, `chartType:<id>`, `indicator:<id>`, `interval`, or a plain action id such as `undo`. */
  id: string;
  kind: 'toggle' | 'button' | 'select';
  /** Localized (chart `locale`) unless the host supplied the label. */
  label: string;
  enabled: boolean;
  /** Localized sentence stating why the control cannot act; `null` when enabled. */
  reason: string | null;
  /** What `controller.run` performs. */
  action: string;
  pressed?: boolean;
  value?: string;
  /** Drawing-rail group of a tool control (`null` for a host tool without one). */
  group?: string | null;
  /** Localized name of `group` for a library group; a host group shows its own `groupLabel`, or its id. `null` without a group. */
  groupLabel?: string | null;
  /** Options of a `select` control. */
  options?: Array<{ value: string; label: string }>;
}

export interface UiControlGroup {
  /** `chartType`, `indicators`, `tools`, `actions` or `interval`. */
  id: string;
  label: string;
  controls: UiControl[];
}

export interface UiModel {
  groups: UiControlGroup[];
}

/** Result of `controller.run`. A refusal is `{ ok: false, reason }`; it never throws. */
export interface UiActionResult {
  ok: boolean;
  /** Stable machine code of a refusal, for example `CONTROL_DISABLED`, `TOOL_UNAVAILABLE`, `NOTHING_TO_REVERT`. */
  code?: string;
  /** Localized sentence for a refusal. */
  reason?: string;
  [key: string]: unknown;
}

/** How an action can be invoked besides a control. */
export interface UiActionAccess {
  id: string;
  label: string;
  kind: string;
  /** Bound chords, one per keyboard action that must be held; `null` when none is bound. */
  keyboard: string[] | null;
  /** Context-menu item id, or `null`. */
  menu: string | null;
}

export interface UiController {
  readonly chart: Chart;
  readonly interaction: InteractionHandle | null;
  readonly options: Readonly<Record<string, unknown>>;
  readonly destroyed: boolean;
  /** Translates a UI string for the chart locale at the moment of the call. */
  t(key: string, params?: Record<string, string | number>): string;
  locale(): string;
  /** The host's icon replacements from the `icons` option (validated, frozen); pass to `createIcon(doc, name, { icons: controller.icons })`. */
  readonly icons: Readonly<Record<string, readonly string[]>>;
  /** Throws `UI_DESTROYED` after `destroy()`. */
  get(key: UiReadKey): unknown;
  snapshot(): Record<string, unknown>;
  /** `keys` is one key, a list, or `'*'`. The listener receives only the subscribed keys that changed. The returned function is idempotent. */
  subscribe(keys: UiStateKey | UiStateKey[] | '*', listener: (changedKeys: UiStateKey[]) => void): () => void;
  model(): UiModel;
  /** Runs a control by id. Throws `UNKNOWN_CONTROL` for an unknown id; a disabled control returns `{ ok: false, reason }` with the model's reason. */
  run(controlId: string, value?: unknown): UiActionResult;
  runAction(action: string, value?: unknown): UiActionResult;
  announce(text: string, options?: { error?: boolean }): string;
  clearError(): void;
  actions(): UiActionAccess[];
  refresh(): void;
  notify(...keys: UiStateKey[]): void;
  capabilities(): Record<string, boolean>;
  removeActions(ids: string[], reason?: string): void;
  resetRemovedActions(): void;
  setTheme(mode: 'light' | 'dark'): 'light' | 'dark';
  toggleTheme(): 'light' | 'dark';
  setTableVisible(visible: boolean): { ok: true; visible: boolean };
  /** Chart status and data-state parts; see the interface section of the contract. */
  readonly statusModel: unknown;
  readonly derived: unknown;
  readonly message: { text: string; error: boolean };
  panes: { list: () => unknown[]; api: unknown };
  table(): unknown;
  rowsSource(): unknown;
  indicatorErrors(): string;
  setDerivedView(view: unknown): unknown;
  startLoading(params?: Record<string, unknown>): unknown;
  resolveAvailable(params?: Record<string, unknown>): unknown;
  resolveEmpty(params?: Record<string, unknown>): unknown;
  fail(params: Record<string, unknown>): unknown;
  setValueUnavailable(field: string, reason: string): unknown;
  /** Idempotent. */
  destroy(): void;
}

export type UiPartFactory = (controller: UiController, context: UiPartContext) => UiPartInstance;
export interface UiPartSpec {
  create: UiPartFactory;
  regions?: UiRegion[];
  controls?: string[];
}

export interface ChartUIOptions {
  /** Element that already holds the chart container as a direct child; defaults to the container's parent. */
  host?: Element;
  layout?: UiPresetName | UiLayout;
  /** Host parts; an id equal to a built-in part replaces it. */
  parts?: Record<string, UiPartFactory | UiPartSpec>;
  interaction?: InteractionHandle;
  /** Set false to leave drawing activation to the host. */
  drawingSettings?: false | { sharedStyle?: () => Partial<DrawingStyle> | null };
  title?: string;
  demo?: boolean;
  demoLabel?: string;
  /** Also list the keyboard-equivalent navigation actions (pan, price zoom, bar step, keyboard crosshair) in the settings menu; default `false`. */
  accessibleActions?: boolean;
  /**
   * Replace built-in icons: icon name (`ICON_NAMES`) to SVG path data on the 24×24 grid, one string or several.
   * An unknown name or empty data fails with `INVALID_UI_OPTION`. Stroke, width and colour stay with the stylesheet.
   */
  icons?: Record<string, string | readonly string[]>;
  theme?: 'light' | 'dark';
  [key: string]: unknown;
}

export interface UIHandle {
  destroy(): void;
  getState(): Record<string, unknown>;
  resolveAvailable(params?: { rows?: unknown[]; operation?: string; meta?: Record<string, unknown> }): unknown;
  /** Replaces a part already in the layout; the new layout is validated first. */
  replacePart?(id: string, part: UiPartFactory | UiPartSpec): Element;
  /** Swaps the whole layout on the same chart; a layout that fails validation changes nothing. */
  setLayout?(layout: UiPresetName | UiLayout): Record<string, unknown>;
  readonly controller?: UiController;
  [key: string]: unknown;
}

export function attachInteraction(chart: Chart, options?: InteractionOptions): InteractionHandle;
export function createChartUI(chart: Chart, options?: ChartUIOptions): UIHandle;

export interface DatafeedStatusEvent {
  status: string;
  dataStatus?: string;
  error?: Error | null;
}

export interface DatafeedStreamState {
  snapshotVersion: Version | null;
  lastVersion: Version | null;
  consistent: boolean;
  awaitingSnapshot: boolean;
  status: string | null;
  initialized: boolean;
  buffered: number;
}

export interface DatafeedObservationEntry {
  sourceId: string;
  observation: Observation;
  snapshotVersion: Version | null;
  consistent: boolean;
  initialized: boolean;
}

export interface DatafeedControllerState {
  connected: boolean;
  destroyed: boolean;
  context: IndexFeedContext | null;
  capabilities: {
    history: boolean;
    stream: boolean;
    observations: boolean;
    intervals: string[] | null;
  };
  reliable: boolean;
  loading: boolean;
  hasMore: boolean;
  empty: boolean;
  error: {
    code: string;
    message: string;
    operation?: string;
    field?: string;
  } | null;
  certainty: unknown;
  timeline: { slotCount: number; firstBarId: string | null; lastBarId: string | null };
  chart: { snapshotVersion: Version | null; lastVersion: Version | null; consistent: boolean; awaitingSnapshot: boolean; streamStatus: string | null; buffered: number; missingRanges: Array<{ gapId: string; range: FeedGapRange }> };
  observationStream: DatafeedStreamState;
  observations: DatafeedObservationEntry[];
}

export interface DatafeedController {
  connect(source: IndexDatafeed | null, context: IndexFeedContext): Promise<DatafeedControllerState>;
  loadInitial(): Promise<DatafeedControllerState>;
  loadMore(): Promise<DatafeedControllerState>;
  disconnect(): void;
  requestSnapshot(stream: 'chart' | 'observations'): void;
  getState(): DatafeedControllerState;
  subscribe(listener: (state: DatafeedControllerState) => void): () => void;
  getObservations(): DatafeedObservationEntry[];
}

export interface ObservationDelivery {
  observation: Observation;
  sourceId: string;
  snapshotVersion: Version | null;
  alert: boolean;
  initializes: boolean;
  consistent: boolean;
  context: IndexFeedContext | null;
}

export interface DatafeedIntegrationOptions {
  pageSize?: number;
  onStatus?: (event: DatafeedStatusEvent) => void;
  onError?: (error: Error) => void;
  onObservation?: (event: ObservationDelivery) => void;
  mapObservation?: (event: ObservationDelivery) => AlertObservation | null;
}

export interface AttachChartFeaturesOptions {
  context?: SeriesMetadata;
  drawings?: Record<string, unknown>;
  alerts?: Record<string, unknown>;
  alertEngine?: AlertEngine;
  drawingChartId?: string;
  datafeed?: DatafeedIntegrationOptions;
  interaction?: Record<string, unknown> | false;
  chartUI?: ChartUIOptions | false;
  onExtensionError?: (event: { id?: string; operation?: string; error: Error }) => void;
}

export type ChartWithFeatures = Chart & {
  datafeed: DatafeedController;
  connectDatafeed: (source: IndexDatafeed, context: IndexFeedContext) => Promise<DatafeedControllerState>;
  alerts: AlertEngine;
  alertUI: AlertPresentation;
  extensions: ExtensionRegistry;
  drawings: DrawingStore;
  addIndicator: (spec: IndicatorSpec) => IndicatorHandle;
  indicators: IndicatorModule;
  indicator: (id: string) => IndicatorHandle | null;
  ui?: UIHandle;
};

export function attachChartFeatures(chart: Chart, options?: AttachChartFeaturesOptions): ChartWithFeatures;

export interface WorkspaceChartRequest {
  chartState?: ChartState;
  context?: SeriesMetadata;
}

export type WorkspaceChartFactory = (
  container: HTMLElement,
  request?: WorkspaceChartRequest
) => Chart;

export function createWorkspaceChartFactory(options: {
  createChart: typeof createChart;
  context?: SeriesMetadata;
  chartOptions?: ChartOptions;
  features?: AttachChartFeaturesOptions;
}): WorkspaceChartFactory;

export interface DrawingStore {
  add(drawing: Record<string, unknown>): Record<string, unknown>;
  get(id: string): Record<string, unknown> | null;
  list(): Array<Record<string, unknown>>;
  previewLayout(drawing: Record<string, unknown>): DrawingLayout;
  layout(id: string): DrawingLayout;
  getGeometry(id: string): DrawingLayout;
  getMeasure(id: string): Record<string, unknown> | null;
  update(id: string, patch: Record<string, unknown>): Record<string, unknown>;
  /** `coalesceKey` merges consecutive calls with the same key and targets into one undo step; a selection change, another command, undo or redo ends the run. */
  updateBatch(updates: Array<{ id: string; patch: Record<string, unknown> }>, options?: { coalesceKey?: string }): boolean;
  /** Copies the target drawings (ids, groups or both) as one undoable command; copies keep group, flags, style and props, are appended in z-order and become the selection. `options.updates` (`{ id, patch }` by source id) places the copies. Locked sources can be copied. */
  duplicate(target: string | string[], options?: { updates?: Array<{ id: string; patch: Record<string, unknown> }> }): Array<Record<string, unknown>>;
  /** Explicit flag state over every drawing and group; `null` when the document holds neither. */
  summary(): { drawings: number; groups: number; visible: 'all' | 'none' | 'mixed' | null; locked: 'all' | 'none' | 'mixed' | null };
  /** Sets the explicit `visible` flag of every drawing and group in one undo step, locked objects included; returns `false` when nothing changes. */
  setAllVisible(visible: boolean): boolean;
  /** Sets the explicit `locked` flag of every drawing and group in one undo step; returns `false` when nothing changes. */
  setAllLocked(locked: boolean): boolean;
  /** Transient ghost of the copies a clone drag would create (`[{ id, patch }]` by source id, or `null`). Not exported, selected or undoable. */
  setClonePreview(updates: Array<{ id: string; patch: Record<string, unknown> }> | null): void;
  clonePreview(): DrawingLayout[] | null;
  updateMany(ids: string[], patch: Record<string, unknown>): void;
  remove(id: string): void;
  clear(): void;
  clearAll(): void;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  setVisibility(ids: string[], visible: boolean): void;
  setLocked(ids: string[], locked: boolean): void;
  setOrder(ids: string[]): void;
  beginTransaction(): void;
  endTransaction(): void;
  cancelTransaction(): void;
  createGroup(input: Record<string, unknown>): Record<string, unknown>;
  renameGroup(id: string, name: string): void;
  ungroup(id: string): void;
  removeGroup(id: string): void;
  setGroupParent(id: string, parentId: string | null): void;
  addToGroup(id: string, groupId: string): void;
  removeFromGroup(id: string, groupId: string): void;
  getGroup(id: string): Record<string, unknown> | null;
  /** Shows drawings at pending geometry (`[{ id, patch }]`, or `null` to clear) while a drag is in progress. Not exported, not undoable, not notified; the caller requests a render. */
  setDragPreview(updates: Array<{ id: string; patch: Record<string, unknown> }> | null): void;
  listGroups(): Array<Record<string, unknown>>;
  getGroupMembers(id: string): Array<Record<string, unknown>>;
  select(ids: string[]): void;
  selectMany(ids: string[]): void;
  getSelection(): string[];
  bringForward(ids: string[]): void;
  sendBackward(ids: string[]): void;
  bringToFront(ids: string[]): void;
  sendToBack(ids: string[]): void;
  removeSelected(): void;
  saveStyle(style: Record<string, unknown>): Record<string, unknown>;
  listStyles(): Array<Record<string, unknown>>;
  /** `style` is a saved style id or a partial style; properties the drawing's type does not have are rejected. */
  applyStyle(target: string | string[], style: string | Partial<DrawingStyle>): void;
  setFavorite(tool: string, favorite: boolean): void;
  isFavorite(tool: string): boolean;
  listFavorites(): string[];
  setRepeatMode(enabled: boolean): void;
  getRepeatMode(): boolean;
  export: () => Record<string, unknown>;
  import: (document: Record<string, unknown>) => void;
  subscribe(listener: (event: unknown) => void): () => void;
}

export function createDrawingStore(options: {
  context: { instrumentId: string; interval: string; sourceId: string; view?: string };
  geometry: Record<string, (...args: unknown[]) => unknown> & { getPriceScaleMode(binding: unknown): PriceScaleMode };
  historyLimit: number;
  alertEngine?: AlertEngine;
  drawingChartId?: string;
  deferNotifications?: (deliver: () => void) => boolean;
}): DrawingStore;

export interface IndicatorResult {
  type: string;
  parameters: Record<string, unknown>;
  outputs: Record<string, Array<{ barId: string; time?: UnixMilliseconds; value: number | null }>>;
  errors: Array<{ index?: number; barId?: string; field: string; message: string }>;
}

export interface IndicatorInputRow {
  barId: string;
  time?: UnixMilliseconds;
  [field: string]: unknown;
}

export interface IndicatorParameterDescriptor {
  type: 'integer' | 'number' | 'field' | 'string' | 'boolean';
  default?: unknown;
  min?: number;
  max?: number;
  values?: unknown[];
}

export interface IndicatorTypeMetadata {
  id: string;
  semanticVersion: string;
  parameters: Record<string, IndicatorParameterDescriptor>;
  inputs: string[];
  outputs: Record<string, { units: string; scale: string }>;
  description?: string;
}

export interface IndicatorTypeDefinition extends IndicatorTypeMetadata {
  compute(rows: IndicatorInputRow[], parameters: Record<string, unknown>): IndicatorResult['outputs'];
}

export interface IndicatorStyle {
  color?: string;
  lineWidth?: number;
  /** Histogram outputs only; used together to colour bars by sign. */
  upColor?: string;
  downColor?: string;
}

export interface IndicatorSpec {
  id?: string;
  type: string;
  source: string | Series;
  pane: string | Pane;
  parameters?: Record<string, unknown>;
  style?: IndicatorStyle;
  priceScaleId?: string;
}

export interface IndicatorState {
  id: string; type: string; parameters: Record<string, unknown>; source: string; pane: string;
  style: IndicatorStyle; visible: boolean; locked: boolean; outputSeries: Record<string, string>;
}

export interface IndicatorHandle {
  readonly id: string;
  getState(): IndicatorState;
  getResult(): IndicatorResult;
  getErrors(): IndicatorResult['errors'];
  setParameters(parameters: Record<string, unknown>): void;
  setStyle(style: IndicatorStyle): void;
  setVisible(visible: boolean): void;
  setLocked(locked: boolean): void;
  remove(): void;
}

export interface IndicatorModule {
  add(spec: IndicatorSpec): IndicatorHandle;
  get(id: string): IndicatorHandle | null;
  list(): IndicatorState[];
  beginReplacement(): { commit(): void; rollback(): void };
}

export function computeIndicator(
  type: string,
  parameters: Record<string, unknown>,
  rows: Array<Record<string, unknown>>
): IndicatorResult;

export function registerIndicatorType(spec: IndicatorTypeDefinition): () => void;
export function listIndicatorTypes(): IndicatorTypeMetadata[];

export type Version = string;
export interface IndexFeedContext {
  instrumentId: string;
  interval: string;
  sourceId: string;
}
export interface HistoryRequest {
  context: IndexFeedContext;
  before?: string;
  limit: number;
}
export interface FeedPoint {
  kind: 'ohlcv' | 'numeric';
  barId: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  buyVolume?: number;
  sellVolume?: number;
  value?: number;
}
export interface HistoryResult {
  context: IndexFeedContext;
  slots: Slot[];
  series: Array<{ seriesId: string; points: FeedPoint[] }>;
  hasMore: boolean;
  nextBefore?: string;
  sourceStatus: string;
  snapshotVersion?: Version;
  reconciledGapIds?: string[];
}
export type FeedChange = (
  | { type: 'append'; seriesId: string; point: FeedPoint; slot?: Slot }
  | { type: 'replace' | 'correct'; seriesId: string; point: FeedPoint }
) & { barState: 'partial' | 'closed'; version?: Version; prevVersion?: Version };
export interface FeedGapRange { fromBarId: string; toBarId: string }
export interface FeedGapEvent { type: 'gap'; context: IndexFeedContext; gapId: string; range: FeedGapRange }

export type FeedEvent =
  | FeedChange
  | FeedGapEvent
  | { type: 'snapshot'; history: HistoryResult }
  | { type: 'status'; status: string }
  | { type: 'error'; message: string };
export interface Observation {
  sourceId: string;
  value: number;
  barId?: string;
  time?: UnixMilliseconds;
  state: 'partial' | 'closed';
  version?: Version;
  prevVersion?: Version;
}
export type ObservationEvent =
  | { type: 'snapshot'; observation: Observation; snapshotVersion?: Version }
  | { type: 'observation'; observation: Observation }
  | { type: 'status'; status: string }
  | { type: 'error'; message: string };
export interface Observer<T> {
  next(event: T): void;
  error(error: Error): void;
}
export type Unsubscribe = () => void;
export interface IndexDatafeed {
  capabilities: { history: boolean; stream: boolean; observations: boolean };
  loadHistory?(request: HistoryRequest, signal: AbortSignal): Promise<HistoryResult>;
  subscribe?(context: IndexFeedContext, observer: Observer<FeedEvent>): Unsubscribe;
  observe?(context: IndexFeedContext, observer: Observer<ObservationEvent>): Unsubscribe;
  requestSnapshot?(context: IndexFeedContext, stream: 'chart' | 'observations'): void;
}

export const SERIES_TYPES: readonly SeriesType[];
export const CHART_EVENTS: readonly ChartEventName[];
export const DERIVED_TYPES: readonly DerivedType[];
export const PRICE_SCALE_MODES: readonly PriceScaleMode[];
export const VERSION: string;
export const DEFAULT_OPTIONS: Readonly<ChartOptions>;
export const ERROR_CODES: Readonly<Record<string, string>>;
export const THEMES: Readonly<Record<'dark' | 'light', Record<string, string>>>;
