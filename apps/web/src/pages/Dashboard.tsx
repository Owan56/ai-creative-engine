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
  Progress,
  StatusBadge,
  type StatusKind,
} from "../components/ui.js";
import "./Dashboard.css";

export interface Generation {
  readonly id: string;
  readonly title: string;
  readonly status: StatusKind;
  readonly platform: string;
  readonly duration: string;
  readonly credits: number;
}

export interface DashboardProps {
  readonly userName: string;
  readonly credits: number;
  readonly creditsTotal: number;
  readonly generations: readonly Generation[];
  readonly onCreate: () => void;
  readonly onOpen: (id: string) => void;
}

export function Dashboard({
  userName,
  credits,
  creditsTotal,
  generations,
  onCreate,
  onOpen,
}: DashboardProps) {
  const utilises = Math.max(0, creditsTotal - credits);
  const pct = creditsTotal > 0 ? (utilises / creditsTotal) * 100 : 0;

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
          <p className="stat__meta">sur {creditsTotal} ce mois-ci</p>
        </Card>

        <Card>
          <p className="stat__label">Usage</p>
          <p className="stat__value">
            {utilises}
            <span className="stat__value-sub"> / {creditsTotal}</span>
          </p>
          <div className="stat__progress">
            <Progress value={pct} label="Crédits consommés ce mois-ci" />
          </div>
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

        {generations.length === 0 ? (
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
