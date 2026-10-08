/**
 * Point d'entrée de l'interface.
 *
 * Seul le Dashboard est implémenté : c'est la page de référence du système de
 * design. Les autres destinations affichent un état vide honnête plutôt
 * qu'une page factice.
 */

import { useState } from "react";
import { AppShell } from "./components/AppShell.js";
import { Card, EmptyState } from "./components/ui.js";
import { Dashboard, type Generation } from "./pages/Dashboard.js";

/** Données de démonstration, le temps de brancher l'API. */
const DEMO: Generation[] = [
  {
    id: "1",
    title: "Collier pendentif lune",
    status: "completed",
    platform: "TikTok",
    duration: "10 s",
    credits: 15,
  },
  {
    id: "2",
    title: "Bracelet jonc minimaliste",
    status: "generating",
    platform: "Instagram Reels",
    duration: "8 s",
    credits: 12,
  },
  {
    id: "3",
    title: "Boucles d'oreilles perles",
    status: "failed",
    platform: "Facebook",
    duration: "6 s",
    credits: 0,
  },
];

export function App() {
  const [page, setPage] = useState("dashboard");

  return (
    <AppShell current={page} onNavigate={setPage} credits={185} userName="Owan">
      {page === "dashboard" ? (
        <Dashboard
          userName="Owan"
          credits={185}
          creditsTotal={300}
          generations={DEMO}
          onCreate={() => setPage("create")}
          onOpen={() => setPage("generations")}
        />
      ) : (
        <div className="dash">
          <Card large>
            <EmptyState
              title="Bientôt disponible."
              text="Cette section n'est pas encore construite. Le Dashboard sert de référence au système de design ; le reste suivra une fois qu'il sera validé."
            />
          </Card>
        </div>
      )}
    </AppShell>
  );
}
