import type { ChartPoint, DiagramNode, Frame, RateLimitConfig, SimulationResult, Status } from '../model';
import { createLog, decimal, integer, lastCaption, metric } from './log';
import { createRng } from './rng';

interface Decision {
  id: string;
  tick: number;
  accepted: boolean;
}

function trafficAt(config: RateLimitConfig, tick: number, rng: () => number): number {
  if (tick > 40) return 0;
  if (config.traffic === 'steady') return tick < 30 ? 1 : 0;
  if (config.traffic === 'boundary') {
    if (tick === 9 || tick === 10) return 6;
    if (tick === 24 || tick === 28 || tick === 32) return 1;
    return 0;
  }
  if (rng() < 0.1) return 4;
  if (rng() < 0.35) return 1;
  return 0;
}

export function simulateRateLimit(config: RateLimitConfig): SimulationResult {
  const limit = Math.max(1, Math.min(8, Math.round(config.limit)));
  const window = Math.max(4, Math.min(20, Math.round(config.window)));
  const burst = Math.max(1, Math.min(12, Math.round(config.burst)));
  const rng = createRng(config.seed);
  const log = createLog();
  const frames: Frame[] = [];
  const chart: ChartPoint[] = [];
  const decisions: Decision[] = [];
  const acceptedTicks: number[] = [];

  let tokens = burst;
  let fixedCount = 0;
  let fixedWindow = 0;
  let accepted = 0;
  let rejected = 0;
  let sequence = 0;
  const maxTick = 40;

  const acceptsInWindow = (tick: number) => acceptedTicks.filter((time) => tick - time < window && tick - time >= 0).length;

  const buildMetrics = (maxBurst: number) => {
    const total = accepted + rejected;
    const rejectRate = total ? (rejected / total) * 100 : 0;
    return [
      metric('accepted', 'Accepted', accepted, integer(accepted), 'higher'),
      metric('rejected', 'Rejected', rejected, integer(rejected), 'neutral', 'Rejected means the limiter protected capacity. Zero rejects can mean the limit never bound anything.'),
      metric('rejectRate', 'Reject rate', rejectRate, total ? `${Math.round(rejectRate)}%` : '—', 'neutral'),
      metric('limit', 'Configured limit', limit, `${limit} / ${window} ticks`, 'neutral'),
      metric(
        'maxBurst',
        'Peak accepts in any window',
        maxBurst,
        integer(maxBurst),
        'lower',
        'The busiest span of this window length. A fixed window can admit about twice the limit across its boundary.',
      ),
      metric('tokens', 'Bucket capacity', burst, config.algorithm === 'token-bucket' ? integer(burst) : 'unused', 'neutral', 'Only the token bucket uses burst capacity.'),
    ];
  };

  const maxBurstAt = (tick: number) => {
    let peak = 0;
    for (let start = 0; start <= tick; start += 1) {
      const count = acceptedTicks.filter((time) => time >= start && time < start + window && time <= tick).length;
      peak = Math.max(peak, count);
    }
    return peak;
  };

  const snapshot = (tick: number, settled: boolean): Frame => {
    const inWindow = acceptsInWindow(tick);
    const recent = decisions.slice(-8).reverse();
    let statusText = '';
    let meterValue = 0;
    let meterMax = limit;
    let meterLabel = 'In window';
    if (config.algorithm === 'fixed') {
      statusText = `${fixedCount} of ${limit} in window ${fixedWindow}`;
      meterValue = fixedCount;
      meterLabel = 'Fixed window count';
    } else if (config.algorithm === 'sliding') {
      statusText = `${inWindow} of ${limit} in the last ${window} ticks`;
      meterValue = inWindow;
      meterLabel = 'Sliding count';
    } else {
      statusText = `${decimal(tokens)} of ${burst} tokens`;
      meterValue = tokens;
      meterMax = burst;
      meterLabel = 'Tokens';
    }
    const over = maxBurstAt(tick) > limit;
    const nodes: DiagramNode[] = [
      {
        id: 'traffic',
        column: 0,
        title: 'Traffic',
        subtitle: config.traffic === 'boundary'
          ? 'Spike on a window boundary'
          : config.traffic === 'bursty'
            ? 'Seeded clumps'
            : 'One request per tick',
        status: 'active',
        statusText: `${accepted + rejected} seen`,
        note: 'The schedule is fixed for a configuration, so replays match.',
      },
      {
        id: 'limiter',
        column: 1,
        title: config.algorithm === 'fixed'
          ? 'Fixed window'
          : config.algorithm === 'sliding'
            ? 'Sliding window'
            : 'Token bucket',
        subtitle: `${limit} requests / ${window} ticks`,
        status: over ? 'warn' : 'active',
        statusText,
        meter: { value: Math.max(0, meterValue), max: Math.max(1, meterMax), label: meterLabel },
        note: config.algorithm === 'fixed'
          ? 'The counter resets on the window edge, so two adjacent windows can both be full.'
          : config.algorithm === 'sliding'
            ? 'Only requests inside the trailing window count.'
            : 'Tokens refill continuously and spending is capped by the bucket size.',
      },
      {
        id: 'decisions',
        column: 2,
        title: 'Recent decisions',
        status: recent.some((item) => !item.accepted) ? 'warn' : 'ok',
        statusText: `${rejected} rejected`,
        items: recent.map((item) => ({
          id: item.id,
          label: `${item.accepted ? 'Accept' : 'Reject'} t${item.tick}`,
          status: (item.accepted ? 'ok' : 'bad') as Status,
          title: item.accepted ? 'Under the limit' : 'Over the limit',
        })),
      },
    ];
    return {
      tick,
      caption: settled
        ? `Run complete. Peak of ${maxBurstAt(tick)} accepts inside any ${window}-tick window, limit is ${limit}.`
        : lastCaption(log.events, tick, 'The limiter is watching an idle tick.'),
      nodes,
      metrics: buildMetrics(maxBurstAt(tick)),
    };
  };

  for (let tick = 0; tick <= maxTick; tick += 1) {
    const windowIndex = Math.floor(tick / window);
    if (windowIndex !== fixedWindow) {
      fixedWindow = windowIndex;
      fixedCount = 0;
      if (config.algorithm === 'fixed') {
        log.add(tick, 'Window reset', `Fixed window ${fixedWindow} started with an empty counter.`, 'info');
      }
    }
    tokens = Math.min(burst, tokens + limit / window);

    const arrivals = trafficAt(config, tick, rng);
    let tickAccepted = 0;
    let tickRejected = 0;
    for (let n = 0; n < arrivals; n += 1) {
      sequence += 1;
      let allow = false;
      if (config.algorithm === 'fixed') {
        allow = fixedCount < limit;
        if (allow) fixedCount += 1;
      } else if (config.algorithm === 'sliding') {
        allow = acceptsInWindow(tick) < limit;
      } else {
        allow = tokens >= 1;
        if (allow) tokens -= 1;
      }
      if (allow) {
        accepted += 1;
        tickAccepted += 1;
        acceptedTicks.push(tick);
        decisions.push({ id: `d${sequence}`, tick, accepted: true });
      } else {
        rejected += 1;
        tickRejected += 1;
        decisions.push({ id: `d${sequence}`, tick, accepted: false });
        log.add(tick, 'Request rejected', `${labelFor(config)} refused a request at tick ${tick}.`, 'warn', 'reject');
      }
    }
    if (tickAccepted > 0) {
      log.add(
        tick,
        tickAccepted === 1 ? 'Request accepted' : `${tickAccepted} requests accepted`,
        `${labelFor(config)} admitted traffic at tick ${tick}.`,
        'ok',
      );
    }
    chart.push({ tick, label: String(tick), accepted: tickAccepted, rejected: tickRejected });
    frames.push(snapshot(tick, tick === maxTick));
  }

  const metrics = frames[frames.length - 1].metrics;
  const peak = metrics.find((item) => item.id === 'maxBurst')?.value ?? 0;
  return {
    labId: 'rate-limit',
    config,
    events: log.events,
    metrics,
    frames,
    chart,
    summary: `${accepted} accepted, ${rejected} rejected, peak ${integer(peak)} in any window of ${window}.`,
  };
}

function labelFor(config: RateLimitConfig): string {
  if (config.algorithm === 'fixed') return 'Fixed window';
  if (config.algorithm === 'sliding') return 'Sliding window';
  return 'Token bucket';
}
