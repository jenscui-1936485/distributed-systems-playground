import { Link } from 'react-router-dom';
import type { LabMeta } from '../content';
import { progressLabel } from '../content';
import type { LabId } from '../model';

const PROGRESS_TEXT = {
  passed: 'Challenge passed',
  watched: 'Watched',
  new: 'Not started',
} as const;

export function LabCard({
  lab,
  explored,
  challenges,
  heading = 'h2',
}: {
  lab: LabMeta;
  explored: LabId[];
  challenges: LabId[];
  heading?: 'h2' | 'h3';
}) {
  const state = progressLabel(lab.id, explored, challenges);
  const Title = heading;
  return (
    <article className="card lab-card">
      <div className="card-top">
        <span className={`diff diff-${lab.difficulty.toLowerCase()}`}>{lab.difficulty}</span>
        <span className={`progress progress-${state}`}>{PROGRESS_TEXT[state]}</span>
      </div>
      <p className="kicker">{lab.kicker}</p>
      <Title>{lab.title}</Title>
      <p>{lab.summary}</p>
      <ul className="concept-list">
        {lab.concepts.map((concept) => <li key={concept}>{concept}</li>)}
      </ul>
      <div className="card-actions">
        <Link className="button primary" to={`/labs/${lab.id}`}>Open lab</Link>
        <Link className="button ghost" to={`/labs/${lab.id}/challenge`}>Challenge</Link>
      </div>
    </article>
  );
}
