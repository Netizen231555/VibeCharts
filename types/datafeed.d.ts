import type {
  Chart,
  IndexDatafeed,
  IndexFeedContext,
  HistoryRequest,
  HistoryResult,
  FeedEvent,
  FeedGapEvent,
  FeedGapRange,
  ObservationEvent,
  Observation,
  DatafeedControllerState,
  DatafeedStatusEvent,
  ObservationDelivery,
  DatafeedObservationEntry,
  Unsubscribe
} from './index.js';

export class DatafeedError extends Error {
  readonly code: string;
  readonly operation?: string;
  readonly field?: string;
  readonly context?: IndexFeedContext | null;
}

export interface DatafeedControllerOptions {
  chart: Chart;
  pageSize?: number;
  onStatus?: (event: DatafeedStatusEvent) => void;
  onError?: (error: Error) => void;
  onObservation?: (event: ObservationDelivery) => void;
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

export function createDatafeedController(options: DatafeedControllerOptions): DatafeedController;
export function validateDatafeed(feed: IndexDatafeed): void;
export function validateHistoryResult(result: HistoryResult, request: HistoryRequest): void;
export function validateFeedEvent(event: FeedEvent, context: IndexFeedContext): void;
export function validateObservationEvent(event: ObservationEvent, context: IndexFeedContext): void;

export type { IndexDatafeed, IndexFeedContext, HistoryRequest, HistoryResult, FeedEvent, FeedGapEvent, FeedGapRange, Observation, ObservationEvent, DatafeedControllerState, DatafeedStatusEvent, ObservationDelivery, DatafeedObservationEntry, Unsubscribe };
