import type { ConsistencyConfig, DiagramNode, Frame, SimulationResult, Status } from '../model';
import { createLog, decimal, integer, lastCaption, metric } from './log';

type ClientId = 'A' | 'B';

interface ScriptOp {
  t: number;
  client: ClientId;
  op: 'read' | 'write';
  value?: string;
}

interface Replica {
  id: number;
  version: number;
  value: string;
  pending: { at: number; version: number; value: string }[];
}

interface Inflight {
  op: 'read';
  until: number;
  target: string;
  latency: number;
}

const SCRIPT: ScriptOp[] = [
  { t: 1, client: 'A', op: 'write', value: 'alpha' },
  { t: 2, client: 'A', op: 'read' },
  { t: 6, client: 'B', op: 'read' },
  { t: 10, client: 'A', op: 'write', value: 'gamma' },
  { t: 11, client: 'A', op: 'read' },
  { t: 16, client: 'B', op: 'write', value: 'beta' },
  { t: 17, client: 'B', op: 'read' },
  { t: 22, client: 'A', op: 'read' },
  { t: 26, client: 'B', op: 'read' },
  { t: 30, client: 'A', op: 'read' },
];

export function simulateConsistency(config: ConsistencyConfig): SimulationResult {
  const replicaCount = Math.max(1, Math.min(3, Math.round(config.replicas)));
  const lag = Math.max(0, Math.min(12, Math.round(config.lag)));
  const readTimeout = Math.max(1, Math.min(10, Math.round(config.readTimeout)));
  const log = createLog();
  const frames: Frame[] = [];
  const primaryLag = 3;

  let version = 0;
  let value = 'empty';
  const replicas: Replica[] = Array.from({ length: replicaCount }, (_, index) => ({
    id: index + 1,
    version: 0,
    value: 'empty',
    pending: [],
  }));

  const clients: Record<ClientId, {
    lastWrite: number;
    seen: number;
    note: string;
    status: Status;
    inflight: Inflight | null;
  }> = {
    A: { lastWrite: 0, seen: 0, note: 'Idle', status: 'idle', inflight: null },
    B: { lastWrite: 0, seen: 0, note: 'Idle', status: 'idle', inflight: null },
  };

  const pending: ScriptOp[] = [...SCRIPT];
  let reads = 0;
  let freshReads = 0;
  let staleReads = 0;
  let ownWriteStale = 0;
  let unavailable = 0;
  let writes = 0;
  const latencies: number[] = [];
  const maxTick = 40;
  let rotation = Math.max(1, Math.round(config.seed)) % replicaCount;

  const pickReplica = () => {
    const replica = replicas[rotation % replicaCount];
    rotation += 1;
    return replica;
  };

  const scheduleReplication = (tick: number) => {
    replicas.forEach((replica, index) => {
      replica.pending.push({
        at: tick + lag + index,
        version,
        value,
      });
    });
    log.add(
      tick,
      `Write v${version} committed`,
      `Primary has "${value}". Replicas apply it after ${lag} ticks, plus one extra tick per later replica.`,
      'info',
      'lag',
    );
  };

  const planRead = (client: ClientId): { target: string; latency: number; replica?: Replica } | 'unavailable' => {
    const session = clients[client];
    const replica = pickReplica();
    if (config.mode === 'strong') {
      if (primaryLag > readTimeout) return 'unavailable';
      return { target: 'primary', latency: primaryLag };
    }
    if (config.mode === 'read-your-writes') {
      if (session.lastWrite > 0 && replica.version < session.lastWrite) {
        if (primaryLag > readTimeout) return 'unavailable';
        return { target: 'primary', latency: primaryLag, replica };
      }
      return { target: `replica ${replica.id}`, latency: 1, replica };
    }
    if (config.mode === 'monotonic') {
      if (session.seen > 0 && replica.version < session.seen) {
        if (primaryLag > readTimeout) return 'unavailable';
        return { target: 'primary', latency: primaryLag, replica };
      }
      return { target: `replica ${replica.id}`, latency: 1, replica };
    }
    return { target: `replica ${replica.id}`, latency: 1, replica };
  };

  const buildMetrics = () => {
    const completed = freshReads + staleReads;
    const avg = latencies.length ? latencies.reduce((sum, item) => sum + item, 0) / latencies.length : 0;
    const availability = reads ? ((reads - unavailable) / reads) * 100 : 0;
    return [
      metric('writes', 'Writes', writes, integer(writes), 'neutral'),
      metric('freshReads', 'Fresh reads', freshReads, integer(freshReads), 'higher', 'Returned the primary’s current version.'),
      metric('staleReads', 'Stale reads', staleReads, integer(staleReads), 'lower', 'Returned a version older than the primary.'),
      metric('ownWriteStale', 'Missed own writes', ownWriteStale, integer(ownWriteStale), 'lower', 'A client read a version older than a write it had already committed.'),
      metric('unavailable', 'Unavailable reads', unavailable, integer(unavailable), 'lower', 'The chosen guarantee could not answer inside the read timeout.'),
      metric('availability', 'Availability', availability, reads ? `${Math.round(availability)}%` : '—', 'higher'),
      metric('avgReadLatency', 'Avg read latency', avg, completed ? `${decimal(avg)} ticks` : '—', 'lower'),
      metric('completedReads', 'Completed reads', completed, integer(completed), 'neutral'),
    ];
  };

  const snapshot = (tick: number, settled: boolean): Frame => {
    const clientNodes: DiagramNode[] = (['A', 'B'] as ClientId[]).map((id) => ({
      id: `client-${id}`,
      column: 0,
      title: `Client ${id}`,
      subtitle: clients[id].lastWrite ? `Last write v${clients[id].lastWrite}` : 'No writes yet',
      status: clients[id].status,
      statusText: clients[id].inflight ? 'Reading' : 'Idle',
      note: clients[id].note,
      items: clients[id].seen
        ? [{ id: `seen-${id}`, label: `seen v${clients[id].seen}`, status: 'idle' as Status, title: 'Newest version this client has read' }]
        : [],
    }));

    const nodes: DiagramNode[] = [
      ...clientNodes,
      {
        id: 'primary',
        column: 1,
        title: 'Primary',
        subtitle: 'Commits first',
        status: 'ok',
        statusText: `v${version}`,
        items: [{ id: 'primary-value', label: value, status: 'ok', title: 'Latest committed value' }],
        note: 'Reads that need a stronger guarantee come here and take longer.',
      },
      ...replicas.map((replica) => {
        const behind = version - replica.version;
        const status: Status = behind === 0 ? 'ok' : 'warn';
        return {
          id: `replica-${replica.id}`,
          column: 2,
          title: `Replica ${replica.id}`,
          subtitle: `Applies after ${lag + replica.id - 1} ticks`,
          status,
          statusText: behind === 0 ? 'Caught up' : `${behind} behind`,
          items: [{ id: `rv-${replica.id}`, label: `${replica.value} · v${replica.version}`, status, title: 'Visible value on this replica' }],
          note: behind === 0 ? 'Matches the primary.' : 'A read here can be stale.',
        };
      }),
    ];

    return {
      tick,
      caption: settled
        ? `Run complete. ${staleReads} stale reads, ${ownWriteStale} missed own writes, ${unavailable} unavailable.`
        : lastCaption(log.events, tick, 'Replicas are catching up on their own clocks.'),
      nodes,
      metrics: buildMetrics(),
    };
  };

  for (let tick = 0; tick <= maxTick; tick += 1) {
    for (const replica of replicas) {
      const due = replica.pending.filter((item) => item.at <= tick);
      replica.pending = replica.pending.filter((item) => item.at > tick);
      for (const item of due) {
        if (item.version >= replica.version) {
          replica.version = item.version;
          replica.value = item.value;
          log.add(tick, `Replica ${replica.id} applied v${item.version}`, `Now serving "${item.value}".`, 'ok', 'lag');
        }
      }
    }

    (['A', 'B'] as ClientId[]).forEach((id) => {
      const session = clients[id];
      const inflight = session.inflight;
      if (!inflight || inflight.until !== tick) return;
      session.inflight = null;
      const replicaVersion = inflight.target.startsWith('replica')
        ? replicas.find((replica) => inflight.target.endsWith(String(replica.id)))?.version ?? 0
        : version;
      const returned = inflight.target === 'primary' ? version : replicaVersion;
      const returnedValue = inflight.target === 'primary'
        ? value
        : replicas.find((replica) => inflight.target.endsWith(String(replica.id)))?.value ?? 'empty';
      reads += 1;
      latencies.push(inflight.latency);
      session.seen = Math.max(session.seen, returned);
      const stale = returned < version;
      const missedOwn = returned < session.lastWrite;
      if (stale) staleReads += 1;
      else freshReads += 1;
      if (missedOwn) ownWriteStale += 1;
      session.status = missedOwn || stale ? 'warn' : 'ok';
      session.note = `Read "${returnedValue}" v${returned} from ${inflight.target}${stale ? ' · stale' : ''}${missedOwn ? ' · missed own write' : ''}.`;
      log.add(
        tick,
        `Client ${id} read v${returned}`,
        session.note,
        missedOwn || stale ? 'warn' : 'ok',
        missedOwn || stale ? 'stale' : undefined,
      );
    });

    for (let index = 0; index < pending.length; index += 1) {
      const op = pending[index];
      if (op.t > tick) continue;
      const session = clients[op.client];
      if (session.inflight) continue;
      pending.splice(index, 1);
      index -= 1;
      if (op.op === 'write' && op.value) {
        version += 1;
        value = op.value;
        writes += 1;
        session.lastWrite = version;
        session.status = 'ok';
        session.note = `Wrote "${op.value}" as v${version}.`;
        scheduleReplication(tick);
        continue;
      }
      const plan = planRead(op.client);
      if (plan === 'unavailable') {
        reads += 1;
        unavailable += 1;
        session.status = 'bad';
        session.note = `Read refused. ${config.mode} could not answer within ${readTimeout} ticks.`;
        log.add(tick, `Client ${op.client} read unavailable`, session.note, 'bad');
        continue;
      }
      if (plan.replica && config.mode === 'read-your-writes' && plan.target === 'primary') {
        log.add(
          tick,
          `Client ${op.client} read routed to primary`,
          `Replica ${plan.replica.id} is behind this client's write v${session.lastWrite}.`,
          'info',
        );
      }
      if (plan.replica && config.mode === 'monotonic' && plan.target === 'primary') {
        log.add(
          tick,
          `Client ${op.client} avoided a stale replica`,
          `Replica ${plan.replica.id} is behind a version this client already read.`,
          'info',
        );
      }
      session.inflight = { op: 'read', until: tick + plan.latency, target: plan.target, latency: plan.latency };
      session.status = 'active';
      session.note = `Reading from ${plan.target}, due at tick ${tick + plan.latency}.`;
      log.add(tick, `Client ${op.client} started a read`, session.note, 'info');
    }

    frames.push(snapshot(tick, tick === maxTick));
  }

  const metrics = frames[frames.length - 1].metrics;
  return {
    labId: 'consistency',
    config,
    events: log.events,
    metrics,
    frames,
    summary: `${staleReads} stale reads, ${ownWriteStale} missed own writes, ${unavailable} unavailable, mode ${config.mode}.`,
  };
}
