// SPDX-License-Identifier: Apache-2.0
import { Button } from "./components/Button.js";
import { StatCard } from "./components/StatCard.js";

const STATS = [
  { label: "Pieces collected", value: "1,204", trend: "+12%" },
  { label: "Returned to the sea", value: "318", trend: "-4%" },
  { label: "Still drying", value: "77", trend: "+1%" },
];

export function App() {
  return (
    <div className="shell">
      <header className="topbar">
        <span className="wordmark">Driftwood</span>
        <Button variant="primary">New collection</Button>
      </header>

      <main className="content">
        <h1 className="page-title">This week on the beach</h1>
        <p className="page-subtitle">
          Driftwood is an invented product. Nothing here talks to anything real.
        </p>

        <section className="stats">
          {STATS.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </section>

        <section className="actions">
          <Button variant="primary">Log a find</Button>
          <Button variant="ghost">Export</Button>
        </section>
      </main>
    </div>
  );
}
