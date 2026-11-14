import type { IndicatorResult, IndicatorTypeDefinition, IndicatorTypeMetadata } from './index.js';
export type { IndicatorInputRow, IndicatorParameterDescriptor, IndicatorTypeDefinition, IndicatorTypeMetadata } from './index.js';

export function computeIndicator(
  type: string,
  parameters: Record<string, unknown>,
  rows: Array<Record<string, unknown>>
): IndicatorResult;
export function registerIndicatorType(spec: IndicatorTypeDefinition): () => void;
export function listIndicatorTypes(): IndicatorTypeMetadata[];
export function validateIndicatorParameters(type: string, parameters?: Record<string, unknown>): Record<string, unknown>;

export const INDICATOR_SEMANTIC_VERSION: string;
export const BUILTIN_INDICATORS: Readonly<Record<string, unknown>>;
