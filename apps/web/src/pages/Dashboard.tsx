/**
 * Dashboard — page de référence du système de design.
 *
 * Une seule action principale évidente : « Create Ad ». Tout le reste est
 * secondaire et le montre.
 */

import { ArrowRight, Download, Plus } from "../components/icons.js";
import {
  Button,
  Card,
  EmptyState,
  StatusBadge,
  type StatusKind,
} from "../components/ui.js";
import type { GenerationRow } from "../lib/api.js";
import "./Dashboard.css";

export interface Generation {
  readonly id: string;
  readonly title: string;
  readonly status: StatusKind;
  readonly platform: string;
  readonly duration: string;
  readonly credits: number;
}

/**
 * Traduit une ligne de l'API en ce que l'écran affiche.
 *
 * L'utilisateur n'a pas à connaître les statuts internes : QUEUED et
 * PROCESSING deviennent tous deux « Processing », et le format d'image devient
 * la plateforme visée, parce que c'est ce qu'il a choisi.
 */
export function toGeneration(row: GenerationRow): Generation {
  const STATUT: Record<GenerationRow["status"], StatusKind> = {
    QUEUED: "processing",
    PROCESSING: "processing",
    GENERATING: "generating",
    POST_PROCESSING: "processing",
    COMPLETED: "completed",
    FAILED: "failed",
    CANCELLED: "failed",
  };

  const PLATEFORME: Record<string, string> = {
    "9:16": "TikTok / Reels",
    "1:1": "Feed",
    "4:5": "Feed",
    "16:9": "YouTube",
  };

  return {
    id: row.id,
    // Le prompt fait office de titre, tronqué pour tenir sur une ligne.
    title: row.prompt.length > 48 ? `${row.prompt.slice(0, 47)}…` : row.prompt,
    status: STATUT[row.status] ?? "processing",
    platform: PLATEFORME[row.aspect_ratio] ?? row.aspect_ratio,
    duration: `${row.duration_seconds} s`,
    credits: row.actual_credits ?? row.estimated_credits,
  };
}

export interface DashboardProps {
  readonly userName: string;
  /** Crédits réellement engageables maintenant. */
  readonly credits: number;
  /** Crédits gelés par des générations en cours. */
  readonly creditsReserved: number;
  readonly generations: readonly Generation[];
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onCreate: () => void;
  readonly onOpen: (id: string) => void;
}

export function Dashboard({
  userName,
  credits,
  creditsReserved,
  generations,
  loading,
  error,
  onCreate,
  onOpen,
}: DashboardProps) {
  return (
    <div className="dash">
      <header className="dash__head">
        <div>
          <p className="dash__greet">Bonjour, {userName}</p>
          <h1 className="dash__title">Create your next ad.</h1>
          <p className="dash__lead">Your next winning creative starts here.</p>
        </div>
        <Button variant="primary" size="lg" icon={<Plus />} onClick={onCreate}>
          Create Ad
        </Button>
      </header>

      <section className="dash__stats" aria-label="Votre compte">
        <Card>
          <p className="stat__label">
            <span className="stat__label-long">Credits remaining</span>
            <span className="stat__label-short">Credits</span>
          </p>
          <p className="stat__value">{credits}</p>
          <p className="stat__meta">disponibles maintenant</p>
        </Card>

        <Card>
          <p className="stat__label">
            <span className="stat__label-long">In progress</span>
            <span className="stat__label-short">En cours</span>
          </p>
          <p className="stat__value">{creditsReserved}</p>
          <p className="stat__meta">
            {creditsReserved === 0
              ? "aucune génération en cours"
              : "crédits engagés, pas encore débités"}
          </p>
        </Card>

        <Card>
          <p className="stat__label">Creations</p>
          <p className="stat__value">{generations.length}</p>
          <p className="stat__meta">
            {generations.filter((g) => g.status === "completed").length} prêtes à publier
          </p>
        </Card>
      </section>

      <section className="dash__section" aria-labelledby="recent-title">
        <div className="dash__section-head">
          <h2 className="dash__section-title" id="recent-title">
            Recent creations
          </h2>
          {generations.length > 0 ? (
            <Button variant="ghost" icon={<ArrowRight />}>
              Voir tout
            </Button>
          ) : null}
        </div>

        {error ? (
          <Card large>
            <EmptyState title="Chargement impossible." text={error} />
          </Card>
        ) : loading ? (
          <ul className="gen-grid" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <li key={i}>
                <Card className="gen">
                  <div className="gen__preview shimmer" />
                  <div className="gen__body">
                    <div className="shimmer gen__skeleton-line" />
                    <div className="shimmer gen__skeleton-line gen__skeleton-line--short" />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        ) : generations.length === 0 ? (
          <Card large>
            <EmptyState
              title="No creations yet."
              text="Create your first product ad and see Aurya in action."
              action={
                <Button variant="primary" icon={<Plus />} onClick={onCreate}>
                  Create your first ad
                </Button>
              }
            />
          </Card>
        ) : (
          <ul className="gen-grid">
            {generations.map((g) => (
              <li key={g.id}>
                <Card
                  interactive
                  className="gen"
                  onClick={() => onOpen(g.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen(g.id);
                    }
                  }}
                >
                  <div className="gen__preview" aria-hidden="true">
                    {g.status === "generating" || g.status === "processing" ? (
                      <span className="gen__glow" />
                    ) : null}
                  </div>
                  <div className="gen__body">
                    <p className="gen__title">{g.title}</p>
                    <p className="gen__meta">
                      {g.platform} · {g.duration} · {g.credits} crédits
                    </p>
                    <div className="gen__foot">
                      <StatusBadge kind={g.status} />
                      {g.status === "completed" ? (
                        <Button
                          variant="ghost"
                          icon={<Download />}
                          onClick={(e) => e.stopPropagation()}
                        >
                          Download
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
