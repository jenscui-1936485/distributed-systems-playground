import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ChartPoint, DiagramNode, Metric, SimEvent, Status } from '../model';

const STATUS_LABEL: Record<Status, string> = {
  idle: 'Idle',
  active: 'Active',
  ok: 'Success',
  warn: 'Warning',
  bad: 'Failure',
  off: 'Off',
};

export function StatusPill({ status, text }: { status: Status; text: string }) {
  return (
    <span className={`pill status-${status}`}>
      <i className={`dot ${status}`} aria-hidden="true" />
      <span className="sr-only">{STATUS_LABEL[status]}: </span>
      {text}
    </span>
  );
}

export function HelpTip({ text }: { text: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className={`tip${open ? ' open' : ''}`}>
      <button
        type="button"
        className="tip-btn"
        aria-expanded={open}
        aria-describedby={id}
        aria-label="About this setting"
        onClick={() => setOpen((value) => !value)}
      >
        ?
      </button>
      <span role="tooltip" id={id} className="tip-bubble">{text}</span>
    </span>
  );
}

export function MetricGrid({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="metric-grid">
      {metrics.map((item) => (
        <article key={item.id} className="metric" title={item.hint}>
          <p className="metric-label">{item.label}</p>
          <p className="metric-value">{item.display}</p>
          {item.hint && <p className="metric-hint">{item.hint}</p>}
        </article>
      ))}
    </div>
  );
}

export function Timeline({ events }: { events: SimEvent[] }) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [events.length]);
  return (
    <ol ref={listRef} className="timeline" aria-label="Event timeline">
      {events.length === 0 && (
        <li className="event status-info">
          <span className="tick">—</span>
          <div>
            <strong>No events yet</strong>
            <p>Press play. The log fills as the clock advances, and the same settings always produce this log.</p>
          </div>
        </li>
      )}
      {events.map((event) => (
        <li key={event.id} className={`event status-${event.status}`}>
          <span className="tick">t{event.tick}</span>
          <div>
            <strong>{event.title}</strong>
            <p>{event.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Chart({ points }: { points: ChartPoint[] }) {
  const buckets: { label: string; accepted: number; rejected: number }[] = [];
  for (let index = 0; index < points.length; index += 2) {
    const slice = points.slice(index, index + 2);
    buckets.push({
      label: slice[0]?.label ?? '',
      accepted: slice.reduce((sum, point) => sum + point.accepted, 0),
      rejected: slice.reduce((sum, point) => sum + point.rejected, 0),
    });
  }
  const max = Math.max(1, ...buckets.map((bucket) => bucket.accepted + bucket.rejected));
  const accepted = points.reduce((sum, point) => sum + point.accepted, 0);
  const rejected = points.reduce((sum, point) => sum + point.rejected, 0);
  return (
    <figure className="chart-wrap">
      <figcaption>
        Accepted {accepted} · Rejected {rejected}
        <span className="chart-note"> Each bar is two ticks. Green is accepted, coral is rejected.</span>
      </figcaption>
      {accepted + rejected === 0 ? (
        <p className="chart-empty">Requests appear as the clock advances.</p>
      ) : (
        <div className="chart" role="img" aria-label={`Accepted ${accepted}, rejected ${rejected}`}>
          {buckets.map((bucket) => (
            <div key={bucket.label} className="chart-col" title={`t${bucket.label}: ${bucket.accepted} accepted, ${bucket.rejected} rejected`}>
              <div className="chart-stack">
                <span className="bar reject" style={{ height: `${(bucket.rejected / max) * 100}%` }} />
                <span className="bar accept" style={{ height: `${(bucket.accepted / max) * 100}%` }} />
              </div>
              <span className="chart-label">{bucket.label}</span>
            </div>
          ))}
        </div>
      )}
    </figure>
  );
}

export function NodeCard({ node }: { node: DiagramNode }) {
  const meterWidth = node.meter
    ? Math.max(0, Math.min(100, (node.meter.value / Math.max(1, node.meter.max)) * 100))
    : 0;
  return (
    <article className={`node status-${node.status}`}>
      <header className="node-head">
        <h3>{node.title}</h3>
        <StatusPill status={node.status} text={node.statusText} />
      </header>
      {node.subtitle && <p className="node-sub">{node.subtitle}</p>}
      {node.meter && (
        <div
          className="meter"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={node.meter.max}
          aria-valuenow={Number(node.meter.value.toFixed(2))}
          aria-label={node.meter.label}
        >
          <span className="meter-label">{node.meter.label}</span>
          <span className="meter-track"><span className="meter-fill" style={{ width: `${meterWidth}%` }} /></span>
        </div>
      )}
      {node.items && node.items.length > 0 && (
        <ul className="chips">
          {node.items.map((item) => (
            <li key={item.id} className={`chip status-${item.status}`} title={item.title}>
              <i className={`dot ${item.status}`} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      )}
      {node.note && <p className="node-note">{node.note}</p>}
    </article>
  );
}

export function Diagram({ nodes }: { nodes: DiagramNode[] }) {
  const columns: DiagramNode[][] = [];
  nodes.forEach((node) => {
    columns[node.column] ??= [];
    columns[node.column].push(node);
  });
  const compact = columns.filter((column) => column.length > 0);
  return (
    <div className="diagram">
      <div className="flow">
        {compact.map((column, index) => (
          <Fragment key={column[0]?.id ?? index}>
            {index > 0 && <div className="flow-arrow" aria-hidden="true">→</div>}
            <div className="flow-col">
              {column.map((node) => <NodeCard key={node.id} node={node} />)}
            </div>
          </Fragment>
        ))}
      </div>
      <ul className="legend" aria-label="Status legend">
        <li><i className="dot active" aria-hidden="true" /> Active</li>
        <li><i className="dot ok" aria-hidden="true" /> Success</li>
        <li><i className="dot warn" aria-hidden="true" /> Warning</li>
        <li><i className="dot bad" aria-hidden="true" /> Failure</li>
        <li><i className="dot idle" aria-hidden="true" /> Idle</li>
      </ul>
    </div>
  );
}

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </div>
  );
}
