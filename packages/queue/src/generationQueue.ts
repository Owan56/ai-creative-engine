/**
 * File de génération, sur BullMQ (cahier des charges §22).
 *
 * Cette couche ne contient aucune logique métier : elle transporte un
 * identifiant jusqu'à `GenerationPipeline.run()`. Tout ce qui décide vit dans
 * le pipeline, qui se teste sans Redis.
 */

import { Queue, Worker, type ConnectionOptions, type JobsOptions } from "bullmq";
import type { GenerationPipeline, RunOutcome } from "./GenerationPipeline.js";

export const GENERATION_QUEUE = "generation";

export interface GenerationJobData {
  readonly generationId: string;
  readonly userId: string;
}

/**
 * Deux tentatives au plus (§53). Au-delà, une génération qui échoue
 * systématiquement consommerait du GPU sans jamais aboutir.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: { type: "exponential", delay: 5_000 },
  // On garde un historique court : assez pour diagnostiquer, pas assez pour
  // faire enfler Redis, dont la mémoire est la ressource critique.
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
};

export function createGenerationQueue(connection: ConnectionOptions): Queue<GenerationJobData> {
  return new Queue<GenerationJobData>(GENERATION_QUEUE, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}

/**
 * Met une génération en file.
 *
 * `jobId` vaut l'identifiant de génération : BullMQ refuse alors un doublon.
 * Sans cela, un double appel de l'API lancerait deux fois le même travail GPU.
 */
export async function enqueueGeneration(
  queue: Queue<GenerationJobData>,
  data: GenerationJobData,
): Promise<void> {
  await queue.add(GENERATION_QUEUE, data, { jobId: data.generationId });
}

export interface WorkerOptions {
  readonly connection: ConnectionOptions;
  readonly pipeline: GenerationPipeline;
  /** Générations menées de front par ce worker. */
  readonly concurrency?: number;
  readonly onOutcome?: (outcome: RunOutcome) => void;
}

export function createGenerationWorker(
  options: WorkerOptions,
): Worker<GenerationJobData, RunOutcome> {
  return new Worker<GenerationJobData, RunOutcome>(
    GENERATION_QUEUE,
    async (job) => {
      const outcome = await options.pipeline.run(job.data.generationId);
      options.onOutcome?.(outcome);

      // `run()` ne lève pas : il renvoie le statut. On relaie l'échec à
      // BullMQ pour qu'il déclenche son backoff, mais seulement si une
      // nouvelle tentative a du sens — un refus de crédits ou une absence de
      // moteur ne s'arrangera pas en réessayant.
      if (outcome.status === "FAILED" && estReessayable(outcome.errorCode)) {
        throw new Error(outcome.errorCode ?? "GENERATION_FAILED");
      }
      return outcome;
    },
    { connection: options.connection, concurrency: options.concurrency ?? 1 },
  );
}

function estReessayable(code: string | undefined): boolean {
  if (!code) return false;
  return !NON_REESSAYABLES.has(code);
}

const NON_REESSAYABLES = new Set([
  "INSUFFICIENT_CREDITS",
  "UNSUPPORTED_REQUEST",
  "NOT_FOUND",
  "CANCELLED",
]);
