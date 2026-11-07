import type { DiagramNode, Frame, ResilienceConfig, SimulationResult, Status } from '../model';
import { createLog, decimal, integer, lastCaption, metric } from './log';
import { createRng } from './rng';

type Circuit = 'closed' | 'open' | 'half-open';

interface CurrentCall {
  id: number;
  attempt: number;
  started: number;
  fails: boolean;
  latency: number;
}

interface Outcome {
  id: string;
  label: string;
  status: Status;
  title: string;
}

export function simulateResilience(config: ResilienceConfig): SimulationResult {
  const timeout = Math.max(1, Math.min(10, Math.round(config.timeout)));
  const maxRetries = Math.max(0, Math.min(5, Math.round(config.maxRetries)));
  const threshold = Math.max(0, Math.min(8, Math.round(config.circuitThreshold)));
  const cooldown = Math.max(2, Math.min(20, Math.round(config.circuitCooldown)));
  const outageTicks = Math.max(0, Math.min(40, Math.round(config.outageTicks)));
  const extraLatency = Math.max(0, Math.min(8, Math.round(config.extraLatency)));
  const failureRate = Math.max(0, Math.min(90, Math.round(config.failureRate)));
  const requestCount = Math.max(4, Math.min(12, Math.round(config.requestCount)));
  const latency = 2 + extraLatency;
  const rng = createRng(config.seed);
  const log = createLog();
  const frames: Frame[] = [];
  const outcomes: Outcome[] = [];

  let launched = 0;
  let current: CurrentCall | null = null;
  let waitUntil = -1;
  let nextAttempt = 1;
  let circuit: Circuit = 'closed';
  let consecutive = 0;
  let reopenAt = 0;
  let successes = 0;
  let serviceErrors = 0;
  let timeouts = 0;
  let breakerRejects = 0;
  let retries = 0;
  let circuitOpens = 0;
  let serviceAttempts = 0;
  let failedRequests = 0;
  let holding = false;
  let announcedHold = false;
  const successLatencies: number[] = [];
  const maxTick = 220;

  const callFails = (startTick: number) => {
    if (config.fault === 'outage') return startTick < outageTicks;
    if (config.fault === 'flaky') return rng() < failureRate / 100;
    return false;
  };

  const backoffDelay = (retryNumber: number) => {
    if (config.backoff === 'linear') return retryNumber * 2;
    if (config.backoff === 'exponential') return 2 ** retryNumber;
    return 1;
  };

  const finishRequest = (tick: number, title: string, detail: string, status: Outcome['status']) => {
    if (status !== 'ok') failedRequests += 1;
    outcomes.push({ id: `r${current?.id ?? launched}`, label: title, status, title: detail });
    log.add(tick, title, detail, status === 'ok' ? 'ok' : status === 'warn' ? 'warn' : 'bad', status === 'bad' ? 'open' : undefined);
    current = null;
    waitUntil = -1;
    nextAttempt = 1;
  };

  const openCircuit = (tick: number) => {
    if (threshold <= 0 || circuit === 'open') return;
    circuit = 'open';
    circuitOpens += 1;
    reopenAt = tick + cooldown;
    log.add(
      tick,
      'Circuit opened',
      `Reached ${consecutive} consecutive failures. New calls wait ${cooldown} ticks before a probe.`,
      'bad',
      'open',
    );
  };

  const failAttempt = (tick: number, kind: 'error' | 'timeout') => {
    if (!current) return;
    consecutive += 1;
    if (kind === 'timeout') {
      timeouts += 1;
      log.add(tick, `r${current.id} timed out`, `Attempt ${current.attempt} exceeded ${timeout} ticks.`, 'warn');
    } else {
      serviceErrors += 1;
      log.add(tick, `r${current.id} failed`, `Attempt ${current.attempt} received a service error.`, 'warn');
    }
    openCircuit(tick);
    if (circuit === 'open' || current.attempt > maxRetries) {
      finishRequest(
        tick,
        `r${current.id} failed`,
        circuit === 'open'
          ? 'The circuit is open, so leftover retries were not sent.'
          : 'Retry budget exhausted.',
        'bad',
      );
      return;
    }
    const delay = backoffDelay(current.attempt);
    nextAttempt = current.attempt + 1;
    waitUntil = tick + delay;
    log.add(tick, `r${current.id} will retry`, `Waiting ${delay} tick${delay === 1 ? '' : 's'} (${config.backoff} backoff).`, 'info');
    current = null;
  };

  const startAttempt = (tick: number, id: number, attempt: number) => {
    if (circuit === 'open') {
      breakerRejects += 1;
      current = { id, attempt, started: tick, fails: true, latency };
      finishRequest(tick, `r${id} rejected`, 'The open circuit failed this call without contacting the service.', 'warn');
      return;
    }
    const fails = callFails(tick);
    current = { id, attempt, started: tick, fails, latency };
    serviceAttempts += 1;
    if (attempt > 1) retries += 1;
    log.add(
      tick,
      circuit === 'half-open' ? `Probe r${id}` : `r${id} sent`,
      attempt > 1 ? `Retry ${attempt - 1} dispatched.` : 'First attempt dispatched.',
      'info',
    );
  };

  const buildMetrics = () => {
    const avg = successLatencies.length
      ? successLatencies.reduce((sum, value) => sum + value, 0) / successLatencies.length
      : 0;
    return [
      metric('successes', 'Succeeded', successes, integer(successes), 'higher'),
      metric('failedRequests', 'Failed requests', failedRequests, integer(failedRequests), 'lower'),
      metric('timeouts', 'Timeouts', timeouts, integer(timeouts), 'lower'),
      metric('serviceErrors', 'Service errors', serviceErrors, integer(serviceErrors), 'lower'),
      metric('retries', 'Retries sent', retries, integer(retries), 'lower', 'Extra attempts that actually reached the service.'),
      metric('breakerRejects', 'Breaker rejects', breakerRejects, integer(breakerRejects), 'neutral', 'Calls stopped locally while the circuit was open.'),
      metric('circuitOpens', 'Circuit opens', circuitOpens, integer(circuitOpens), 'neutral'),
      metric('avgLatency', 'Avg success latency', avg, successLatencies.length ? `${decimal(avg)} ticks` : '—', 'lower'),
      metric('attempts', 'Service attempts', serviceAttempts, integer(serviceAttempts), 'lower'),
    ];
  };

  const serviceStatus = (tick: number): { status: Status; text: string; note: string } => {
    if (config.fault === 'outage' && tick < outageTicks) {
      return { status: 'bad', text: 'Failing', note: `Injected outage until tick ${outageTicks}. Errors return in 1 tick.` };
    }
    if (config.fault === 'slow' || extraLatency > 0) {
      return { status: 'warn', text: 'Slow', note: `Calls need ${latency} ticks. Timeout is ${timeout}.` };
    }
    if (config.fault === 'flaky') {
      return { status: 'warn', text: 'Flaky', note: `About ${failureRate}% of attempts fail. The sequence is seeded.` };
    }
    return { status: 'ok', text: 'Healthy', note: `Calls succeed in ${latency} ticks when the timeout allows it.` };
  };

  const snapshot = (tick: number, settled: boolean): Frame => {
    const health = serviceStatus(tick);
    const circuitStatus: Status = circuit === 'open' ? 'bad' : circuit === 'half-open' ? 'warn' : 'ok';
    const nodes: DiagramNode[] = [
      {
        id: 'client',
        column: 0,
        title: 'Client',
        subtitle: `${launched} of ${requestCount} started`,
        status: holding ? 'warn' : current ? 'active' : 'idle',
        statusText: holding
          ? 'Paused by circuit'
          : current
            ? `r${current.id} attempt ${current.attempt}`
            : waitUntil >= 0
              ? 'Backing off'
              : 'Idle',
        note: holding
          ? 'New calls wait here instead of hammering an open circuit.'
          : 'One request at a time, so retry amplification stays easy to see.',
        meter: current
          ? { value: Math.min(timeout, tick - current.started), max: timeout, label: 'Timeout budget' }
          : undefined,
      },
      {
        id: 'circuit',
        column: 1,
        title: 'Circuit breaker',
        subtitle: threshold === 0 ? 'Disabled' : `Opens after ${threshold} failures`,
        status: circuitStatus,
        statusText: circuit === 'closed' ? 'Closed' : circuit === 'open' ? 'Open' : 'Half-open',
        note: circuit === 'open'
          ? `Probe allowed at tick ${reopenAt}.`
          : circuit === 'half-open'
            ? 'The next call is a probe. Success closes the circuit.'
            : `${consecutive} consecutive failures.`,
      },
      {
        id: 'service',
        column: 2,
        title: 'Service',
        status: health.status,
        statusText: health.text,
        note: health.note,
      },
      {
        id: 'results',
        column: 3,
        title: 'Outcomes',
        status: failedRequests > successes ? 'warn' : successes > 0 ? 'ok' : 'idle',
        statusText: `${successes} recovered`,
        items: outcomes.slice(-6).reverse(),
      },
    ];
    return {
      tick,
      caption: settled
        ? `Run complete. ${successes} succeeded, ${retries} retries sent, circuit opened ${circuitOpens} time${circuitOpens === 1 ? '' : 's'}.`
        : lastCaption(log.events, tick, 'Waiting for the next attempt.'),
      nodes,
      metrics: buildMetrics(),
    };
  };

  let settled = false;
  for (let tick = 0; tick <= maxTick && !settled; tick += 1) {
    if (circuit === 'open' && tick >= reopenAt) {
      circuit = 'half-open';
      log.add(tick, 'Circuit half-open', 'One probe call is allowed through.', 'warn', 'open');
    }

    holding = false;
    if (circuit === 'open' && !current && waitUntil < 0 && launched < requestCount) {
      holding = true;
      if (!announcedHold) {
        announcedHold = true;
        breakerRejects += 1;
        log.add(
          tick,
          'Client paused',
          'The circuit is open, so the next call waits for a probe instead of reaching the service.',
          'warn',
          'open',
        );
      }
    } else {
      if (circuit !== 'open') announcedHold = false;
      if (!current && waitUntil >= 0 && tick >= waitUntil) {
        const id = launched;
        startAttempt(tick, id, nextAttempt);
        waitUntil = -1;
      }

      if (!current && waitUntil < 0 && launched < requestCount) {
        launched += 1;
        startAttempt(tick, launched, 1);
      }
    }

    const active = current as CurrentCall | null;
    if (active && tick > active.started) {
      const elapsed = tick - active.started;
      if (active.fails && elapsed >= 1) {
        if (circuit === 'half-open') {
          circuit = 'open';
          reopenAt = tick + cooldown;
          circuitOpens += 1;
          log.add(tick, 'Probe failed', `Circuit opened again until tick ${reopenAt}.`, 'bad', 'open');
        }
        failAttempt(tick, 'error');
      } else if (!active.fails && elapsed >= active.latency && elapsed <= timeout) {
        const id = active.id;
        const attempt = active.attempt;
        consecutive = 0;
        if (circuit === 'half-open') {
          circuit = 'closed';
          log.add(tick, 'Circuit closed', 'The probe succeeded.', 'ok');
        }
        successes += 1;
        successLatencies.push(elapsed);
        log.add(tick, `r${id} succeeded`, `Attempt ${attempt} completed in ${elapsed} ticks.`, 'ok');
        current = null;
        outcomes.push({
          id: `r${id}`,
          label: `r${id} ok`,
          status: 'ok',
          title: `Completed in ${elapsed} ticks`,
        });
      } else if (elapsed >= timeout && (active.fails || active.latency > timeout)) {
        if (circuit === 'half-open') {
          circuit = 'open';
          reopenAt = tick + cooldown;
          circuitOpens += 1;
          log.add(tick, 'Probe timed out', `Circuit opened again until tick ${reopenAt}.`, 'bad', 'open');
        }
        failAttempt(tick, 'timeout');
      }
    }

    settled = launched === requestCount && !current && waitUntil < 0 && !holding;
    frames.push(snapshot(tick, settled));
  }

  const metrics = frames[frames.length - 1].metrics;
  return {
    labId: 'resilience',
    config,
    events: log.events,
    metrics,
    frames,
    summary: `${successes} succeeded, ${failedRequests} failed, ${retries} retries, circuit opened ${circuitOpens} time${circuitOpens === 1 ? '' : 's'}.`,
  };
}
