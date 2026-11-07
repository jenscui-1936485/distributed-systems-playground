import { labs } from '../content';
import type { LabConfig } from '../model';
import { metricValue } from '../model';
import { simulate } from './run';

let failed = 0;

function expect(condition: boolean, message: string, config?: LabConfig) {
  if (condition) return;
  failed += 1;
  console.error(`FAIL ${message}`);
  if (config) {
    const result = simulate(config);
    console.error(result.summary);
    console.error(result.metrics.map((metric) => `${metric.id}=${metric.value}`).join(', '));
  }
}

function queueBase(patch: Partial<Extract<LabConfig, { labId: 'queue' }>> = {}): LabConfig {
  return { ...labs[0].defaults, ...patch, labId: 'queue' } as LabConfig;
}

const queueLab = labs.find((lab) => lab.id === 'queue')!;
const cacheLab = labs.find((lab) => lab.id === 'cache')!;
const rateLab = labs.find((lab) => lab.id === 'rate-limit')!;
const resilienceLab = labs.find((lab) => lab.id === 'resilience')!;
const consistencyLab = labs.find((lab) => lab.id === 'consistency')!;

const crash = queueBase();
const crashResult = simulate(crash);
expect(metricValue(crashResult, 'duplicateEffects') > 0, 'crash without idempotency duplicates work', crash);
expect(metricValue(crashResult, 'completed') === 8, 'all messages complete under at-least-once', crash);
expect(JSON.stringify(simulate(crash)) === JSON.stringify(simulate(crash)), 'queue runs are deterministic', crash);
expect(queueLab.evaluate(crashResult).pass === false, 'queue challenge starts unsolved');

const safe = queueBase({ idempotent: true });
const safeResult = simulate(safe);
expect(metricValue(safeResult, 'duplicateEffects') === 0, 'idempotency removes duplicate effects', safe);
expect(metricValue(safeResult, 'duplicateAttempts') > 0, 'idempotency still records the repeat attempt', safe);
expect(queueLab.evaluate(safeResult).pass, 'queue challenge passes when idempotent', safe);

const lossy = queueBase({ retryPolicy: 'at-most-once' });
expect(metricValue(simulate(lossy), 'dropped') > 0, 'at-most-once drops the crashed message', lossy);
expect(queueLab.evaluate(simulate(lossy)).pass === false, 'dropping the message does not pass the challenge');

const cache = cacheLab.defaults;
const cacheResult = simulate(cache);
expect(metricValue(cacheResult, 'staleReads') > 0, 'ttl mode serves stale reads', cache);
expect(metricValue(cacheResult, 'maxExposure') > 0, 'ttl exposes a stale window', cache);
expect(metricValue(cacheResult, 'lostUpdates') === 1, 'concurrent writers lose an update', cache);
expect(cacheLab.evaluate(cacheResult).pass === false, 'cache challenge starts unsolved');

const invalidated: LabConfig = { ...cache, invalidation: 'invalidate' } as LabConfig;
const invalidatedResult = simulate(invalidated);
expect(metricValue(invalidatedResult, 'staleReads') === 0, 'invalidate removes stale reads', invalidated);
expect(cacheLab.evaluate(invalidatedResult).pass, 'cache challenge passes on invalidate', invalidated);

const through: LabConfig = { ...cache, invalidation: 'write-through' } as LabConfig;
expect(metricValue(simulate(through), 'staleReads') === 0, 'write-through removes stale reads', through);
expect(cacheLab.evaluate(simulate(through)).pass, 'cache challenge passes on write-through');

const fixed = rateLab.defaults;
const fixedResult = simulate(fixed);
expect(metricValue(fixedResult, 'maxBurst') > metricValue(fixedResult, 'limit'), 'fixed window exceeds its limit', fixed);
expect(rateLab.evaluate(fixedResult).pass === false, 'rate challenge starts unsolved');

const sliding: LabConfig = { ...fixed, algorithm: 'sliding' } as LabConfig;
const slidingResult = simulate(sliding);
expect(metricValue(slidingResult, 'maxBurst') <= metricValue(slidingResult, 'limit'), 'sliding window respects the limit', sliding);
expect(metricValue(slidingResult, 'rejected') > 0, 'sliding window rejects the extra spike', sliding);
expect(rateLab.evaluate(slidingResult).pass, 'rate challenge passes on sliding window', sliding);

const bucketWide: LabConfig = { ...fixed, algorithm: 'token-bucket', burst: 8 } as LabConfig;
expect(rateLab.evaluate(simulate(bucketWide)).pass === false, 'a large token burst still fails', bucketWide);
const bucketTight: LabConfig = { ...fixed, algorithm: 'token-bucket', burst: 5 } as LabConfig;
expect(rateLab.evaluate(simulate(bucketTight)).pass, 'token bucket at the limit passes', bucketTight);

const storm = resilienceLab.defaults;
const stormResult = simulate(storm);
expect(metricValue(stormResult, 'circuitOpens') === 0, 'open-circuit-off baseline stays closed', storm);
expect(metricValue(stormResult, 'retries') > 6, 'baseline sends a retry storm', storm);
expect(resilienceLab.evaluate(stormResult).pass === false, 'resilience challenge starts unsolved');

const calmed: LabConfig = {
  ...storm,
  circuitThreshold: 3,
  maxRetries: 2,
  backoff: 'exponential',
  timeout: 4,
} as LabConfig;
const calmedResult = simulate(calmed);
expect(metricValue(calmedResult, 'circuitOpens') >= 1, 'circuit opens under the challenge fix', calmed);
expect(metricValue(calmedResult, 'successes') >= 1, 'a call succeeds after recovery', calmed);
expect(metricValue(calmedResult, 'retries') <= 6, 'retries stay bounded', calmed);
expect(resilienceLab.evaluate(calmedResult).pass, 'resilience challenge passes', calmed);

const eventual = consistencyLab.defaults;
const eventualResult = simulate(eventual);
expect(metricValue(eventualResult, 'ownWriteStale') > 0, 'eventual reads miss own writes', eventual);
expect(consistencyLab.evaluate(eventualResult).pass === false, 'consistency challenge starts unsolved');

const strong: LabConfig = { ...eventual, mode: 'strong' } as LabConfig;
const strongResult = simulate(strong);
expect(metricValue(strongResult, 'ownWriteStale') === 0, 'strong reads see own writes', strong);
expect(metricValue(strongResult, 'staleReads') === 0, 'strong reads are fresh', strong);
expect(metricValue(strongResult, 'unavailable') === 0, 'strong reads fit the timeout', strong);
expect(consistencyLab.evaluate(strongResult).pass, 'consistency challenge passes on strong', strong);

const session: LabConfig = { ...eventual, mode: 'read-your-writes' } as LabConfig;
const sessionResult = simulate(session);
expect(metricValue(sessionResult, 'ownWriteStale') === 0, 'read-your-writes sees own writes', session);
expect(consistencyLab.evaluate(sessionResult).pass, 'consistency challenge passes on read-your-writes', session);

const monotonic: LabConfig = { ...eventual, mode: 'monotonic' } as LabConfig;
expect(consistencyLab.evaluate(simulate(monotonic)).pass === false, 'monotonic reads do not pass the challenge', monotonic);

const impatient: LabConfig = { ...eventual, mode: 'strong', readTimeout: 1 } as LabConfig;
expect(metricValue(simulate(impatient), 'unavailable') > 0, 'a short timeout makes strong reads unavailable', impatient);

if (failed > 0) {
  throw new Error(`${failed} simulation checks failed`);
}
console.log('All simulation checks passed.');
