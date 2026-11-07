import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ConfigForm } from '../components/ConfigForm';
import { Playback, usePlayback } from '../components/Playback';
import { Chart, Diagram, EmptyState, MetricGrid, Timeline, usePageTitle } from '../components/ui';
import {
  patchConfig,
  readSetting,
  suggestedName,
  withDefaults,
  type LabMeta,
} from '../content';
import { getLab } from '../content';
import type { LabConfig, SimEvent } from '../model';
import { simulate } from '../sim/run';
import { markChallenge, markExplored, saveRun, saveScenario, useStore } from '../storage';

const KEY_TAGS: SimEvent['tag'][] = ['crash', 'duplicate', 'stale', 'open', 'suppress', 'reject'];

export function Workspace({ mode }: { mode: 'lab' | 'challenge' }) {
  const { labId } = useParams();
  const lab = getLab(labId);
  if (!lab) {
    return (
      <EmptyState
        title="That lab is not in the library."
        body="The playground has five labs: queues, caches, rate limits, resilience, and consistency."
        action={<Link className="button primary" to="/labs">Browse labs</Link>}
      />
    );
  }
  return <LabSession key={`${lab.id}:${mode}`} lab={lab} mode={mode} />;
}

function LabSession({ lab, mode }: { lab: LabMeta; mode: 'lab' | 'challenge' }) {
  const location = useLocation();
  const store = useStore();
  const incoming = (location.state as { config?: LabConfig } | null)?.config;
  const [config, setConfig] = useState<LabConfig>(() => initialConfig(lab, mode, incoming));
  const [name, setName] = useState(() => suggestedName(initialConfig(lab, mode, incoming)));
  const [nameDirty, setNameDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const [checked, setChecked] = useState(false);

  const result = useMemo(() => simulate(config), [config]);
  const playback = usePlayback(result.frames.length, JSON.stringify(config));
  const frame = result.frames[playback.index] ?? result.frames[0];
  const events = result.events.filter((event) => event.tick <= frame.tick);
  const chart = result.chart?.filter((point) => point.tick <= frame.tick);
  const verdict = checked ? lab.evaluate(result) : null;
  const recent = store.runs.filter((run) => run.labId === lab.id).slice(0, 3);
  const keyFrame = keyMoment(result.events);

  usePageTitle(`${mode === 'challenge' ? 'Challenge · ' : ''}${lab.title} · Distributed Systems Playground`);

  useEffect(() => {
    if (!nameDirty) setName(suggestedName(config));
  }, [config, nameDirty]);

  useEffect(() => {
    if (playback.index > 0 && playback.index >= result.frames.length - 1) markExplored(lab.id);
  }, [playback.index, result.frames.length, lab.id]);

  useEffect(() => {
    if (verdict?.pass) markChallenge(lab.id);
  }, [verdict, lab.id]);

  const lockedKeys = mode === 'challenge' ? lab.challenge.lockedKeys : [];

  const change = (key: string, value: string | number | boolean) => {
    if (lockedKeys.includes(key)) return;
    setConfig((current) => patchConfig(current, key, value));
    setNotice('');
  };

  const applySaved = (next: LabConfig) => {
    if (next.labId !== lab.id) return;
    setConfig(mode === 'challenge' ? lockConfig(lab, next) : withDefaults(next));
    setNameDirty(false);
    setNotice('Loaded configuration.');
  };

  return (
    <div className="page workspace">
      <header className="lab-head">
        <div>
          <p className="eyebrow">{lab.kicker} · {lab.difficulty}{mode === 'challenge' ? ' · Challenge' : ''}</p>
          <h1>{mode === 'challenge' ? lab.challenge.title : lab.title}</h1>
          <p className="lede">{mode === 'challenge' ? lab.challenge.story : lab.summary}</p>
          <ul className="concept-list">
            {lab.concepts.map((concept) => <li key={concept}>{concept}</li>)}
          </ul>
        </div>
        <div className="lab-head-actions">
          {mode === 'challenge' ? (
            <Link className="button ghost" to={`/labs/${lab.id}`}>Free play</Link>
          ) : (
            <Link className="button primary" to={`/labs/${lab.id}/challenge`}>Guided challenge</Link>
          )}
          <Link className="button ghost" to="/compare">Compare runs</Link>
        </div>
      </header>

      {mode === 'challenge' && (
        <section className={`challenge-banner${verdict ? (verdict.pass ? ' pass' : ' fail') : ''}`}>
          <div>
            <h2>Goal</h2>
            <p>{lab.challenge.goal}</p>
            <p className="fine">Check runs the full simulation, including frames you have not played yet.</p>
          </div>
          <button type="button" className="button primary" onClick={() => setChecked(true)}>
            Check outcome
          </button>
          {verdict && <p className="verdict" role="status">{verdict.pass ? 'Passed. ' : 'Not yet. '}{verdict.message}</p>}
        </section>
      )}

      <div className="workspace-grid">
        <section className="panel stage" aria-label="System diagram">
          <div className="panel-head">
            <h2>System</h2>
            {keyFrame !== null && (
              <button
                type="button"
                className="button ghost"
                onClick={() => {
                  playback.setPlaying(false);
                  const index = result.frames.findIndex((item) => item.tick === keyFrame);
                  playback.setIndex(index < 0 ? 0 : index);
                }}
              >
                Jump to key moment
              </button>
            )}
          </div>
          {frame && <Diagram nodes={frame.nodes} />}
          {chart && <Chart points={chart} />}
          <p className="caption" aria-live="off">{frame?.caption}</p>
        </section>

        <aside className="panel controls">
          <div className="panel-head">
            <h2>Settings</h2>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setConfig(mode === 'challenge' ? lab.challenge.start : lab.defaults);
                setNameDirty(false);
                setNotice('Settings restored.');
              }}
            >
              Reset settings
            </button>
          </div>
          <ConfigForm
            lab={lab}
            config={config}
            lockedKeys={lockedKeys}
            onChange={change}
            onShuffleSeed={() => change('seed', 1 + Math.floor(Math.random() * 9999))}
          />
          <div className="save-box">
            <label className="field">
              <span className="field-label">Name</span>
              <input
                type="text"
                value={name}
                maxLength={80}
                onChange={(event) => {
                  setNameDirty(true);
                  setName(event.target.value);
                }}
              />
            </label>
            <div className="card-actions">
              <button
                type="button"
                className="button ghost"
                onClick={() => {
                  saveScenario({ labId: lab.id, name, config });
                  setNotice('Configuration saved on this device.');
                }}
              >
                Save configuration
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  saveRun({ labId: lab.id, name, config, summary: result.summary });
                  setNotice('Run saved. Open Compare to set it beside another.');
                }}
              >
                Save run
              </button>
            </div>
            {notice && <p className="notice" role="status">{notice}</p>}
          </div>
          {recent.length > 0 && (
            <div className="recent">
              <h3>Recent runs</h3>
              <ul>
                {recent.map((run) => (
                  <li key={run.id}>
                    <button type="button" className="text-button" onClick={() => applySaved(run.config)}>
                      {run.name}
                    </button>
                    <span>{run.summary}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      <Playback
        index={playback.index}
        length={result.frames.length}
        tick={frame?.tick ?? 0}
        playing={playback.playing}
        speed={playback.speed}
        onPlay={playback.setPlaying}
        onIndex={playback.setIndex}
        onSpeed={playback.setSpeed}
      />

      <div className="workspace-bottom">
        <section className="panel">
          <div className="panel-head">
            <h2>Metrics so far</h2>
          </div>
          {frame && <MetricGrid metrics={frame.metrics} />}
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Event timeline</h2>
            <span className="fine">{events.length} events</span>
          </div>
          <Timeline events={events} />
        </section>
      </div>

      <details className="assumptions">
        <summary>Model assumptions</summary>
        <ul>
          {lab.assumptions.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p>Same configuration and seed always produce the same events. These are teaching models, not production infrastructure.</p>
      </details>
    </div>
  );
}

function initialConfig(lab: LabMeta, mode: 'lab' | 'challenge', incoming?: LabConfig): LabConfig {
  if (mode === 'challenge') return lab.challenge.start;
  if (incoming && incoming.labId === lab.id) return withDefaults(incoming);
  return lab.defaults;
}

function lockConfig(lab: LabMeta, config: LabConfig): LabConfig {
  let next = withDefaults({ ...config, labId: lab.id } as LabConfig);
  for (const key of lab.challenge.lockedKeys) {
    next = patchConfig(next, key, readSetting(lab.challenge.start, key));
  }
  return next;
}

function keyMoment(events: SimEvent[]): number | null {
  for (const tag of KEY_TAGS) {
    const found = events.find((event) => event.tag === tag);
    if (found) return found.tick;
  }
  return null;
}
