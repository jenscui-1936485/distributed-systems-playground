import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState, usePageTitle } from '../components/ui';
import { describeConfig, getLab, labs, withDefaults } from '../content';
import type { LabId, Metric } from '../model';
import { simulate } from '../sim/run';
import { useStore } from '../storage';

export function Compare() {
  const store = useStore();
  const [params, setParams] = useSearchParams();
  const initialLab = (params.get('lab') as LabId | null) ?? store.runs[0]?.labId ?? 'queue';
  const [labId, setLabId] = useState<LabId>(getLab(initialLab)?.id ?? 'queue');
  const runs = store.runs.filter((run) => run.labId === labId);
  const [leftId, setLeftId] = useState(params.get('a') ?? runs[0]?.id ?? '');
  const [rightId, setRightId] = useState(params.get('b') ?? runs[1]?.id ?? '');
  usePageTitle('Compare · Distributed Systems Playground');

  const left = runs.find((run) => run.id === leftId) ?? runs[0] ?? null;
  const right = runs.find((run) => run.id === rightId) ?? runs.find((run) => run.id !== left?.id) ?? null;
  const lab = getLab(labId);

  const compared = useMemo(() => {
    if (!left || !right) return null;
    return {
      a: simulate(withDefaults(left.config)),
      b: simulate(withDefaults(right.config)),
    };
  }, [left, right]);

  const chooseLab = (next: LabId) => {
    setLabId(next);
    const matching = store.runs.filter((run) => run.labId === next);
    setLeftId(matching[0]?.id ?? '');
    setRightId(matching[1]?.id ?? '');
    setParams({ lab: next }, { replace: true });
  };

  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">Comparison</p>
        <h1>Two configurations, one outcome table.</h1>
        <p className="lede">
          Save a run from any lab, then put it next to another. The change column is run B minus run A.
          Green means B is better for that metric.
        </p>
      </header>

      <div className="filters" role="group" aria-label="Choose a lab">
        {labs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`speed${labId === item.id ? ' on' : ''}`}
            aria-pressed={labId === item.id}
            onClick={() => chooseLab(item.id)}
          >
            {item.title}
          </button>
        ))}
      </div>

      {runs.length < 2 || !lab ? (
        <EmptyState
          title="Save two runs of the same lab."
          body="The comparison replays each saved configuration. Play a lab, save the run, change a setting, and save again."
          action={<Link className="button primary" to={`/labs/${labId}`}>Open {lab?.title ?? 'a lab'}</Link>}
        />
      ) : (
        <>
          <div className="compare-picks">
            <label>
              Run A
              <select value={left?.id ?? ''} onChange={(event) => setLeftId(event.target.value)} aria-label="Run A">
                {runs.map((run) => <option key={run.id} value={run.id}>{run.name}</option>)}
              </select>
            </label>
            <label>
              Run B
              <select value={right?.id ?? ''} onChange={(event) => setRightId(event.target.value)} aria-label="Run B">
                {runs.map((run) => <option key={run.id} value={run.id}>{run.name}</option>)}
              </select>
            </label>
          </div>
          {left && right && left.id === right.id && (
            <p className="notice">Both sides are the same run. Choose a second configuration to see a difference.</p>
          )}
          {compared && (
            <>
              <section className="panel">
                <div className="panel-head"><h2>Settings</h2></div>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th scope="col">Setting</th>
                        <th scope="col">Run A</th>
                        <th scope="col">Run B</th>
                      </tr>
                    </thead>
                    <tbody>
                      {describeConfig(compared.a.config).map((row, index) => {
                        const other = describeConfig(compared.b.config)[index];
                        const changed = row.value !== other?.value;
                        return (
                          <tr key={row.key} className={changed ? 'changed' : undefined}>
                            <th scope="row">{row.label}</th>
                            <td>{row.value}</td>
                            <td>{other?.value}{changed && <span className="changed-tag">Changed</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="panel">
                <div className="panel-head"><h2>Outcomes</h2></div>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th scope="col">Metric</th>
                        <th scope="col">Run A</th>
                        <th scope="col">Run B</th>
                        <th scope="col">B − A</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compared.a.metrics.map((metric) => {
                        const other = compared.b.metrics.find((item) => item.id === metric.id);
                        return (
                          <tr key={metric.id}>
                            <th scope="row">
                              {metric.label}
                              {metric.hint && <span className="cell-hint">{metric.hint}</span>}
                            </th>
                            <td>{metric.display}</td>
                            <td>{other?.display ?? '—'}</td>
                            <td><Delta metric={metric} other={other?.value ?? metric.value} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="fine summaries">{compared.a.summary}</p>
                <p className="fine summaries">{compared.b.summary}</p>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Delta({ metric, other }: { metric: Metric; other: number }) {
  const delta = other - metric.value;
  if (!Number.isFinite(delta)) return <span className="delta flat">—</span>;
  const rounded = Math.round(delta * 10) / 10;
  if (rounded === 0 || metric.better === 'neutral') {
    return <span className="delta flat">{rounded > 0 ? `+${rounded}` : rounded}</span>;
  }
  const improved = metric.better === 'higher' ? rounded > 0 : rounded < 0;
  return <span className={`delta ${improved ? 'good' : 'bad'}`}>{rounded > 0 ? `+${rounded}` : rounded}</span>;
}
