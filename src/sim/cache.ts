import type { CacheConfig, DiagramNode, Frame, SimulationResult, Status } from '../model';
import { createLog, integer, lastCaption, metric } from './log';

interface Entry {
  value: number;
  version: number;
  expires: number;
}

const READ_TICKS = [2, 4, 6, 7, 9, 12, 13, 15, 20, 21, 24];
const WRITE_TICKS = [6, 18];
const LOST_UPDATE_TICK = 14;

export function simulateCache(config: CacheConfig): SimulationResult {
  const ttl = Math.max(1, Math.min(16, Math.round(config.ttl)));
  const log = createLog();
  const frames: Frame[] = [];

  let dbValue = 100;
  let dbVersion = 1;
  let cache: Entry | null = { value: dbValue, version: dbVersion, expires: ttl };
  let hits = 0;
  let misses = 0;
  let staleReads = 0;
  let writes = 0;
  let lostUpdates = 0;
  let exposureTicks = 0;
  let maxExposure = 0;
  let pendingLoss = config.concurrentWriters;
  let lastRead = 'No reads yet';
  let lastReadStatus: Status = 'idle';
  const maxTick = 34;

  const cacheBehind = () => cache !== null && cache.version < dbVersion;

  const rememberExposure = (writeTick: number) => {
    if (!cache || cache.version >= dbVersion) return;
    const window = Math.max(0, cache.expires - writeTick);
    maxExposure = Math.max(maxExposure, window);
  };

  const applyWrite = (tick: number, value: number, writer: string, detail: string) => {
    dbVersion += 1;
    dbValue = value;
    writes += 1;
    if (config.invalidation === 'write-through') {
      cache = { value: dbValue, version: dbVersion, expires: tick + ttl };
      log.add(tick, `${writer} wrote v${dbVersion}`, `${detail} The cache was updated in the same step.`, 'ok');
    } else if (config.invalidation === 'invalidate') {
      cache = null;
      log.add(tick, `${writer} wrote v${dbVersion}`, `${detail} The cache entry was deleted.`, 'ok');
    } else {
      rememberExposure(tick);
      log.add(
        tick,
        `${writer} wrote v${dbVersion}`,
        `${detail} The cache still holds the previous value until TTL expiry.`,
        'warn',
        'stale',
      );
    }
  };

  const buildMetrics = () => {
    const reads = hits + misses;
    const hitRate = reads ? (hits / reads) * 100 : 0;
    return [
      metric('hits', 'Cache hits', hits, integer(hits), 'neutral'),
      metric('misses', 'Cache misses', misses, integer(misses), 'neutral'),
      metric('hitRate', 'Hit rate', hitRate, reads ? `${Math.round(hitRate)}%` : '—', 'higher', 'Hits divided by all reads. Invalidation trades hits for freshness.'),
      metric('staleReads', 'Stale reads', staleReads, integer(staleReads), 'lower', 'Reads that returned an older version than the database.'),
      metric('writes', 'Writes', writes, integer(writes), 'neutral'),
      metric('lostUpdates', 'Lost updates', lostUpdates, integer(lostUpdates), 'lower', 'A writer committed over a newer value it had not read.'),
      metric(
        'maxExposure',
        'Longest stale window',
        maxExposure,
        `${integer(maxExposure)} ticks`,
        'lower',
        'How long a cached value can remain wrong after a write. TTL bounds this; it does not make the write visible immediately.',
      ),
      metric('exposureTicks', 'Ticks cache was stale', exposureTicks, integer(exposureTicks), 'lower'),
    ];
  };

  const snapshot = (tick: number, settled: boolean): Frame => {
    const cacheStatus: Status = cacheBehind() ? 'warn' : cache ? 'ok' : 'idle';
    const nodes: DiagramNode[] = [
      {
        id: 'clients',
        column: 0,
        title: 'Readers',
        subtitle: 'One key: price',
        status: lastReadStatus,
        statusText: lastReadStatus === 'warn' ? 'Stale read' : lastReadStatus === 'ok' ? 'Fresh read' : 'Waiting',
        note: lastRead,
      },
      {
        id: 'cache',
        column: 1,
        title: 'Cache',
        subtitle: config.invalidation === 'ttl'
          ? `TTL ${ttl} ticks`
          : config.invalidation === 'invalidate'
            ? 'Invalidate on write'
            : 'Write-through',
        status: cacheStatus,
        statusText: cache ? (cacheBehind() ? `Stale · v${cache.version}` : `Fresh · v${cache.version}`) : 'Empty',
        items: cache
          ? [{
            id: 'price',
            label: `price ${cache.value}`,
            status: cacheBehind() ? 'warn' : 'ok',
            title: `Cached v${cache.version}, expires at tick ${cache.expires}`,
          }]
          : [{ id: 'empty', label: 'miss', status: 'idle', title: 'Next read will load the database' }],
        meter: cache
          ? { value: Math.max(0, cache.expires - tick), max: ttl, label: 'TTL remaining' }
          : undefined,
        note: cacheBehind()
          ? 'This value is older than the database. A shorter TTL only limits how long that lasts.'
          : 'A hit is fresh only when the cached version matches the database.',
      },
      {
        id: 'db',
        column: 2,
        title: 'Database',
        subtitle: 'Source of the write',
        status: 'ok',
        statusText: `v${dbVersion}`,
        items: [{ id: 'db-price', label: `price ${dbValue}`, status: 'ok', title: `Committed version ${dbVersion}` }],
        note: config.concurrentWriters
          ? 'Two writers may each read the same version and overwrite one another.'
          : 'Writes are applied one at a time.',
      },
    ];
    return {
      tick,
      caption: settled
        ? `Run complete. ${staleReads} stale reads, longest stale window ${maxExposure} ticks.`
        : lastCaption(log.events, tick, 'Readers continue against the current cache entry.'),
      nodes,
      metrics: buildMetrics(),
    };
  };

  for (let tick = 0; tick <= maxTick; tick += 1) {
    if (cache && tick >= cache.expires) {
      log.add(tick, 'Cache entry expired', `price v${cache.version} passed its TTL and was evicted.`, 'info');
      cache = null;
    }

    if (WRITE_TICKS.includes(tick)) {
      const nextValue = dbValue + 30;
      applyWrite(tick, nextValue, 'Writer A', `Committed price ${nextValue}.`);
    }

    if (pendingLoss && tick === LOST_UPDATE_TICK) {
      pendingLoss = false;
      lostUpdates += 1;
      const staleValue = 110;
      applyWrite(
        tick,
        staleValue,
        'Writer B',
        `Committed price ${staleValue} from a read of v1, overwriting a newer price.`,
      );
      log.add(
        tick,
        'Lost update',
        'Writer B never saw Writer A’s price. Cache invalidation does not solve this race; version checks would.',
        'bad',
      );
    }

    if (READ_TICKS.includes(tick)) {
      if (cache && cache.version < dbVersion) {
        hits += 1;
        staleReads += 1;
        lastRead = `Hit price ${cache.value} (v${cache.version}) while the database is v${dbVersion}.`;
        lastReadStatus = 'warn';
        log.add(tick, 'Stale read', lastRead, 'warn', 'stale');
      } else if (cache) {
        hits += 1;
        lastRead = `Hit price ${cache.value} (v${cache.version}), matching the database.`;
        lastReadStatus = 'ok';
        log.add(tick, 'Fresh hit', lastRead, 'ok');
      } else {
        misses += 1;
        cache = { value: dbValue, version: dbVersion, expires: tick + ttl };
        lastRead = `Miss. Loaded price ${dbValue} (v${dbVersion}) into the cache.`;
        lastReadStatus = 'ok';
        log.add(tick, 'Cache miss', lastRead, 'info');
      }
    }

    if (cacheBehind()) exposureTicks += 1;

    const settled = tick === maxTick;
    frames.push(snapshot(tick, settled));
  }

  const metrics = frames[frames.length - 1].metrics;
  return {
    labId: 'cache',
    config,
    events: log.events,
    metrics,
    frames,
    summary: `${staleReads} stale reads, ${lostUpdates} lost updates, longest stale window ${maxExposure} ticks.`,
  };
}
