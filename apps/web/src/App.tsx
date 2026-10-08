/**
 * Point d'entrée de l'interface.
 *
 * Trois états : on vérifie la session, on demande à se connecter, ou on est
 * dans l'application. Rien n'est affiché avant de savoir lequel — un écran
 * qui bascule de « connecté » à « déconnecté » après coup est pire qu'une
 * attente d'une demi-seconde.
 */

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "./components/AppShell.js";
import { Button, Card, EmptyState } from "./components/ui.js";
import { Auth } from "./pages/Auth.js";
import { Dashboard, toGeneration, type Generation } from "./pages/Dashboard.js";
import {
  ApiError,
  listGenerations,
  me,
  readToken,
  setSessionExpiredHandler,
  signOut,
  type CreditBalance,
  type User,
} from "./lib/api.js";

type Etat =
  | { phase: "verification" }
  | { phase: "anonyme" }
  | { phase: "connecte"; user: User; credits: CreditBalance };

export function App() {
  const [etat, setEtat] = useState<Etat>({ phase: "verification" });
  const [page, setPage] = useState("dashboard");
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // Une session expirée côté serveur ramène à l'écran de connexion, quelle
  // que soit la requête qui l'a découverte.
  useEffect(() => {
    setSessionExpiredHandler(() => setEtat({ phase: "anonyme" }));
  }, []);

  // Au démarrage : si un jeton existe, on vérifie qu'il vaut encore.
  useEffect(() => {
    if (!readToken()) {
      setEtat({ phase: "anonyme" });
      return;
    }
    const ctrl = new AbortController();
    me(ctrl.signal)
      .then(({ user, credits }) => setEtat({ phase: "connecte", user, credits }))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setEtat({ phase: "anonyme" });
      });
    return () => ctrl.abort();
  }, []);

  const charger = useCallback(async (signal?: AbortSignal) => {
    setChargement(true);
    setErreur(null);
    try {
      const { generations: lignes } = await listGenerations(signal);
      setGenerations(lignes.map(toGeneration));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setErreur(err instanceof ApiError ? err.message : "Une erreur est survenue.");
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    if (etat.phase !== "connecte") return;
    const ctrl = new AbortController();
    void charger(ctrl.signal);
    return () => ctrl.abort();
  }, [etat.phase, charger]);

  if (etat.phase === "verification") {
    // Sans libellé, un lecteur d'écran ne dirait rien pendant l'attente.
    return (
      <div className="boot" role="status" aria-live="polite">
        <span className="sr-only">Chargement de votre espace…</span>
      </div>
    );
  }

  if (etat.phase === "anonyme") {
    return (
      <Auth
        onAuthenticated={(user) => {
          setEtat({ phase: "verification" });
          void me()
            .then(({ credits }) => setEtat({ phase: "connecte", user, credits }))
            .catch(() => setEtat({ phase: "anonyme" }));
        }}
      />
    );
  }

  const prenom = etat.user.name ?? etat.user.email.split("@")[0] ?? "vous";

  return (
    <AppShell
      current={page}
      onNavigate={setPage}
      credits={etat.credits.available}
      userName={prenom}
    >
      {page === "dashboard" ? (
        <Dashboard
          userName={prenom}
          credits={etat.credits.available}
          creditsReserved={etat.credits.reserved}
          generations={generations}
          loading={chargement}
          error={erreur}
          onCreate={() => setPage("create")}
          onOpen={() => setPage("generations")}
        />
      ) : page === "settings" ? (
        <div className="dash">
          <Card large>
            <EmptyState
              title="Votre compte"
              text={etat.user.email}
              action={
                <Button
                  onClick={() => {
                    void signOut().finally(() => setEtat({ phase: "anonyme" }));
                  }}
                >
                  Se déconnecter
                </Button>
              }
            />
          </Card>
        </div>
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
