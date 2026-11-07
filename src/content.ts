import type { LabConfig, LabId, SimulationResult } from './model';
import { metricValue } from './model';

export type Difficulty = 'Intro' | 'Intermediate' | 'Advanced';

export interface FieldDef {
  key: string;
  label: string;
  help: string;
  kind: 'range' | 'select' | 'toggle';
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  format?: (value: number) => string;
}

export interface Verdict {
  pass: boolean;
  message: string;
}

export interface LabMeta {
  id: LabId;
  title: string;
  kicker: string;
  summary: string;
  difficulty: Difficulty;
  concepts: string[];
  assumptions: string[];
  seedHelp: string;
  fields: FieldDef[];
  defaults: LabConfig;
  challenge: {
    title: string;
    story: string;
    goal: string;
    start: LabConfig;
    lockedKeys: string[];
  };
  evaluate: (result: SimulationResult) => Verdict;
}

const queueDefaults: LabConfig = {
  labId: 'queue',
  workerCount: 2,
  processingTicks: 4,
  retryPolicy: 'at-least-once',
  ordering: 'fifo',
  idempotent: false,
  crashBeforeAck: true,
  messageCount: 8,
  seed: 3,
};

const cacheDefaults: LabConfig = {
  labId: 'cache',
  ttl: 8,
  invalidation: 'ttl',
  concurrentWriters: true,
  seed: 2,
};

const rateDefaults: LabConfig = {
  labId: 'rate-limit',
  algorithm: 'fixed',
  limit: 5,
  window: 10,
  burst: 8,
  traffic: 'boundary',
  seed: 1,
};

const resilienceDefaults: LabConfig = {
  labId: 'resilience',
  timeout: 4,
  maxRetries: 4,
  backoff: 'none',
  circuitThreshold: 0,
  circuitCooldown: 10,
  fault: 'outage',
  outageTicks: 36,
  extraLatency: 0,
  failureRate: 45,
  requestCount: 8,
  seed: 2,
};

const consistencyDefaults: LabConfig = {
  labId: 'consistency',
  mode: 'eventual',
  replicas: 2,
  lag: 6,
  readTimeout: 4,
  seed: 1,
};

function fail(message: string): Verdict {
  return { pass: false, message };
}

function pass(message: string): Verdict {
  return { pass: true, message };
}

export const labs: LabMeta[] = [
  {
    id: 'queue',
    title: 'Queue Processing',
    kicker: 'Delivery',
    summary: 'Watch a message move from producer to queue to worker. A crash before ack shows why retries and idempotency are a pair.',
    difficulty: 'Intro',
    concepts: ['At-least-once', 'At-most-once', 'Idempotency', 'Ordering'],
    seedHelp: 'The seed picks which message an unordered consumer takes. FIFO ignores it.',
    assumptions: [
      'One queue, a fixed processing time, and no network delay.',
      'The first worker to finish a message crashes once, after the side effect and before the ack.',
      'At-least-once puts that message at the tail. At-most-once drops it.',
      'Idempotency is a key on the message id. A repeat delivery does not repeat the side effect.',
    ],
    fields: [
      {
        key: 'workerCount',
        label: 'Workers',
        kind: 'range',
        min: 1,
        max: 4,
        step: 1,
        help: 'More workers take messages in parallel. A crash still sends its message to the tail, so completion order can change.',
      },
      {
        key: 'processingTicks',
        label: 'Processing time',
        kind: 'range',
        min: 2,
        max: 8,
        step: 1,
        format: (value) => `${value} ticks`,
        help: 'How long a worker holds a message before it can acknowledge. Longer jobs keep more messages in flight.',
      },
      {
        key: 'retryPolicy',
        label: 'Retry policy',
        kind: 'select',
        help: 'At-least-once redelivers when there is no ack. At-most-once does not, so a crash can lose the message.',
        options: [
          { value: 'at-least-once', label: 'At-least-once' },
          { value: 'at-most-once', label: 'At-most-once' },
        ],
      },
      {
        key: 'ordering',
        label: 'Ordering',
        kind: 'select',
        help: 'FIFO always hands out the oldest message. Unordered hands out a seeded pick, so completion order can shuffle.',
        options: [
          { value: 'fifo', label: 'FIFO' },
          { value: 'unordered', label: 'Unordered' },
        ],
      },
      {
        key: 'idempotent',
        label: 'Idempotent consumer',
        kind: 'toggle',
        help: 'When this is on, a second delivery of the same message does not repeat the side effect.',
      },
      {
        key: 'crashBeforeAck',
        label: 'Crash before ack',
        kind: 'toggle',
        help: 'The first worker to finish applies the side effect, then dies before acknowledging. Turn this on to see redelivery.',
      },
      {
        key: 'messageCount',
        label: 'Messages',
        kind: 'range',
        min: 4,
        max: 10,
        step: 1,
        help: 'How many messages the producer sends, one every other tick.',
      },
    ],
    defaults: queueDefaults,
    challenge: {
      title: 'The double charge',
      story: 'A worker charges the customer, then crashes before ack. The queue redelivers the message and the charge runs again.',
      goal: 'Keep the crash and at-least-once delivery. Make the extra delivery harmless so every message completes and duplicate work is zero.',
      start: queueDefaults,
      lockedKeys: ['crashBeforeAck', 'seed'],
    },
    evaluate: (result) => {
      if (result.config.labId !== 'queue') return fail('This check belongs to the queue lab.');
      const dropped = metricValue(result, 'dropped');
      const duplicates = metricValue(result, 'duplicateEffects');
      const repeats = metricValue(result, 'duplicateAttempts');
      const completed = metricValue(result, 'completed');
      if (result.config.retryPolicy !== 'at-least-once' || dropped > 0) {
        return fail('The crashed message was dropped. At-most-once avoids a second charge by losing the message. Keep at-least-once, and make the consumer idempotent.');
      }
      if (!result.config.idempotent || duplicates > 0) {
        return fail(`The side effect ran ${duplicates} extra time${duplicates === 1 ? '' : 's'}. Turn on idempotency so the redelivery does not charge again.`);
      }
      if (repeats < 1 || completed < result.config.messageCount) {
        return fail('The crash should still redeliver the message, and every message should be acknowledged once.');
      }
      return pass(`All ${completed} messages completed. The crash redelivered work ${repeats} time${repeats === 1 ? '' : 's'}, and idempotency ignored the repeat.`);
    },
  },
  {
    id: 'cache',
    title: 'Cache Behavior',
    kicker: 'Freshness',
    summary: 'A price key lives in a cache and a database. TTL bounds how long a stale read can survive. It does not make a write visible immediately.',
    difficulty: 'Intro',
    concepts: ['TTL', 'Invalidation', 'Write-through', 'Lost updates'],
    seedHelp: 'This lab follows a fixed script. The seed is stored so a saved run stays comparable.',
    assumptions: [
      'One key, called price. The cache starts warm with version 1.',
      'TTL is measured from the moment the value was cached, and reads do not extend it.',
      'Writes are applied before reads in the same tick, so write-through is visible immediately.',
      'A lost update is two writers committing from the same old version. Invalidation does not fix that race.',
    ],
    fields: [
      {
        key: 'ttl',
        label: 'TTL',
        kind: 'range',
        min: 1,
        max: 16,
        step: 1,
        format: (value) => `${value} ticks`,
        help: 'After a write, a cached value can stay wrong until this timer expires. A shorter TTL shrinks that window. It does not publish the write immediately.',
      },
      {
        key: 'invalidation',
        label: 'Invalidation',
        kind: 'select',
        help: 'TTL only waits. Invalidate deletes the entry on write. Write-through updates the cache in the same step as the database.',
        options: [
          { value: 'ttl', label: 'TTL only' },
          { value: 'invalidate', label: 'Invalidate on write' },
          { value: 'write-through', label: 'Write-through' },
        ],
      },
      {
        key: 'concurrentWriters',
        label: 'Concurrent writers',
        kind: 'toggle',
        help: 'A second writer commits a price computed from version 1 and overwrites a newer price. That is a lost update, separate from a stale cache hit.',
      },
    ],
    defaults: cacheDefaults,
    challenge: {
      title: 'The stale price',
      story: 'The database price changes, and shoppers keep reading the old cached value. Waiting for TTL eventually hides it. It does not make the new price visible now.',
      goal: 'Bring stale reads to zero without turning the cache off. Invalidate on write, or write through to the cache.',
      start: cacheDefaults,
      lockedKeys: ['ttl', 'seed'],
    },
    evaluate: (result) => {
      if (result.config.labId !== 'cache') return fail('This check belongs to the cache lab.');
      const stale = metricValue(result, 'staleReads');
      const lost = metricValue(result, 'lostUpdates');
      if (result.config.invalidation === 'ttl' || stale > 0) {
        return fail(`Readers still saw ${stale} stale price${stale === 1 ? '' : 's'}. TTL only limits how long that can last. Invalidate on write, or write through, so the cache cannot serve the old version.`);
      }
      const extra = lost > 0
        ? ` Writer B still overwrote a newer price (${lost} lost update). Cache invalidation does not fix that race.`
        : '';
      return pass(`Stale reads are zero. The cache no longer serves a price older than the database.${extra}`);
    },
  },
  {
    id: 'rate-limit',
    title: 'Rate Limiting',
    kicker: 'Admission',
    summary: 'Compare a fixed window, a sliding window, and a token bucket against the same traffic, including a burst that straddles a window boundary.',
    difficulty: 'Intermediate',
    concepts: ['Fixed window', 'Sliding window', 'Token bucket', 'Burst'],
    seedHelp: 'The seed shapes bursty traffic. Steady and boundary schedules ignore it.',
    assumptions: [
      'Time is discrete ticks. A fixed window is floor(tick / window).',
      'The sliding window counts accepted requests in the trailing window, including the current tick.',
      'The token bucket refills by limit/window each tick, capped at the burst size, and spends one token per accept.',
      'Peak accepts is the busiest span whose length is the configured window.',
    ],
    fields: [
      {
        key: 'algorithm',
        label: 'Algorithm',
        kind: 'select',
        help: 'Fixed windows reset on a boundary. Sliding windows count the trailing interval. Token buckets refill over time, up to the burst size.',
        options: [
          { value: 'fixed', label: 'Fixed window' },
          { value: 'sliding', label: 'Sliding window' },
          { value: 'token-bucket', label: 'Token bucket' },
        ],
      },
      {
        key: 'limit',
        label: 'Limit',
        kind: 'range',
        min: 1,
        max: 8,
        step: 1,
        format: (value) => `${value} / window`,
        help: 'How many requests the policy wants to allow per window. A fixed window can still admit about twice that across its edge.',
      },
      {
        key: 'window',
        label: 'Window',
        kind: 'range',
        min: 4,
        max: 20,
        step: 1,
        format: (value) => `${value} ticks`,
        help: 'Length of the accounting interval. The boundary scenario places a spike on both sides of tick 10, so 10 is the interesting setting.',
      },
      {
        key: 'burst',
        label: 'Burst capacity',
        kind: 'range',
        min: 1,
        max: 12,
        step: 1,
        help: 'Token bucket size. Fixed and sliding windows ignore it. A larger burst allows a taller immediate spike.',
      },
      {
        key: 'traffic',
        label: 'Traffic',
        kind: 'select',
        help: 'Steady sends one request per tick. Bursty uses the seed. Boundary puts six requests on each side of a window edge.',
        options: [
          { value: 'steady', label: 'Steady' },
          { value: 'bursty', label: 'Bursty' },
          { value: 'boundary', label: 'Boundary spike' },
        ],
      },
    ],
    defaults: rateDefaults,
    challenge: {
      title: 'The boundary burst',
      story: 'Five requests are allowed per 10 ticks, but a fixed window accepts a full quota just before the edge and a full quota just after it.',
      goal: 'Keep the boundary traffic. Change the algorithm, the limit, or the burst so the busiest window stays within the limit, while still rejecting some traffic.',
      start: rateDefaults,
      lockedKeys: ['traffic', 'window', 'seed'],
    },
    evaluate: (result) => {
      if (result.config.labId !== 'rate-limit') return fail('This check belongs to the rate limit lab.');
      const peak = metricValue(result, 'maxBurst');
      const accepted = metricValue(result, 'accepted');
      const rejected = metricValue(result, 'rejected');
      const limit = result.config.limit;
      if (accepted < 1 || rejected < 1) {
        return fail('The limiter should still accept some requests and reject some. A wide-open limit does not demonstrate the policy.');
      }
      if (peak > limit) {
        const hint = result.config.algorithm === 'fixed'
          ? 'A fixed window resets at the boundary, so the spike on tick 9 and the spike on tick 10 are counted separately.'
          : result.config.algorithm === 'token-bucket'
            ? 'The token bucket allowed a burst larger than the limit. Lower the burst capacity to the limit, or switch to a sliding window.'
            : 'The peak is still above the limit.';
        return fail(`The busiest window accepted ${peak}, and the limit is ${limit}. ${hint}`);
      }
      return pass(`The busiest window accepted ${peak}, which is within the limit of ${limit}. ${rejected} requests were rejected.`);
    },
  },
  {
    id: 'resilience',
    title: 'Resilience',
    kicker: 'Failure',
    summary: 'Inject an outage, slowness, or flaky errors. Then see how timeout, retry, backoff, and a circuit breaker change the number of calls that hit the service.',
    difficulty: 'Intermediate',
    concepts: ['Timeout', 'Backoff', 'Circuit breaker', 'Retry storm'],
    seedHelp: 'The seed drives which flaky attempts fail. Outages and slow calls follow the clock, not the seed.',
    assumptions: [
      'One client sends the next request only after the previous one settles.',
      'A healthy call takes 2 ticks plus any extra latency. Service errors return in 1 tick.',
      'The circuit opens after a run of consecutive failures. Zero disables it.',
      'While the circuit is open the client waits. A half-open probe is a single call. Leftover retries are not sent after the circuit opens.',
    ],
    fields: [
      {
        key: 'timeout',
        label: 'Timeout',
        kind: 'range',
        min: 1,
        max: 10,
        step: 1,
        format: (value) => `${value} ticks`,
        help: 'The client gives up if the attempt is still running after this many ticks. A healthy call needs 2 ticks plus extra latency.',
      },
      {
        key: 'maxRetries',
        label: 'Retries',
        kind: 'range',
        min: 0,
        max: 5,
        step: 1,
        help: 'Extra attempts after the first failure. Each one can reach the service until the circuit opens.',
      },
      {
        key: 'backoff',
        label: 'Backoff',
        kind: 'select',
        help: 'None waits 1 tick. Linear waits 2, 4, 6… Exponential waits 2, 4, 8… Longer waits spread a storm out.',
        options: [
          { value: 'none', label: 'None' },
          { value: 'linear', label: 'Linear' },
          { value: 'exponential', label: 'Exponential' },
        ],
      },
      {
        key: 'circuitThreshold',
        label: 'Circuit threshold',
        kind: 'range',
        min: 0,
        max: 8,
        step: 1,
        format: (value) => (value === 0 ? 'Off' : `${value} failures`),
        help: 'Consecutive failures before new calls pause. Zero leaves the breaker off, so retries keep hitting the outage.',
      },
      {
        key: 'circuitCooldown',
        label: 'Cooldown',
        kind: 'range',
        min: 2,
        max: 20,
        step: 1,
        format: (value) => `${value} ticks`,
        help: 'How long the circuit stays open before one probe. A short cooldown probes the outage again and again.',
      },
      {
        key: 'fault',
        label: 'Injected fault',
        kind: 'select',
        help: 'Healthy serves every call. Outage returns errors until the outage tick. Slow adds latency. Flaky fails a seeded fraction of attempts.',
        options: [
          { value: 'healthy', label: 'Healthy' },
          { value: 'outage', label: 'Outage' },
          { value: 'slow', label: 'Slow' },
          { value: 'flaky', label: 'Flaky' },
        ],
      },
      {
        key: 'outageTicks',
        label: 'Outage length',
        kind: 'range',
        min: 0,
        max: 40,
        step: 1,
        format: (value) => `${value} ticks`,
        help: 'Calls that start before this tick receive an error when the fault is an outage.',
      },
      {
        key: 'extraLatency',
        label: 'Extra latency',
        kind: 'range',
        min: 0,
        max: 8,
        step: 1,
        format: (value) => `+${value} ticks`,
        help: 'Added to the 2-tick success path. If the total is above the timeout, even a healthy service looks down.',
      },
      {
        key: 'failureRate',
        label: 'Flaky failure rate',
        kind: 'range',
        min: 0,
        max: 90,
        step: 5,
        format: (value) => `${value}%`,
        help: 'Used by the flaky fault. The same seed reproduces the same failures.',
      },
      {
        key: 'requestCount',
        label: 'Requests',
        kind: 'range',
        min: 4,
        max: 12,
        step: 1,
        help: 'How many calls the client will make, one at a time.',
      },
    ],
    defaults: resilienceDefaults,
    challenge: {
      title: 'The retry storm',
      story: 'The service is down until tick 36. The client retries immediately, with the circuit off, so every failure becomes more load.',
      goal: 'Open the circuit, keep retries from multiplying, and still complete at least one call after the service recovers. Healthy calls need a timeout of at least 2 ticks.',
      start: resilienceDefaults,
      lockedKeys: ['fault', 'outageTicks', 'failureRate', 'requestCount', 'seed'],
    },
    evaluate: (result) => {
      if (result.config.labId !== 'resilience') return fail('This check belongs to the resilience lab.');
      const successes = metricValue(result, 'successes');
      const opens = metricValue(result, 'circuitOpens');
      const retries = metricValue(result, 'retries');
      if (successes < 1) {
        return fail('No call succeeded. After the outage a healthy attempt takes 2 ticks plus extra latency. The timeout has to cover that, and the circuit has to allow a probe.');
      }
      if (opens < 1) {
        return fail('The circuit never opened, so the client kept choosing whether to hammer a failing service. Set a failure threshold of at least 1.');
      }
      if (retries > 6) {
        return fail(`The service still received ${retries} retries. Lower the retry count so the open circuit, not a tight retry loop, absorbs the outage.`);
      }
      const backoffNote = result.config.backoff === 'none'
        ? ' Backoff is still immediate; it matters most while the circuit is closed.'
        : '';
      return pass(`The circuit opened ${opens} time${opens === 1 ? '' : 's'}, ${retries} retries reached the service, and ${successes} call${successes === 1 ? '' : 's'} succeeded.${backoffNote}`);
    },
  },
  {
    id: 'consistency',
    title: 'Database Consistency',
    kicker: 'Replicas',
    summary: 'Two clients read and write a primary and a few lagging replicas. The consistency mode decides who can see a write, and how long they wait.',
    difficulty: 'Advanced',
    concepts: ['Eventual', 'Strong', 'Read-your-writes', 'Monotonic reads'],
    seedHelp: 'The seed rotates which replica an eventual, monotonic, or session read tries first.',
    assumptions: [
      'The primary commits immediately. Replica N applies the write after lag + (N − 1) ticks.',
      'Eventual and session reads prefer a replica and return in 1 tick. The primary takes 3 ticks.',
      'Read-your-writes sends that client to the primary until a replica shows their own write.',
      'Monotonic reads remember versions this client has read, not versions it has written. A read that would take longer than the timeout fails instead of returning late data.',
    ],
    fields: [
      {
        key: 'mode',
        label: 'Consistency',
        kind: 'select',
        help: 'Eventual reads a replica now. Strong reads the primary. Read-your-writes protects that client’s own commits. Monotonic only forbids going backwards from a version already read.',
        options: [
          { value: 'eventual', label: 'Eventual' },
          { value: 'strong', label: 'Strong' },
          { value: 'read-your-writes', label: 'Read-your-writes' },
          { value: 'monotonic', label: 'Monotonic reads' },
        ],
      },
      {
        key: 'replicas',
        label: 'Replicas',
        kind: 'range',
        min: 1,
        max: 3,
        step: 1,
        help: 'Followers of the primary. Each later replica is one tick slower than the one before it.',
      },
      {
        key: 'lag',
        label: 'Replica lag',
        kind: 'range',
        min: 0,
        max: 12,
        step: 1,
        format: (value) => `${value} ticks`,
        help: 'Base delay before the first replica applies a write. Zero lag makes every mode look fresh.',
      },
      {
        key: 'readTimeout',
        label: 'Read timeout',
        kind: 'range',
        min: 1,
        max: 10,
        step: 1,
        format: (value) => `${value} ticks`,
        help: 'If a stronger read would take longer than this, it fails. Eventual reads take 1 tick, so they stay available and can be stale.',
      },
    ],
    defaults: consistencyDefaults,
    challenge: {
      title: 'Read your own write',
      story: 'Client A writes, then reads a replica that has not applied that write. The read is fast, and it misses the commit the client just made.',
      goal: 'With lag still at 6 and the timeout still at 4, choose a mode where neither client misses their own write, and no read times out.',
      start: consistencyDefaults,
      lockedKeys: ['lag', 'readTimeout', 'seed'],
    },
    evaluate: (result) => {
      if (result.config.labId !== 'consistency') return fail('This check belongs to the consistency lab.');
      const missed = metricValue(result, 'ownWriteStale');
      const unavailable = metricValue(result, 'unavailable');
      const stale = metricValue(result, 'staleReads');
      const mode = result.config.mode;
      if (unavailable > 0) {
        return fail('A read timed out. Strong and read-your-writes need 3 ticks, and this challenge allows 4. Eventual stays fast by answering from a replica.');
      }
      if (mode === 'eventual') {
        return fail(`Eventual reads missed ${missed} of the writer’s own commits. Replica lag is ${result.config.lag} ticks. Choose strong consistency or read-your-writes.`);
      }
      if (mode === 'monotonic') {
        return fail('Monotonic reads only refuse a version older than one this client has already read. They do not promise the client will see its own latest write. Choose strong or read-your-writes.');
      }
      if (missed > 0 || (mode !== 'strong' && mode !== 'read-your-writes')) {
        return fail('A client still read a version older than a write it had committed.');
      }
      const other = mode === 'read-your-writes' && stale > 0
        ? ` Other clients still saw ${stale} stale read${stale === 1 ? '' : 's'}, because their sessions did not require the primary.`
        : ' Reads matched the primary.';
      return pass(`Neither client missed their own write.${other}`);
    },
  },
];

export function getLab(id: string | undefined): LabMeta | undefined {
  return labs.find((lab) => lab.id === id);
}

export function readSetting(config: LabConfig, key: string): string | number | boolean {
  return (config as unknown as Record<string, string | number | boolean>)[key];
}

export function patchConfig(config: LabConfig, key: string, value: string | number | boolean): LabConfig {
  return { ...config, [key]: value } as LabConfig;
}

export function withDefaults(config: LabConfig): LabConfig {
  const lab = getLab(config.labId);
  if (!lab) return config;
  return { ...lab.defaults, ...config, labId: lab.id } as LabConfig;
}

export function formatField(field: FieldDef, value: string | number | boolean | undefined): string {
  if (value === undefined) return '—';
  if (field.kind === 'toggle') return value ? 'On' : 'Off';
  if (field.kind === 'select') {
    return field.options?.find((option) => option.value === String(value))?.label ?? String(value);
  }
  if (field.format && typeof value === 'number') return field.format(value);
  return String(value);
}

export function describeConfig(config: LabConfig): { key: string; label: string; value: string }[] {
  const lab = getLab(config.labId);
  if (!lab) return [];
  const rows = lab.fields.map((field) => ({
    key: field.key,
    label: field.label,
    value: formatField(field, readSetting(config, field.key)),
  }));
  rows.push({ key: 'seed', label: 'Seed', value: String(config.seed) });
  return rows;
}

export function suggestedName(config: LabConfig): string {
  const lab = getLab(config.labId);
  if (!lab) return 'Run';
  if (config.labId === 'queue') {
    return `Queue · ${config.workerCount} workers · ${config.retryPolicy === 'at-least-once' ? 'at-least-once' : 'at-most-once'}`;
  }
  if (config.labId === 'cache') {
    const mode = config.invalidation === 'ttl' ? 'TTL' : config.invalidation === 'invalidate' ? 'invalidate' : 'write-through';
    return `Cache · ${mode} · ${config.ttl} ticks`;
  }
  if (config.labId === 'rate-limit') {
    return `Limiter · ${config.algorithm} · ${config.limit}/${config.window}`;
  }
  if (config.labId === 'resilience') {
    return `Resilience · ${config.fault} · ${config.maxRetries} retries`;
  }
  return `${lab.title} · ${config.mode}`;
}

export function progressLabel(labId: LabId, explored: LabId[], challenges: LabId[]): 'passed' | 'watched' | 'new' {
  if (challenges.includes(labId)) return 'passed';
  if (explored.includes(labId)) return 'watched';
  return 'new';
}
