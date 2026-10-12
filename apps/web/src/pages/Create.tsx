/**
 * Flux de création — le cœur du produit (cahier des charges §16).
 *
 * Huit étapes, une décision par écran. Le principe : à aucun moment
 * l'utilisateur ne doit se demander ce qu'il paie. Le coût est réel, il vient
 * de l'API (`/v1/generations/estimate`, même routeur que la création), il se
 * met à jour à chaque changement d'option, et il est réaffiché juste avant la
 * confirmation.
 *
 * Les choix de plateforme, d'objectif et de style ne sont pas décoratifs :
 * ils déterminent le format d'image et composent la description envoyée au
 * moteur. Cette description reste visible et modifiable à l'étape 7 — rien
 * n'est envoyé que l'utilisateur ne puisse lire.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card } from "../components/ui.js";
import { ArrowRight, Image as ImageIcon, Sparkles, Wand2 } from "../components/icons.js";
import {
  ApiError,
  createGeneration,
  estimateGeneration,
  getCapabilities,
  type Capabilities,
  type Estimate,
} from "../lib/api.js";
import "./Create.css";

// ---------------------------------------------------------------- options

interface Choix {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

/** Chaque plateforme impose son format : c'est elle qui décide, pas l'utilisateur. */
const PLATEFORMES: readonly (Choix & { ratio: string; duree: number })[] = [
  { id: "tiktok", label: "TikTok", detail: "Vertical, 9:16", ratio: "9:16", duree: 5 },
  { id: "instagram_reels", label: "Instagram Reels", detail: "Vertical, 9:16", ratio: "9:16", duree: 5 },
  { id: "instagram_feed", label: "Instagram Feed", detail: "Carré, 4:5", ratio: "4:5", duree: 5 },
  { id: "youtube_shorts", label: "YouTube Shorts", detail: "Vertical, 9:16", ratio: "9:16", duree: 5 },
  { id: "facebook", label: "Facebook", detail: "Carré, 1:1", ratio: "1:1", duree: 5 },
  { id: "youtube", label: "YouTube", detail: "Paysage, 16:9", ratio: "16:9", duree: 8 },
];

const OBJECTIFS: readonly Choix[] = [
  { id: "conversion", label: "Vendre", detail: "Pousser à l'achat immédiat" },
  { id: "awareness", label: "Faire connaître", detail: "Installer la marque" },
  { id: "product_launch", label: "Lancer un produit", detail: "Créer l'attente" },
  { id: "retargeting", label: "Relancer", detail: "Reconquérir un visiteur" },
  { id: "engagement", label: "Faire réagir", detail: "Commentaires et partages" },
  { id: "promotional", label: "Promotion", detail: "Annoncer une offre" },
];

const STYLES: readonly Choix[] = [
  { id: "product_studio", label: "Studio", detail: "Fond neutre, lumière maîtrisée" },
  { id: "cinematic", label: "Cinéma", detail: "Mouvement lent, profondeur" },
  { id: "ugc", label: "Spontané", detail: "Filmé à la main, authentique" },
  { id: "luxury", label: "Luxe", detail: "Matières, reflets, lenteur" },
  { id: "streetwear", label: "Streetwear", detail: "Énergie, contrastes" },
  { id: "lifestyle", label: "Lifestyle", detail: "Mise en situation réelle" },
];

/** Modes de rendu (§19). Le libellé parle de résultat, jamais de modèle. */
const MODES: readonly Choix[] = [
  { id: "fast", label: "Rapide", detail: "Le plus court et le moins cher" },
  { id: "product", label: "Fidélité produit", detail: "Préserve au mieux l'objet" },
  { id: "quality", label: "Qualité", detail: "Rendu net et détaillé" },
  { id: "cinematic", label: "Cinématique", detail: "Mouvement travaillé" },
  { id: "premium", label: "Premium", detail: "Le meilleur rendu possible" },
];

/**
 * Libellés des résolutions. La liste réellement proposée vient de l'API
 * (`/v1/capabilities`) : ce tableau ne fait que nommer celles qui existent.
 * Afficher une option qu'aucun moteur ne sait rendre ferait parcourir tout
 * l'assistant pour rien.
 */
const LIBELLE_RESOLUTION: Record<string, Choix> = {
  "480p": { id: "480p", label: "480p", detail: "Très léger" },
  "720p": { id: "720p", label: "720p", detail: "Léger" },
  "1080p": { id: "1080p", label: "1080p", detail: "Recommandé" },
  "4k": { id: "4k", label: "4K", detail: "Maximum" },
};

// ---------------------------------------------------------------- état

interface Brouillon {
  assetName: string | null;
  assetPreview: string | null;
  plateforme: string | null;
  objectif: string | null;
  style: string | null;
  mode: string | null;
  resolution: string;
  duree: number;
  ratio: string;
  prompt: string;
  /** Vrai dès que l'utilisateur a touché au prompt : on cesse de l'écraser. */
  promptModifie: boolean;
}

const INITIAL: Brouillon = {
  assetName: null,
  assetPreview: null,
  plateforme: null,
  objectif: null,
  style: null,
  mode: null,
  resolution: "1080p",
  duree: 5,
  ratio: "9:16",
  prompt: "",
  promptModifie: false,
};

const TITRES = [
  "Votre produit",
  "Où la publier",
  "Ce qu'elle doit obtenir",
  "Son allure",
  "Le niveau de rendu",
  "Format et durée",
  "La description",
  "Récapitulatif",
] as const;

/**
 * Compose la description à partir des choix.
 *
 * Volontairement explicite : l'utilisateur verra ce texte et pourra le
 * corriger. Une description générée dans son dos, qu'il ne peut pas relire,
 * donnerait des résultats inexplicables.
 */
function composerPrompt(b: Brouillon): string {
  const style = STYLES.find((s) => s.id === b.style);
  const objectif = OBJECTIFS.find((o) => o.id === b.objectif);
  const sujet = b.assetName ? "le produit fourni" : "le produit";

  const morceaux = [
    `Publicité vidéo mettant en scène ${sujet}`,
    style ? `style ${style.label.toLowerCase()} — ${style.detail.toLowerCase()}` : null,
    objectif ? `intention : ${objectif.detail.toLowerCase()}` : null,
    "mouvement de caméra fluide, produit net et lisible du début à la fin",
  ].filter(Boolean);

  return `${morceaux.join(", ")}.`;
}

// ---------------------------------------------------------------- page

export interface CreateProps {
  readonly credits: number;
  /** Appelé après un lancement réussi, pour rafraîchir le solde et la liste. */
  readonly onLaunched: (generationId: string) => void;
  readonly onCancel: () => void;
}

export function Create({ credits, onLaunched, onCancel }: CreateProps) {
  const [etape, setEtape] = useState(0);
  const [b, setB] = useState<Brouillon>(INITIAL);
  const [capacites, setCapacites] = useState<Capabilities | null>(null);
  const [estimation, setEstimation] = useState<Estimate | null>(null);
  const [estimationEnCours, setEstimationEnCours] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const maj = useCallback((patch: Partial<Brouillon>) => {
    setB((prec) => ({ ...prec, ...patch }));
  }, []);

  // Les options proposées sont celles que les moteurs savent produire. Tant
  // qu'on ne les connaît pas, l'étape « format » n'affiche rien plutôt que
  // des choix peut-être invalides.
  useEffect(() => {
    const ctrl = new AbortController();
    getCapabilities(ctrl.signal)
      .then((c) => {
        setCapacites(c);
        // La durée par défaut doit exister : sinon le premier calcul de coût
        // porte sur une combinaison impossible.
        setB((prec) =>
          c.durations.includes(prec.duree)
            ? prec
            : { ...prec, duree: c.durations[0] ?? prec.duree },
        );
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, []);

  // Le coût dépend de la durée, de la résolution, du format et du mode. Il est
  // redemandé à l'API dès que l'un d'eux change : une estimation calculée dans
  // le navigateur finirait par diverger du prix réellement débité.
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setEstimationEnCours(true);
      estimateGeneration(
        {
          durationSeconds: b.duree,
          resolution: b.resolution,
          aspectRatio: b.ratio,
          ...(b.mode ? { mode: b.mode } : {}),
        },
        ctrl.signal,
      )
        .then(setEstimation)
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          // L'estimation échoue : on n'affiche aucun prix plutôt qu'un prix faux.
          setEstimation(null);
        })
        .finally(() => setEstimationEnCours(false));
    }, 250);

    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [b.duree, b.resolution, b.ratio, b.mode]);

  // Tant que l'utilisateur n'a pas écrit sa propre description, elle suit ses
  // choix. Dès qu'il y touche, on ne la remplace plus. Les dépendances sont
  // les seuls champs qui entrent dans la composition : y mettre le brouillon
  // entier relancerait l'effet à chaque frappe.
  useEffect(() => {
    setB((prec) => {
      if (prec.promptModifie) return prec;
      const propose = composerPrompt(prec);
      return prec.prompt === propose ? prec : { ...prec, prompt: propose };
    });
  }, [b.style, b.objectif, b.assetName, b.promptModifie]);

  // Un aperçu d'image est une URL objet : sans révocation, le fichier reste
  // en mémoire tant que l'onglet vit.
  useEffect(() => {
    const url = b.assetPreview;
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [b.assetPreview]);

  const peutAvancer = useMemo(() => {
    switch (etape) {
      case 0:
        return true; // L'image est facultative : une génération par texte reste valable.
      case 1:
        return b.plateforme !== null;
      case 2:
        return b.objectif !== null;
      case 3:
        return b.style !== null;
      case 4:
        return b.mode !== null;
      case 5:
        return true;
      case 6:
        return b.prompt.trim().length >= 3;
      default:
        return true;
    }
  }, [etape, b]);

  const lancer = useCallback(async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      const { generation } = await createGeneration({
        prompt: b.prompt.trim(),
        durationSeconds: b.duree,
        resolution: b.resolution,
        aspectRatio: b.ratio,
        ...(b.mode ? { mode: b.mode } : {}),
      });
      onLaunched(generation.id);
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : "Le lancement a échoué.");
    } finally {
      setEnvoi(false);
    }
  }, [b, onLaunched]);

  const prix = estimation?.available ? estimation.credits : null;
  const soldeInsuffisant = estimation?.available === true && !estimation.affordable;

  return (
    <div className="create">
      <header className="create__head">
        <div>
          <p className="create__step">
            Étape {etape + 1} sur {TITRES.length}
          </p>
          <h1 className="create__title">{TITRES[etape]}</h1>
        </div>
        <Button variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
      </header>

      {/* La progression est annoncée en texte autant qu'en barre : une barre
          seule n'est pas lisible par un lecteur d'écran. */}
      <div
        className="create__bar"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={TITRES.length}
        aria-valuenow={etape + 1}
        aria-label={`Étape ${etape + 1} sur ${TITRES.length} : ${TITRES[etape]}`}
      >
        <span style={{ width: `${((etape + 1) / TITRES.length) * 100}%` }} />
      </div>

      <Card large className="create__panel">
        {etape === 0 ? (
          <EtapeImage brouillon={b} onChange={maj} />
        ) : etape === 1 ? (
          <Grille
            legende="Plateforme de destination"
            options={PLATEFORMES}
            valeur={b.plateforme}
            onPick={(id) => {
              const p = PLATEFORMES.find((x) => x.id === id);
              if (!p) return maj({ plateforme: id });
              // La durée conseillée par la plateforme n'est retenue que si un
              // moteur sait la produire ; sinon on garde la durée courante,
              // qui a déjà été validée contre les capacités.
              const duree = capacites?.durations.includes(p.duree) ?? true
                ? p.duree
                : b.duree;
              maj({ plateforme: id, ratio: p.ratio, duree });
            }}
          />
        ) : etape === 2 ? (
          <Grille
            legende="Objectif de la publicité"
            options={OBJECTIFS}
            valeur={b.objectif}
            onPick={(id) => maj({ objectif: id })}
          />
        ) : etape === 3 ? (
          <Grille
            legende="Style visuel"
            options={STYLES}
            valeur={b.style}
            onPick={(id) => maj({ style: id })}
          />
        ) : etape === 4 ? (
          <Grille
            legende="Niveau de rendu"
            options={MODES}
            valeur={b.mode}
            onPick={(id) => maj({ mode: id })}
          />
        ) : etape === 5 ? (
          <EtapeFormat brouillon={b} onChange={maj} capacites={capacites} />
        ) : etape === 6 ? (
          <EtapePrompt brouillon={b} onChange={maj} />
        ) : (
          <EtapeRecap
            brouillon={b}
            estimation={estimation}
            credits={credits}
            erreur={erreur}
          />
        )}
      </Card>

      <footer className="create__foot">
        <div className="create__cost" aria-live="polite">
          {estimationEnCours ? (
            <span className="create__cost-wait">Calcul du coût…</span>
          ) : prix !== null ? (
            <>
              <span className="create__cost-amount">
                <strong>{prix}</strong> crédit{prix > 1 ? "s" : ""}
              </span>
              <span className="create__cost-sub">
                {soldeInsuffisant
                  ? `Solde insuffisant — il vous en reste ${credits}`
                  : `Il vous en restera ${credits - prix}`}
              </span>
            </>
          ) : estimation && !estimation.available ? (
            <span className="create__cost-wait">
              Aucun moteur ne produit cette combinaison. Changez la durée ou la
              résolution.
            </span>
          ) : (
            <span className="create__cost-wait">Coût indisponible pour le moment.</span>
          )}
        </div>

        <div className="create__nav">
          {etape > 0 ? (
            <Button onClick={() => setEtape((e) => e - 1)} disabled={envoi}>
              Retour
            </Button>
          ) : null}

          {etape < TITRES.length - 1 ? (
            <Button
              variant="primary"
              icon={<ArrowRight />}
              disabled={!peutAvancer}
              onClick={() => setEtape((e) => e + 1)}
            >
              Continuer
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              icon={<Sparkles />}
              disabled={envoi || prix === null || soldeInsuffisant}
              onClick={() => void lancer()}
            >
              {envoi ? "Lancement…" : "Lancer la génération"}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------- étapes

function Grille({
  legende,
  options,
  valeur,
  onPick,
}: {
  legende: string;
  options: readonly Choix[];
  valeur: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <fieldset className="opts">
      <legend className="opts__legend">{legende}</legend>
      <div className="opts__grid">
        {options.map((o) => (
          <label key={o.id} className={`opt${valeur === o.id ? " opt--on" : ""}`}>
            <input
              type="radio"
              name={legende}
              value={o.id}
              checked={valeur === o.id}
              onChange={() => onPick(o.id)}
            />
            <span className="opt__label">{o.label}</span>
            <span className="opt__detail">{o.detail}</span>
            {/* Le choix retenu porte une coche en plus de sa couleur : la
                couleur seule ne doit jamais porter l'information. */}
            <span className="opt__check" aria-hidden="true">
              {valeur === o.id ? "✓" : ""}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function EtapeImage({
  brouillon,
  onChange,
}: {
  brouillon: Brouillon;
  onChange: (patch: Partial<Brouillon>) => void;
}) {
  return (
    <div className="step">
      <p className="step__intro">
        Ajoutez la photo du produit à mettre en scène. Vous pouvez aussi
        continuer sans image : la vidéo sera alors construite à partir de votre
        seule description.
      </p>

      <label className="drop">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            // L'aperçu est local au navigateur. Rien n'est transmis tant que
            // la couche de stockage n'est pas en place — voir l'avis ci-dessous.
            onChange({ assetName: f.name, assetPreview: URL.createObjectURL(f) });
          }}
        />
        {brouillon.assetPreview ? (
          <img className="drop__img" src={brouillon.assetPreview} alt="" />
        ) : (
          <span className="drop__icon" aria-hidden="true">
            <ImageIcon />
          </span>
        )}
        <span className="drop__label">
          {brouillon.assetName ?? "Choisir une image"}
        </span>
        <span className="drop__hint">JPEG, PNG ou WebP — 20 Mo maximum</span>
      </label>

      {/* Dire ce que le produit ne fait pas encore vaut mieux que laisser
          croire que l'image part sur le serveur. */}
      <p className="notice" role="note">
        <strong>À savoir :</strong> le transfert des images vers le serveur
        n'est pas encore actif — la couche de stockage objet reste à brancher.
        L'image ci-dessus sert d'aperçu et n'est pas envoyée. Cette première
        génération partira donc de votre description seule.
      </p>
    </div>
  );
}

function EtapeFormat({
  brouillon,
  onChange,
  capacites,
}: {
  brouillon: Brouillon;
  onChange: (patch: Partial<Brouillon>) => void;
  capacites: Capabilities | null;
}) {
  const plateforme = PLATEFORMES.find((p) => p.id === brouillon.plateforme);

  if (!capacites) {
    return (
      <p className="step__intro" role="status">
        Lecture des formats disponibles…
      </p>
    );
  }

  const resolutions = capacites.resolutions
    .map((r) => LIBELLE_RESOLUTION[r])
    .filter((r): r is Choix => r !== undefined);

  return (
    <div className="step">
      {plateforme ? (
        <p className="step__intro">
          Format {brouillon.ratio}, imposé par {plateforme.label}. La durée et la
          résolution restent à votre main — elles font varier le coût.
        </p>
      ) : null}

      <fieldset className="opts">
        <legend className="opts__legend">Durée</legend>
        <div className="opts__row">
          {capacites.durations.map((d) => (
            <label key={d} className={`chip${brouillon.duree === d ? " chip--on" : ""}`}>
              <input
                type="radio"
                name="duree"
                checked={brouillon.duree === d}
                onChange={() => onChange({ duree: d })}
              />
              {d} s
            </label>
          ))}
        </div>
      </fieldset>

      <Grille
        legende="Résolution"
        options={resolutions}
        valeur={brouillon.resolution}
        onPick={(id) => onChange({ resolution: id })}
      />
    </div>
  );
}

function EtapePrompt({
  brouillon,
  onChange,
}: {
  brouillon: Brouillon;
  onChange: (patch: Partial<Brouillon>) => void;
}) {
  return (
    <div className="step">
      <p className="step__intro">
        Voici la description construite à partir de vos choix. Relisez-la,
        précisez la matière, la couleur, le décor — c'est ce qui change le plus
        le résultat.
      </p>

      <label className="ta">
        <span className="ta__label">Description de la vidéo</span>
        <textarea
          rows={6}
          value={brouillon.prompt}
          onChange={(e) => onChange({ prompt: e.target.value, promptModifie: true })}
          placeholder="Décrivez la scène, la lumière, le mouvement…"
        />
        <span className="ta__hint">
          {brouillon.prompt.trim().length < 3
            ? "Au moins 3 caractères."
            : `${brouillon.prompt.trim().length} caractères`}
        </span>
      </label>

      {brouillon.promptModifie ? (
        <Button
          icon={<Wand2 />}
          onClick={() =>
            onChange({ prompt: composerPrompt(brouillon), promptModifie: false })
          }
        >
          Revenir à la proposition
        </Button>
      ) : null}
    </div>
  );
}

function EtapeRecap({
  brouillon,
  estimation,
  credits,
  erreur,
}: {
  brouillon: Brouillon;
  estimation: Estimate | null;
  credits: number;
  erreur: string | null;
}) {
  const nom = (liste: readonly Choix[], id: string | null) =>
    liste.find((x) => x.id === id)?.label ?? "—";

  const lignes: ReadonlyArray<readonly [string, string]> = [
    ["Produit", brouillon.assetName ?? "Aucune image"],
    ["Plateforme", nom(PLATEFORMES, brouillon.plateforme)],
    ["Objectif", nom(OBJECTIFS, brouillon.objectif)],
    ["Style", nom(STYLES, brouillon.style)],
    ["Rendu", nom(MODES, brouillon.mode)],
    ["Format", `${brouillon.ratio} · ${brouillon.resolution} · ${brouillon.duree} s`],
  ];

  return (
    <div className="step">
      <dl className="recap">
        {lignes.map(([k, v]) => (
          <div key={k} className="recap__row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <div className="recap__prompt">
        <span className="recap__prompt-label">Description envoyée</span>
        <p>{brouillon.prompt}</p>
      </div>

      {estimation?.available ? (
        <p className="recap__cost">
          Cette génération coûtera <strong>{estimation.credits}</strong> crédit
          {estimation.credits > 1 ? "s" : ""}. Ils sont gelés au lancement et
          débités une fois la vidéo produite ; en cas d'échec ils vous sont
          rendus.
        </p>
      ) : null}

      {estimation?.available && !estimation.affordable ? (
        <p className="alert alert--warn" role="alert">
          Il vous manque {estimation.credits - credits} crédit
          {estimation.credits - credits > 1 ? "s" : ""}. Réduisez la durée ou la
          résolution, ou rechargez votre compte.
        </p>
      ) : null}

      {erreur ? (
        <p className="alert alert--error" role="alert">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
