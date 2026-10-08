/**
 * Orchestration d'une génération (cahier des charges §78, §23, §31, §106).
 *
 *     accept()  →  réserve les crédits, crée la ligne, met en file
 *     run()     →  route, génère, règle les crédits
 *
 * La règle qui structure tout : **les crédits réservés sont toujours réglés**,
 * consommés en cas de succès, rendus en cas d'échec. Un chemin de sortie qui
 * les laisserait gelés immobiliserait le solde de l'utilisateur sans que rien
 * ne le signale.
 *
 * Volontairement séparé de BullMQ : cette classe ne connaît ni Redis ni les
 * jobs. Elle se teste donc entièrement sans file, et la file devient un
 * détail d'exécution remplaçable.
 */

import type { Pool } from "pg";
import {
  GenerationError,
  type ModelRouter,
  type VideoGenerationRequest,
  type VideoGenerationResult,
} from "@ace/ai-core";
import { CreditError, type CreditService } from "@ace/billing";

export type GenerationStatus =
  | "QUEUED"
  | "PROCESSING"
  | "GENERATING"
  | "POST_PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface AcceptInput {
  readonly userId: string;
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly durationSeconds: number;
  readonly resolution: string;
  readonly aspectRatio: string;
  readonly mode: string;
  readonly seed?: number;
  readonly projectId?: string;
  readonly inputAssetId?: string;
  /** Crédits à geler. Doit venir d'une estimation, jamais du client. */
  readonly estimatedCredits: number;
}

export interface AcceptedGeneration {
  readonly id: string;
  readonly status: GenerationStatus;
  readonly estimatedCredits: number;
}

export interface RunOutcome {
  readonly id: string;
  readonly status: GenerationStatus;
  readonly providerId?: string;
  readonly outputAssetId?: string;
  readonly actualCredits?: number;
  readonly errorCode?: string;
}

/** Stocke la vidéo produite et renvoie l'identifiant de l'actif créé. */
export type PersistOutput = (
  userId: string,
  generationId: string,
  result: VideoGenerationResult,
) => Promise<string>;

export interface PipelineDeps {
  readonly pool: Pool;
  readonly credits: CreditService;
  readonly router: ModelRouter;
  readonly persistOutput: PersistOutput;
  /** Générations simultanées autorisées, selon le plan (§83). */
  readonly maxConcurrentPerUser?: number;
}

export class GenerationPipeline {
  constructor(private readonly deps: PipelineDeps) {}

  /**
   * Accepte une demande : vérifie la concurrence, gèle les crédits, inscrit
   * la génération. Aucun travail GPU n'a lieu ici.
   *
   * L'ordre compte. La ligne est créée avant la réservation pour que celle-ci
   * puisse la référencer ; si la réservation échoue, la ligne est marquée
   * FAILED plutôt que laissée en QUEUED — une génération QUEUED sans
   * réservation serait reprise par un worker et tournerait gratuitement.
   */
  async accept(input: AcceptInput): Promise<AcceptedGeneration> {
    const limite = this.deps.maxConcurrentPerUser;
    if (limite !== undefined) {
      const actives = await this.countActive(input.userId);
      if (actives >= limite) {
        throw new GenerationError(
          "UNSUPPORTED_REQUEST",
          `Limite de ${limite} génération(s) simultanée(s) atteinte.`,
        );
      }
    }

    const { rows } = await this.deps.pool.query<{ id: string }>(
      `INSERT INTO generations
         (user_id, project_id, prompt, negative_prompt, duration_seconds,
          resolution, aspect_ratio, mode, seed, input_asset_id, estimated_credits)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        input.userId,
        input.projectId ?? null,
        input.prompt,
        input.negativePrompt ?? null,
        input.durationSeconds,
        input.resolution,
        input.aspectRatio,
        input.mode,
        input.seed ?? null,
        input.inputAssetId ?? null,
        input.estimatedCredits,
      ],
    );
    const id = rows[0]!.id;

    try {
      const reservation = await this.deps.credits.reserve(
        input.userId,
        id,
        input.estimatedCredits,
      );
      await this.deps.pool.query(
        `UPDATE generations SET reservation_id = $2 WHERE id = $1`,
        [id, reservation.id],
      );
    } catch (err) {
      await this.fail(
        id,
        err instanceof CreditError ? err.code : "INTERNAL",
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }

    return { id, status: "QUEUED", estimatedCredits: input.estimatedCredits };
  }

  /**
   * Exécute une génération acceptée.
   *
   * Ne lève jamais : un worker doit pouvoir enregistrer l'issue et passer au
   * job suivant. Les échecs sortent par le statut, pas par une exception.
   */
  async run(generationId: string): Promise<RunOutcome> {
    const generation = await this.load(generationId);

    if (!generation) {
      return { id: generationId, status: "FAILED", errorCode: "NOT_FOUND" };
    }
    // Un job rejoué ne doit pas relancer une génération déjà réglée : ce
    // serait du GPU payé deux fois.
    if (generation.status !== "QUEUED") {
      return { id: generationId, status: generation.status };
    }

    await this.setStatus(generationId, "PROCESSING");

    const request: VideoGenerationRequest = {
      generationId,
      prompt: generation.prompt,
      ...(generation.negative_prompt
        ? { negativePrompt: generation.negative_prompt }
        : {}),
      ...(generation.input_asset_id ? { productImageKey: generation.input_asset_id } : {}),
      durationSeconds: generation.duration_seconds,
      resolution: generation.resolution as VideoGenerationRequest["resolution"],
      aspectRatio: generation.aspect_ratio as VideoGenerationRequest["aspectRatio"],
      mode: generation.mode as VideoGenerationRequest["mode"],
      ...(generation.seed !== null ? { seed: Number(generation.seed) } : {}),
    };

    try {
      const decision = await this.deps.router.route(request, {
        maxCredits: generation.estimated_credits,
      });
      const provider = decision.chosen.entry.provider;

      await this.deps.pool.query(
        `UPDATE generations
            SET provider_id = $2, status = 'GENERATING', started_at = now(),
                attempts = attempts + 1
          WHERE id = $1`,
        [generationId, provider.id],
      );

      const result = await provider.generate(request);

      await this.setStatus(generationId, "POST_PROCESSING");
      const outputAssetId = await this.deps.persistOutput(
        generation.user_id,
        generationId,
        result,
      );

      // Le coût réel peut être inférieur à l'estimation ; jamais supérieur du
      // point de vue de l'utilisateur — CreditService plafonne au réservé.
      const actual = Math.min(
        result.actualCost.credits || generation.estimated_credits,
        generation.estimated_credits,
      );

      if (generation.reservation_id) {
        await this.deps.credits.consume(generation.reservation_id, actual);
      }

      await this.deps.pool.query(
        `UPDATE generations
            SET status = 'COMPLETED', completed_at = now(),
                output_asset_id = $2, actual_credits = $3,
                gpu_seconds = $4, seed = $5
          WHERE id = $1`,
        [
          generationId,
          outputAssetId,
          actual,
          result.actualCost.gpuSeconds,
          result.seed,
        ],
      );

      return {
        id: generationId,
        status: "COMPLETED",
        providerId: provider.id,
        outputAssetId,
        actualCredits: actual,
      };
    } catch (err) {
      const code =
        err instanceof GenerationError ? err.code : "INTERNAL";
      await this.fail(
        generationId,
        code,
        err instanceof Error ? err.message : String(err),
      );
      return { id: generationId, status: "FAILED", errorCode: code };
    }
  }

  /** Annule une génération non démarrée et rend les crédits. */
  async cancel(generationId: string, userId: string): Promise<boolean> {
    const { rows } = await this.deps.pool.query<{ reservation_id: string | null }>(
      `UPDATE generations
          SET status = 'CANCELLED', completed_at = now()
        WHERE id = $1 AND user_id = $2 AND status = 'QUEUED'
        RETURNING reservation_id`,
      [generationId, userId],
    );

    const ligne = rows[0];
    if (!ligne) return false;

    if (ligne.reservation_id) {
      await this.releaseQuietly(ligne.reservation_id, "CANCELLED");
    }
    return true;
  }

  // ------------------------------------------------------------ internes

  /**
   * Marque l'échec et rend les crédits.
   *
   * La libération ne doit jamais empêcher l'enregistrement de l'échec : si
   * elle casse, la génération resterait QUEUED et serait reprise en boucle.
   */
  private async fail(
    generationId: string,
    code: string,
    message: string,
  ): Promise<void> {
    const { rows } = await this.deps.pool.query<{
      reservation_id: string | null;
    }>(
      `UPDATE generations
          SET status = 'FAILED', completed_at = now(),
              error_code = $2, error_message = $3
        WHERE id = $1 AND status NOT IN ('COMPLETED', 'CANCELLED')
        RETURNING reservation_id`,
      [generationId, code, message.slice(0, 2000)],
    );

    const reservationId = rows[0]?.reservation_id;
    if (reservationId) await this.releaseQuietly(reservationId, "FAILED");
  }

  private async releaseQuietly(
    reservationId: string,
    raison: "FAILED" | "CANCELLED",
  ): Promise<void> {
    try {
      await this.deps.credits.release(reservationId, raison);
    } catch (err) {
      // Déjà réglée : rien à faire. Toute autre erreur doit remonter, sinon
      // des crédits resteraient gelés en silence.
      if (
        err instanceof CreditError &&
        err.code === "RESERVATION_ALREADY_SETTLED"
      ) {
        return;
      }
      throw err;
    }
  }

  private async setStatus(id: string, status: GenerationStatus): Promise<void> {
    await this.deps.pool.query(
      `UPDATE generations SET status = $2 WHERE id = $1`,
      [id, status],
    );
  }

  private async countActive(userId: string): Promise<number> {
    const { rows } = await this.deps.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM generations
        WHERE user_id = $1
          AND status IN ('QUEUED', 'PROCESSING', 'GENERATING', 'POST_PROCESSING')`,
      [userId],
    );
    return Number(rows[0]!.n);
  }

  private async load(id: string): Promise<GenerationRow | null> {
    const { rows } = await this.deps.pool.query<GenerationRow>(
      `SELECT id, user_id, status, prompt, negative_prompt, duration_seconds,
              resolution, aspect_ratio, mode, seed, input_asset_id,
              reservation_id, estimated_credits
         FROM generations WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }
}

interface GenerationRow {
  id: string;
  user_id: string;
  status: GenerationStatus;
  prompt: string;
  negative_prompt: string | null;
  duration_seconds: number;
  resolution: string;
  aspect_ratio: string;
  mode: string;
  seed: string | null;
  input_asset_id: string | null;
  reservation_id: string | null;
  estimated_credits: number;
}
