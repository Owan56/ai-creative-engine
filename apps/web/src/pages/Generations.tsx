/**
 * Liste des générations, avec suivi en direct.
 *
 * Une génération prend de quelques secondes à plusieurs minutes. L'écran
 * interroge l'API tant qu'au moins une est en cours, et s'arrête dès que tout
 * est terminé : sonder indéfiniment coûterait des requêtes pour rien.
 *
 * Les statuts sont affichés tels qu'ils sont. Une génération annulée n'est pas
 * présentée comme un échec, et un échec affiche son code — un utilisateur qui
 * ne sait pas pourquoi sa vidéo n'est pas sortie ne peut rien corriger.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, EmptyState } from "../components/ui.js";
import { Plus } from "../components/icons.js";
import {
  ApiError,
  cancelGeneration,
  listGenerations,
  type GenerationRow,
} from "../lib/api.js";
import "./Generations.css";

const EN_COURS: ReadonlySet<GenerationRow["status"]> = new Set([
  "QUEUED",
  "PROCESSING",
  "GENERATING",
  "POST_PROCESSING",
]);

/** Libellés visibles. Aucun ne nomme de moteur : le modèle reste interne. */
const LIBELLE: Record<GenerationRow["status"], string> = {
  QUEUED: "En attente",
  PROCESSING: "Préparation",
  GENERATING: "Génération",
  POST_PROCESSING: "Finalisation",
  COMPLETED: "Terminée",
  FAILED: "Échouée",
  CANCELLED: "Annulée",
};

/** Classe de la pastille. La couleur double le libellé, elle ne le remplace pas. */
const TON: Record<GenerationRow["status"], string> = {
  QUEUED: "wait",
  PROCESSING: "wait",
  GENERATING: "run",
  POST_PROCESSING: "run",
  COMPLETED: "ok",
  FAILED: "ko",
  CANCELLED: "off",
};

/**
 * Messages d'erreur destinés à l'utilisateur.
 *
 * Un code brut ne lui apprend rien. Les codes inconnus retombent sur un
 * message neutre plutôt que d'être affichés tels quels.
 */
const RAISON: Record<string, string> = {
  INSUFFICIENT_CREDITS: "Crédits insuffisants au moment du traitement.",
  NO_PROVIDER_AVAILABLE: "Aucun moteur disponible pour ces options.",
  TIMEOUT: "Le traitement a dépassé le temps imparti.",
  PROVIDER_ERROR: "Le traitement a échoué. Vos crédits ont été rendus.",
};

const FORMAT = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export interface GenerationsProps {
  readonly onCreate: () => void;
  /** Appelé quand une génération se termine : le solde a bougé. */
  readonly onBalanceChanged: () => void;
}

export function Generations({ onCreate, onBalanceChanged }: GenerationsProps) {
  const [lignes, setLignes] = useState<GenerationRow[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [annulation, setAnnulation] = useState<string | null>(null);

  // Nombre de générations actives au tour précédent : s'il diminue, au moins
  // une s'est terminée et le solde de crédits n'est plus celui affiché.
  const activesPrecedent = useRef<number | null>(null);

  const charger = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const { generations } = await listGenerations(signal);
        setLignes(generations);
        setErreur(null);

        const actives = generations.filter((g) => EN_COURS.has(g.status)).length;
        if (activesPrecedent.current !== null && actives < activesPrecedent.current) {
          onBalanceChanged();
        }
        activesPrecedent.current = actives;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setErreur(err instanceof ApiError ? err.message : "Chargement impossible.");
      }
    },
    [onBalanceChanged],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void charger(ctrl.signal);
    return () => ctrl.abort();
  }, [charger]);

  // Sondage conditionnel : actif seulement tant qu'une génération tourne.
  const actives = lignes?.some((g) => EN_COURS.has(g.status)) ?? false;
  useEffect(() => {
    if (!actives) return;
    const ctrl = new AbortController();
    const id = setInterval(() => void charger(ctrl.signal), 4000);
    return () => {
      clearInterval(id);
      ctrl.abort();
    };
  }, [actives, charger]);

  const annuler = useCallback(
    async (id: string) => {
      setAnnulation(id);
      try {
        await cancelGeneration(id);
        await charger();
        onBalanceChanged();
      } catch (err) {
        setErreur(err instanceof ApiError ? err.message : "Annulation impossible.");
      } finally {
        setAnnulation(null);
      }
    },
    [charger, onBalanceChanged],
  );

  if (lignes === null) {
    return (
      <div className="gens" role="status" aria-live="polite">
        <span className="sr-only">Chargement de vos générations…</span>
      </div>
    );
  }

  if (lignes.length === 0) {
    return (
      <div className="gens">
        <Card large>
          <EmptyState
            title="Aucune génération pour l'instant."
            text="Lancez votre première vidéo à partir d'une photo produit : huit étapes, le coût est annoncé avant de confirmer."
            action={
              <Button variant="primary" icon={<Plus />} onClick={onCreate}>
                Créer une vidéo
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="gens">
      <header className="gens__head">
        <div>
          <h1 className="gens__title">Vos générations</h1>
          <p className="gens__sub">
            {lignes.length} au total
            {actives ? " · suivi en direct des vidéos en cours" : ""}
          </p>
        </div>
        <Button variant="primary" icon={<Plus />} onClick={onCreate}>
          Créer une vidéo
        </Button>
      </header>

      {erreur ? (
        <p className="alert alert--error" role="alert">
          {erreur}
        </p>
      ) : null}

      {/* Les changements d'état sont annoncés sans voler le focus. */}
      <ul className="gens__list" aria-live="polite">
        {lignes.map((g) => (
          <li key={g.id}>
            <Card className="gen">
              <div className="gen__main">
                <span className={`pill pill--${TON[g.status]}`}>
                  <span className="pill__dot" aria-hidden="true" />
                  {LIBELLE[g.status]}
                </span>
                <p className="gen__prompt">{g.prompt}</p>
                <p className="gen__meta">
                  {g.aspect_ratio} · {g.resolution} · {g.duration_seconds} s ·{" "}
                  {FORMAT.format(new Date(g.created_at))}
                </p>
                {g.status === "FAILED" && g.error_code ? (
                  <p className="gen__why">
                    {RAISON[g.error_code] ?? "Le traitement n'a pas abouti."}
                  </p>
                ) : null}
              </div>

              <div className="gen__side">
                <span className="gen__credits">
                  <strong>{g.actual_credits ?? g.estimated_credits}</strong> crédit
                  {(g.actual_credits ?? g.estimated_credits) > 1 ? "s" : ""}
                  <span className="gen__credits-note">
                    {g.actual_credits === null ? "estimés" : "débités"}
                  </span>
                </span>

                {EN_COURS.has(g.status) ? (
                  <Button
                    variant="ghost"
                    disabled={annulation === g.id}
                    onClick={() => void annuler(g.id)}
                  >
                    {annulation === g.id ? "Annulation…" : "Annuler"}
                  </Button>
                ) : null}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
