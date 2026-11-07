import type { Metric, SimEvent } from '../model';

export function createLog() {
  const events: SimEvent[] = [];
  let n = 0;
  return {
    events,
    add(
      tick: number,
      title: string,
      detail: string,
      status: SimEvent['status'],
      tag?: SimEvent['tag'],
    ) {
      events.push({ id: `e${n++}`, tick, title, detail, status, tag });
    },
  };
}

export function metric(
  id: string,
  label: string,
  value: number,
  display: string,
  better: Metric['better'],
  hint?: string,
): Metric {
  return { id, label, value, display, better, hint };
}

export function integer(value: number): string {
  return String(Math.round(value));
}

export function decimal(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

export function lastCaption(events: SimEvent[], tick: number, fallback: string): string {
  const sameTick = events.filter((event) => event.tick === tick);
  if (sameTick.length === 0) return fallback;
  const rank: Record<SimEvent['status'], number> = { bad: 0, warn: 1, ok: 2, info: 3 };
  const lead = [...sameTick].sort((a, b) => rank[a.status] - rank[b.status])[0];
  return `${lead.title}. ${lead.detail}`;
}
