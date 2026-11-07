export type LabId = 'queue' | 'cache' | 'rate-limit' | 'resilience' | 'consistency';

export type Status = 'idle' | 'active' | 'ok' | 'warn' | 'bad' | 'off';

export interface QueueConfig {
  labId: 'queue';
  workerCount: number;
  processingTicks: number;
  retryPolicy: 'at-least-once' | 'at-most-once';
  ordering: 'fifo' | 'unordered';
  idempotent: boolean;
  crashBeforeAck: boolean;
  messageCount: number;
  seed: number;
}

export interface CacheConfig {
  labId: 'cache';
  ttl: number;
  invalidation: 'ttl' | 'invalidate' | 'write-through';
  concurrentWriters: boolean;
  seed: number;
}

export interface RateLimitConfig {
  labId: 'rate-limit';
  algorithm: 'fixed' | 'sliding' | 'token-bucket';
  limit: number;
  window: number;
  burst: number;
  traffic: 'steady' | 'bursty' | 'boundary';
  seed: number;
}

export interface ResilienceConfig {
  labId: 'resilience';
  timeout: number;
  maxRetries: number;
  backoff: 'none' | 'linear' | 'exponential';
  circuitThreshold: number;
  circuitCooldown: number;
  fault: 'healthy' | 'outage' | 'slow' | 'flaky';
  outageTicks: number;
  extraLatency: number;
  failureRate: number;
  requestCount: number;
  seed: number;
}

export interface ConsistencyConfig {
  labId: 'consistency';
  mode: 'eventual' | 'strong' | 'read-your-writes' | 'monotonic';
  replicas: number;
  lag: number;
  readTimeout: number;
  seed: number;
}

export type LabConfig =
  | QueueConfig
  | CacheConfig
  | RateLimitConfig
  | ResilienceConfig
  | ConsistencyConfig;

export interface Metric {
  id: string;
  label: string;
  value: number;
  display: string;
  better: 'higher' | 'lower' | 'neutral';
  hint?: string;
}

export interface SimEvent {
  id: string;
  tick: number;
  title: string;
  detail: string;
  status: 'info' | 'ok' | 'warn' | 'bad';
  tag?: 'crash' | 'duplicate' | 'stale' | 'reject' | 'open' | 'lag' | 'suppress';
}

export interface DiagramItem {
  id: string;
  label: string;
  status: Status;
  title?: string;
}

export interface DiagramNode {
  id: string;
  column: number;
  title: string;
  subtitle?: string;
  status: Status;
  statusText: string;
  items?: DiagramItem[];
  meter?: { value: number; max: number; label: string };
  note?: string;
}

export interface ChartPoint {
  tick: number;
  label: string;
  accepted: number;
  rejected: number;
}

export interface Frame {
  tick: number;
  caption: string;
  nodes: DiagramNode[];
  metrics: Metric[];
}

export interface SimulationResult {
  labId: LabId;
  config: LabConfig;
  events: SimEvent[];
  metrics: Metric[];
  frames: Frame[];
  summary: string;
  chart?: ChartPoint[];
}

export interface SavedScenario {
  id: string;
  labId: LabId;
  name: string;
  config: LabConfig;
  createdAt: number;
}

export interface SavedRun {
  id: string;
  labId: LabId;
  name: string;
  config: LabConfig;
  summary: string;
  createdAt: number;
}

export interface Progress {
  explored: LabId[];
  challenges: LabId[];
}

export interface StoreData {
  version: 1;
  scenarios: SavedScenario[];
  runs: SavedRun[];
  progress: Progress;
  persistWarning: boolean;
}

export function metricValue(result: SimulationResult, id: string): number {
  return result.metrics.find((metric) => metric.id === id)?.value ?? 0;
}
