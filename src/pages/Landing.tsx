import { Link } from 'react-router-dom';
import { LabCard } from '../components/LabCard';
import { usePageTitle } from '../components/ui';
import { labs } from '../content';
import { useStore } from '../storage';

export function Landing() {
  const store = useStore();
  usePageTitle('Distributed Systems Playground');
  return (
    <div className="page landing">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Five labs · deterministic · stays in the browser</p>
          <h1>See the tradeoff, not just the definition.</h1>
          <p className="lede">
            Queue crashes, stale caches, window boundaries, retry storms, and replica lag.
            Change one setting, replay the same run, and point at the event that explains the guarantee.
          </p>
          <div className="hero-actions">
            <Link className="button primary" to="/labs">Browse the labs</Link>
            <Link className="button ghost" to="/labs/queue">Start with queues</Link>
          </div>
        </div>
        <div className="hero-panel" aria-hidden="true">
          <div className="schematic">
            <div className="sch-node">Producer</div>
            <div className="sch-wire"><span className="sch-dot" /></div>
            <div className="sch-node accent">Queue</div>
            <div className="sch-wire"><span className="sch-dot delay" /></div>
            <div className="sch-stack">
              <div className="sch-node">Worker A</div>
              <div className="sch-node warn">Worker B crashed</div>
            </div>
          </div>
          <ol className="hero-log">
            <li><span>t4</span> m3 side effect applied</li>
            <li className="warn"><span>t4</span> crashed before ack</li>
            <li className="bad"><span>t9</span> m3 charged again</li>
            <li className="ok"><span>t9</span> idempotency would suppress this</li>
          </ol>
        </div>
      </section>

      <section className="steps" aria-label="How a lab works">
        <h2>How a lab works</h2>
        <ol>
          <li>
            <strong>Start from a broken setting.</strong>
            <span>Each lab opens on a configuration that misbehaves in a specific way.</span>
          </li>
          <li>
            <strong>Change one control.</strong>
            <span>Every control says what it changes. Locked challenge settings keep the fault in place.</span>
          </li>
          <li>
            <strong>Play, pause, and step.</strong>
            <span>The diagram, timeline, and metrics share one clock. Color is paired with text.</span>
          </li>
          <li>
            <strong>Save and compare.</strong>
            <span>Runs stay in local storage so two configurations can sit side by side.</span>
          </li>
        </ol>
      </section>

      <section>
        <div className="section-head">
          <h2>Labs</h2>
          <Link to="/labs">Open the library</Link>
        </div>
        <div className="lab-grid">
          {labs.map((lab) => (
            <LabCard
              key={lab.id}
              lab={lab}
              explored={store.progress.explored}
              challenges={store.progress.challenges}
              heading="h3"
            />
          ))}
        </div>
      </section>
    </div>
  );
}
