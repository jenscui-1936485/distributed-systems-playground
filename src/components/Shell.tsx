import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useStore } from '../storage';

export function Shell({ children }: { children: ReactNode }) {
  const store = useStore();
  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <NavLink to="/" className="brand" end>
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-full">Distributed Systems Playground</span>
          <span className="brand-short">Playground</span>
        </NavLink>
        <nav className="nav" aria-label="Primary">
          <NavLink to="/labs">Labs</NavLink>
          <NavLink to="/compare">Compare</NavLink>
          <NavLink to="/saved">Saved</NavLink>
        </nav>
      </header>
      {store.persistWarning && (
        <p className="persist-warning" role="status">
          This browser blocked local storage, so scenarios and progress stay in memory for this tab only.
        </p>
      )}
      <main id="main">{children}</main>
      <footer className="footer">
        <p>Educational models that run in the browser. Saved scenarios and recent runs stay on this device.</p>
      </footer>
    </div>
  );
}
