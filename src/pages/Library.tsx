import { useState } from 'react';
import { LabCard } from '../components/LabCard';
import { usePageTitle } from '../components/ui';
import { labs, type Difficulty } from '../content';
import { useStore } from '../storage';

const FILTERS: Array<Difficulty | 'All'> = ['All', 'Intro', 'Intermediate', 'Advanced'];

export function Library() {
  const store = useStore();
  const [filter, setFilter] = useState<Difficulty | 'All'>('All');
  usePageTitle('Labs · Distributed Systems Playground');
  const visible = labs.filter((lab) => filter === 'All' || lab.difficulty === filter);
  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">Library</p>
        <h1>Five systems, one workspace.</h1>
        <p className="lede">
          Pick a lab to explore freely, or start its challenge from a configuration that already fails.
          Progress is stored on this device.
        </p>
      </header>
      <div className="filters" role="group" aria-label="Filter by difficulty">
        {FILTERS.map((item) => (
          <button
            key={item}
            type="button"
            className={`speed${filter === item ? ' on' : ''}`}
            aria-pressed={filter === item}
            onClick={() => setFilter(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="lab-grid">
        {visible.map((lab) => (
          <LabCard
            key={lab.id}
            lab={lab}
            explored={store.progress.explored}
            challenges={store.progress.challenges}
          />
        ))}
      </div>
    </div>
  );
}
