import type { Slot } from './index.js';

export type ReplayJson = null | boolean | number | string | ReplayJson[] | { [key: string]: ReplayJson };
export type ReplayEvent = {
  position: number;
  streamId: string;
  time?: number;
} & (
  | { type: 'partial' | 'close' | 'correct'; payload: { barId: string; values: Record<string, number>; slot?: Slot } }
  | { type: 'observation'; payload: Record<string, ReplayJson> & { barId?: string } }
);

export interface ReplayInput {
  sourceId: string;
  events: ReplayEvent[];
  streams?: string[];
  intervals?: number[];
  /** Required for bar events: the complete host-defined slot order. */
  slots?: Slot[];
}

export interface SimulationDefinition {
  id: string;
  streamId: string;
  field: string;
  operation: 'above' | 'below' | 'crossUp' | 'crossDown';
  level: number;
  hysteresis?: number;
  mode?: 'once' | 'repeating';
  observationMode?: 'partial' | 'closed';
}

export interface SimulationEvent {
  simulation: true;
  alertId: string;
  position: number;
  streamId: string;
  value: number;
  level: number;
  operation: SimulationDefinition['operation'];
  barId?: string;
}

export interface ReplayState {
  position: number | null;
  events: ReplayEvent[];
  timeline: Slot[];
  streams: Array<{ streamId: string; bars: Array<{ barId: string; values: Record<string, number>; closed: boolean }>; observations: Array<Record<string, ReplayJson>> }>;
  simulation: SimulationEvent[];
}

export interface ReplaySnapshot {
  version: 3;
  sourceId: string;
  orderHash: string;
  configHash: string;
  position: number | null;
  speed: number;
  simulationDefinitions: SimulationDefinition[] | null;
  state: ReplayState;
}

export interface ReplaySession {
  play(): { end: boolean };
  pause(): void;
  step(): { end: boolean };
  seek(position: number | null): void;
  setSpeed(value: number): void;
  snapshot(): ReplaySnapshot;
  restore(snapshot: ReplaySnapshot): void;
  getState(): ReplayState;
  subscribe(listener: (state: ReplayState) => void): () => void;
  createSimulation(definitions: SimulationDefinition[]): void;
  destroy(): void;
}

export function validateReplayInput(input: ReplayInput): true;
export function createSimulation(alertDefinitions: SimulationDefinition[]): { evaluate(events: ReplayEvent[]): SimulationEvent[] };
export function createReplaySession<Handle = number>(options: {
  source: Omit<ReplayInput, 'events'> & {
    apply?: (state: ReplayState) => void;
    views?: Array<{ apply(state: ReplayState): void; rollback(state: ReplayState): void }>;
  };
  events: ReplayEvent[];
  config?: Record<string, ReplayJson>;
  scheduler?: { setTimeout(callback: () => void, delay: number): Handle; clearTimeout(handle: Handle): void };
  onState?: (state: ReplayState) => void;
}): ReplaySession;
