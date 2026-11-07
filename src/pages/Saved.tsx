import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, usePageTitle } from '../components/ui';
import { getLab } from '../content';
import type { LabConfig } from '../model';
import { deleteRun, deleteScenario, useStore } from '../storage';

export function Saved() {
  const store = useStore();
  usePageTitle('Saved · Distributed Systems Playground');
  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">On this device</p>
        <h1>Saved configurations and runs.</h1>
        <p className="lede">
          Nothing is uploaded. Clearing site data for this origin removes the library progress, scenarios, and runs.
        </p>
      </header>
      <section className="panel">
        <div className="panel-head"><h2>Runs</h2></div>
        {store.runs.length === 0 ? (
          <EmptyState
            title="No runs yet."
            body="Finish a playback, or press Save run inside a lab. Two runs from the same lab can be compared."
            action={<Link className="button primary" to="/labs">Find a lab</Link>}
          />
        ) : (
          <ul className="saved-list">
            {store.runs.map((run) => (
              <SavedRow
                key={run.id}
                title={run.name}
                meta={`${getLab(run.labId)?.title ?? run.labId} · ${formatWhen(run.createdAt)}`}
                body={run.summary}
                href={`/labs/${run.labId}`}
                config={run.config}
                onDelete={() => deleteRun(run.id)}
              />
            ))}
          </ul>
        )}
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Configurations</h2></div>
        {store.scenarios.length === 0 ? (
          <EmptyState
            title="No configurations yet."
            body="Save configuration keeps the settings without treating them as a finished run."
            action={<Link className="button ghost" to="/labs/queue">Open queue processing</Link>}
          />
        ) : (
          <ul className="saved-list">
            {store.scenarios.map((scenario) => (
              <SavedRow
                key={scenario.id}
                title={scenario.name}
                meta={`${getLab(scenario.labId)?.title ?? scenario.labId} · ${formatWhen(scenario.createdAt)}`}
                href={`/labs/${scenario.labId}`}
                config={scenario.config}
                onDelete={() => deleteScenario(scenario.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SavedRow({
  title,
  meta,
  body,
  href,
  config,
  onDelete,
}: {
  title: string;
  meta: string;
  body?: string;
  href: string;
  config: LabConfig;
  onDelete: () => void;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <li className="saved-row">
      <div>
        <h3>{title}</h3>
        <p className="fine">{meta}</p>
        {body && <p>{body}</p>}
      </div>
      <div className="card-actions">
        <Link className="button ghost" to={href} state={{ config }}>Open</Link>
        {armed ? (
          <>
            <button type="button" className="button danger" onClick={onDelete}>Delete</button>
            <button type="button" className="text-button" onClick={() => setArmed(false)}>Keep</button>
          </>
        ) : (
          <button type="button" className="text-button" onClick={() => setArmed(true)}>Delete</button>
        )}
      </div>
    </li>
  );
}

function formatWhen(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
