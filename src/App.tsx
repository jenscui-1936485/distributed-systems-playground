import { HashRouter, Link, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { EmptyState } from './components/ui';
import { Compare } from './pages/Compare';
import { Landing } from './pages/Landing';
import { Library } from './pages/Library';
import { Saved } from './pages/Saved';
import { Workspace } from './pages/Workspace';

export function App() {
  return (
    <HashRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/labs" element={<Library />} />
          <Route path="/labs/:labId" element={<Workspace mode="lab" />} />
          <Route path="/labs/:labId/challenge" element={<Workspace mode="challenge" />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/saved" element={<Saved />} />
          <Route
            path="*"
            element={(
              <EmptyState
                title="That page is not in the playground."
                body="The labs, comparison view, and saved runs are linked from the header."
                action={<Link className="button primary" to="/">Back home</Link>}
              />
            )}
          />
        </Routes>
      </Shell>
    </HashRouter>
  );
}
