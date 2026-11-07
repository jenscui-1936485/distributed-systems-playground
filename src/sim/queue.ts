import type { DiagramNode, Frame, QueueConfig, SimulationResult, Status } from '../model';
import { createLog, decimal, integer, lastCaption, metric } from './log';
import { createRng } from './rng';

interface Message {
  id: number;
  enqueuedAt: number;
  attempts: number;
  effects: number;
  state: 'queued' | 'inflight' | 'done' | 'dropped';
}

interface Worker {
  id: number;
  status: 'idle' | 'busy' | 'down';
  messageId: number | null;
  remaining: number;
  downFor: number;
}

export function simulateQueue(config: QueueConfig): SimulationResult {
  const workerCount = Math.max(1, Math.min(4, Math.round(config.workerCount)));
  const processingTicks = Math.max(2, Math.min(8, Math.round(config.processingTicks)));
  const messageCount = Math.max(4, Math.min(10, Math.round(config.messageCount)));
  const rng = createRng(config.seed);

  const messages: Message[] = [];
  const queue: number[] = [];
  const workers: Worker[] = Array.from({ length: workerCount }, (_, index) => ({
    id: index + 1,
    status: 'idle',
    messageId: null,
    remaining: 0,
    downFor: 0,
  }));

  const log = createLog();
  let produced = 0;
  let crashedOnce = false;
  let retries = 0;
  let duplicateEffects = 0;
  let duplicateAttempts = 0;
  let inversions = 0;
  let maxCompletedId = 0;
  const latencies: number[] = [];
  const frames: Frame[] = [];
  const maxTick = 140;

  const findMessage = (id: number) => messages.find((message) => message.id === id)!;

  const applyEffect = (tick: number, message: Message) => {
    if (message.effects > 0) {
      duplicateAttempts += 1;
      if (config.idempotent) {
        log.add(
          tick,
          `m${message.id} suppressed`,
          'Idempotency key already applied, so the second delivery did not repeat the side effect.',
          'ok',
          'suppress',
        );
      } else {
        message.effects += 1;
        duplicateEffects += 1;
        log.add(
          tick,
          `m${message.id} duplicated`,
          'The side effect ran again because the earlier attempt never acknowledged the message.',
          'bad',
          'duplicate',
        );
      }
      return;
    }
    message.effects += 1;
    log.add(
      tick,
      `m${message.id} applied`,
      'The worker performed the side effect for this message.',
      'info',
    );
  };

  const buildMetrics = (tick: number) => {
    const completed = messages.filter((message) => message.state === 'done').length;
    const dropped = messages.filter((message) => message.state === 'dropped').length;
    const avgLatency = latencies.length
      ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
      : 0;
    const throughput = tick > 0 ? (completed / tick) * 10 : 0;
    return [
      metric('completed', 'Completed', completed, integer(completed), 'higher', 'Messages acknowledged after a successful attempt.'),
      metric('dropped', 'Dropped', dropped, integer(dropped), 'lower', 'Messages that will not be retried.'),
      metric('retries', 'Redeliveries', retries, integer(retries), 'lower', 'Times a message returned to the queue after a crash.'),
      metric(
        'duplicateAttempts',
        'Repeat attempts',
        duplicateAttempts,
        integer(duplicateAttempts),
        'neutral',
        'Processing attempts after the side effect had already run.',
      ),
      metric(
        'duplicateEffects',
        'Duplicate work',
        duplicateEffects,
        integer(duplicateEffects),
        'lower',
        'Extra side effects. Idempotency keeps this at zero even when attempts repeat.',
      ),
      metric('avgLatency', 'Avg latency', avgLatency, latencies.length ? `${decimal(avgLatency)} ticks` : '—', 'lower'),
      metric('throughput', 'Throughput', throughput, `${decimal(throughput)} / 10 ticks`, 'higher'),
      metric(
        'inversions',
        'Out-of-order completions',
        inversions,
        integer(inversions),
        'lower',
        'Messages that finished after a higher id. Crashes requeue to the tail, so FIFO can still reorder.',
      ),
    ];
  };

  const snapshot = (tick: number, settled: boolean): Frame => {
    const completed = messages.filter((message) => message.state === 'done');
    const dropped = messages.filter((message) => message.state === 'dropped');
    const effects = messages.reduce((sum, message) => sum + message.effects, 0);
    const nodes: DiagramNode[] = [
      {
        id: 'producer',
        column: 0,
        title: 'Producer',
        subtitle: `${produced} of ${messageCount} sent`,
        status: produced < messageCount ? 'active' : 'ok',
        statusText: produced < messageCount ? 'Sending' : 'Done',
        note: 'Publishes one message every other tick.',
      },
      {
        id: 'queue',
        column: 1,
        title: 'Queue',
        subtitle: config.ordering === 'fifo' ? 'FIFO' : 'Unordered pulls',
        status: queue.length > 0 ? 'active' : 'idle',
        statusText: `${queue.length} waiting`,
        items: queue.map((id) => ({
          id: `q${id}`,
          label: `m${id}`,
          status: 'idle' as Status,
          title: `Enqueued at tick ${findMessage(id).enqueuedAt}, attempt ${findMessage(id).attempts + 1}`,
        })),
        note: queue.length === 0 ? 'Empty' : 'Front of the queue is on the left.',
      },
      ...workers.map((worker) => {
        const message = worker.messageId ? findMessage(worker.messageId) : null;
        const status: Status = worker.status === 'down' ? 'bad' : worker.status === 'busy' ? 'active' : 'idle';
        const statusText = worker.status === 'down'
          ? `Restarting · ${worker.downFor}`
          : worker.status === 'busy'
            ? `Working · ${worker.remaining}`
            : 'Idle';
        return {
          id: `worker-${worker.id}`,
          column: 2,
          title: `Worker ${worker.id}`,
          status,
          statusText,
          items: message
            ? [{
              id: `w${worker.id}-${message.id}`,
              label: `m${message.id}`,
              status: 'active' as Status,
              title: `Attempt ${message.effects > 0 ? 'redelivery' : message.attempts}, ${worker.remaining} ticks left`,
            }]
            : [],
          meter: worker.status === 'busy'
            ? {
              value: processingTicks - worker.remaining,
              max: processingTicks,
              label: 'Processing',
            }
            : undefined,
          note: worker.status === 'down' ? 'Crashed before ack' : undefined,
        };
      }),
      {
        id: 'done',
        column: 3,
        title: 'Completed',
        subtitle: `${effects} side effect${effects === 1 ? '' : 's'}`,
        status: completed.length === messageCount ? 'ok' : completed.length > 0 ? 'active' : 'idle',
        statusText: `${completed.length} acked`,
        items: completed.map((message) => ({
          id: `done-${message.id}`,
          label: `m${message.id}`,
          status: message.effects > 1 ? 'warn' : 'ok',
          title: message.effects > 1 ? `Side effect ran ${message.effects} times` : 'Acknowledged once',
        })),
      },
      {
        id: 'issues',
        column: 3,
        title: 'Problems',
        subtitle: config.idempotent ? 'Idempotent consumer' : 'Side effects are not idempotent',
        status: duplicateEffects > 0 || dropped.length > 0 ? 'bad' : duplicateAttempts > 0 ? 'warn' : 'idle',
        statusText: duplicateEffects > 0 ? `${duplicateEffects} duplicates` : dropped.length > 0 ? `${dropped.length} lost` : 'None yet',
        items: [
          ...dropped.map((message) => ({
            id: `drop-${message.id}`,
            label: `m${message.id} lost`,
            status: 'bad' as Status,
            title: 'Not redelivered',
          })),
          ...(duplicateEffects > 0
            ? [{
              id: 'dup',
              label: `${duplicateEffects} extra effects`,
              status: 'bad' as Status,
              title: 'Retry repeated real work',
            }]
            : []),
          ...(duplicateAttempts > 0 && duplicateEffects === 0
            ? [{
              id: 'safe',
              label: `${duplicateAttempts} repeat${duplicateAttempts === 1 ? '' : 's'} ignored`,
              status: 'ok' as Status,
              title: 'Idempotency made the redelivery harmless',
            }]
            : []),
        ],
      },
    ];

    const metrics = buildMetrics(tick);
    return {
      tick,
      caption: settled
        ? `Run complete. ${completed.length} acknowledged, ${duplicateEffects} duplicate side effects, ${dropped.length} dropped.`
        : lastCaption(log.events, tick, 'The queue is stepping through the current configuration.'),
      nodes,
      metrics,
    };
  };

  let settled = false;
  for (let tick = 0; tick <= maxTick && !settled; tick += 1) {
    for (const worker of workers) {
      if (worker.status !== 'down') continue;
      worker.downFor -= 1;
      if (worker.downFor <= 0) {
        worker.status = 'idle';
        worker.downFor = 0;
        log.add(tick, `Worker ${worker.id} restarted`, 'The process is idle and can take another message.', 'info');
      }
    }

    for (const worker of workers) {
      if (worker.status !== 'busy' || worker.messageId === null) continue;
      worker.remaining -= 1;
      if (worker.remaining > 0) continue;
      const message = findMessage(worker.messageId);
      const crash = config.crashBeforeAck && !crashedOnce;
      if (crash) {
        crashedOnce = true;
        applyEffect(tick, message);
        worker.status = 'down';
        worker.downFor = 4;
        worker.messageId = null;
        message.state = 'queued';
        log.add(
          tick,
          `Worker ${worker.id} crashed`,
          `The side effect for m${message.id} ran, then the worker died before acknowledging.`,
          'bad',
          'crash',
        );
        if (config.retryPolicy === 'at-least-once') {
          queue.push(message.id);
          retries += 1;
          log.add(
            tick,
            `m${message.id} requeued`,
            'At-least-once delivery put the unacknowledged message at the tail.',
            'warn',
            'duplicate',
          );
        } else {
          message.state = 'dropped';
          log.add(
            tick,
            `m${message.id} dropped`,
            'At-most-once delivery does not redeliver after a crash, so this message is lost.',
            'bad',
          );
        }
      } else {
        applyEffect(tick, message);
        message.state = 'done';
        latencies.push(tick - message.enqueuedAt);
        if (message.id < maxCompletedId) inversions += 1;
        maxCompletedId = Math.max(maxCompletedId, message.id);
        worker.status = 'idle';
        worker.messageId = null;
        log.add(tick, `m${message.id} acknowledged`, `Visible result after ${tick - message.enqueuedAt} ticks in the system.`, 'ok');
      }
    }

    if (produced < messageCount && tick % 2 === 0) {
      produced += 1;
      const message: Message = {
        id: produced,
        enqueuedAt: tick,
        attempts: 0,
        effects: 0,
        state: 'queued',
      };
      messages.push(message);
      queue.push(message.id);
      log.add(tick, `m${message.id} enqueued`, 'The producer appended a new message.', 'info');
    }

    for (const worker of workers) {
      if (worker.status !== 'idle' || queue.length === 0) continue;
      const index = config.ordering === 'fifo' ? 0 : Math.floor(rng() * queue.length);
      const [id] = queue.splice(index, 1);
      const message = findMessage(id);
      message.state = 'inflight';
      message.attempts += 1;
      worker.status = 'busy';
      worker.messageId = id;
      worker.remaining = processingTicks;
      log.add(
        tick,
        `Worker ${worker.id} took m${id}`,
        message.attempts > 1
          ? `Redelivery attempt ${message.attempts}.`
          : config.ordering === 'fifo'
            ? 'Took the oldest message.'
            : 'Took an arbitrary queued message.',
        'info',
      );
    }

    const terminal = messages.filter((message) => message.state === 'done' || message.state === 'dropped').length;
    settled = produced === messageCount
      && queue.length === 0
      && workers.every((worker) => worker.status !== 'busy')
      && terminal === messageCount;
    frames.push(snapshot(tick, settled));
  }

  const metrics = frames[frames.length - 1]?.metrics ?? buildMetrics(0);
  const completed = metrics.find((item) => item.id === 'completed')?.value ?? 0;
  const dropped = metrics.find((item) => item.id === 'dropped')?.value ?? 0;
  return {
    labId: 'queue',
    config,
    events: log.events,
    metrics,
    frames,
    summary: `${integer(completed)} completed, ${integer(duplicateEffects)} duplicate side effects, ${integer(dropped)} dropped, ${integer(retries)} redeliveries.`,
  };
}
