import type { AlertEngine, AlertObservation, IndexFeedContext } from './index.js';
export type { AlertBackendAdapter, AlertBackendConfirmation, AlertBackendDefinition, AlertBackendMessage, AlertBackendMutationResult, AlertBackendStatus, AlertEngine, AlertObservation } from './index.js';

export function createAlertEngine(options?: Record<string, unknown> & {
  requestSnapshot?: (reason: 'version-gap' | 'gap', stream: IndexFeedContext | null) => void;
  resolveBarIndex?: (barId: string, chartId?: string) => number | null | undefined;
  createRequestId?: (operation: string, alertId: string) => string;
}): AlertEngine;
export function validateAlertDefinition(definition: Record<string, unknown>, context?: {
  defaultAuthority?: 'local' | 'backend';
  resolveSource?: (source: Record<string, unknown>) => boolean | { available?: boolean; units?: string };
  resolveBarIndex?: (barId: string, chartId?: string) => number | null | undefined;
  unitsCompatible?: (leftUnits: string, rightUnits: string) => boolean;
}): Record<string, unknown>;
export function validateObservation(observation: AlertObservation): Readonly<Record<string, unknown>>;
export function sourceKey(source: Record<string, unknown>): string;

export const ALERT_SCHEMA_VERSION: number;
