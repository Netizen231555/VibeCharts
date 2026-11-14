import type { Chart, InteractionHandle, InteractionLayout, InteractionOptions, KeyboardAction, SeriesValueEntry } from './index.js';
export type { DrawingSnapOptions, DrawingToolHandle, InteractionHandle, InteractionOptions, KeyboardAction, KeyboardBindings, KeyboardButtonAction } from './index.js';

export class InteractionError extends Error {
  readonly code?: string;
  readonly field?: string;
}

export function attachInteraction(chart: Chart, options?: InteractionOptions): InteractionHandle;
export function resolveInteractionAdapter(chart: Chart, options?: Record<string, unknown>): Record<string, unknown>;
export function normalizeLayout(raw: Record<string, unknown>): InteractionLayout;
export function computeCrosshair(input: Record<string, unknown>): Record<string, unknown>;
export function createCrosshairController(input: Record<string, unknown>): Record<string, unknown>;
export function buildReadout(payload: Record<string, unknown>, options?: Record<string, unknown>): Array<Record<string, unknown>> | null;
export function emptyPayload(): Record<string, unknown>;
export function normalizeSeriesValues(entries: unknown): SeriesValueEntry[];
export function createNavigation(input: Record<string, unknown>): Record<string, unknown>;
export function createGestureRecognizer(input: Record<string, unknown>): Record<string, unknown>;
export function createKeyboard(input: Record<string, unknown>): Record<string, unknown>;
export function createCrosshairNavigation(input: Record<string, unknown>): Record<string, unknown>;
export function normalizeChord(input: unknown): unknown;
export function chordFromEvent(event: Event): string | null;
export function isEditableTarget(target: EventTarget | null): boolean;
export function createPaneLayout(input: Record<string, unknown>): Record<string, unknown>;
export function createContextMenu(input: Record<string, unknown>): Record<string, unknown>;
export function buildMenuItems(input: Record<string, unknown>): Array<Record<string, unknown>>;
export function buildAccessibleRows(input: Record<string, unknown>): Array<Record<string, unknown>>;
export function buildTableModel(input: Record<string, unknown>): Record<string, unknown>;
export function createStatusModel(input?: { locale?: string | (() => string) }): Record<string, unknown>;
export function createAnnouncer(input: Record<string, unknown>): Record<string, unknown>;
export function formatTimestamp(time: number, options?: Record<string, unknown>): string;
export function formatSessionDate(date: { year: number; month: number; day: number }, options?: { locale?: string; absent?: string }): string;
export function createDerivedViewAccessibility(input: Record<string, unknown>): Record<string, unknown>;
export function normalizeDerivedView(input: Record<string, unknown>): Record<string, unknown>;
export function describeParameters(input: Record<string, unknown>): string;
export function createRouter(input: Record<string, unknown>): Record<string, unknown>;
export function routePointerDown(input: Record<string, unknown>): Record<string, unknown>;
export function hitTest(input: Record<string, unknown>): unknown;
export function hitTestDrawings(input: Record<string, unknown>): unknown;
export function hitTestAxes(input: Record<string, unknown>): unknown;
export function paneAtPoint(input: Record<string, unknown>): unknown;
export function resolveDrawing(input: Record<string, unknown>): unknown;
export function normalizeHitRadius(value: unknown, field?: string): number;
export function drawingTypeFamily(type: string): string;
export function actionLabel(action: string, locale?: string): string;
export function defaultInstructions(locale?: string): string;
export function absentText(locale?: string): string;
export function isFiniteNumber(value: unknown): value is number;

export const CANCEL_REASONS: readonly string[];
export const DEFAULT_BINDINGS: Readonly<Partial<Record<KeyboardAction, string>>>;
export const DERIVED_VIEW_KINDS: readonly string[];
export const MENU_ACTION_IDS: readonly string[];
export const MENU_TARGET_KINDS: Readonly<Record<string, string>>;
export const MIN_HIT_RADIUS: number;
export const ROUTE: Readonly<Record<string, string>>;
