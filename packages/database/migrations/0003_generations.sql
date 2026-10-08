-- Générations et traçabilité.
--
-- Chaque génération garde de quoi être rejouée et auditée (§101, §102, §103) :
-- modèle, version, seed, prompt, coûts estimé et réel.

DO $$ BEGIN
    CREATE TYPE generation_status AS ENUM (
        'QUEUED', 'PROCESSING', 'GENERATING', 'POST_PROCESSING',
        'COMPLETED', 'FAILED', 'CANCELLED'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS generations (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    project_id        uuid REFERENCES projects (id) ON DELETE SET NULL,
    product_id        uuid REFERENCES products (id) ON DELETE SET NULL,

    status            generation_status NOT NULL DEFAULT 'QUEUED',

    -- Ce qui a été demandé.
    prompt            text NOT NULL,
    negative_prompt   text,
    duration_seconds  integer NOT NULL CHECK (duration_seconds > 0),
    resolution        text NOT NULL,
    aspect_ratio      text NOT NULL,
    mode              text NOT NULL,
    seed              bigint,

    -- Ce qui a été utilisé. Nuls tant que le routeur n'a pas tranché.
    provider_id       text,
    model_version     text,

    -- Crédits réservés à l'acceptation, consommés ou rendus à la fin.
    reservation_id    uuid REFERENCES credit_reservations (id) ON DELETE SET NULL,
    estimated_credits integer NOT NULL CHECK (estimated_credits >= 0),
    actual_credits    integer CHECK (actual_credits IS NULL OR actual_credits >= 0),
    gpu_seconds       numeric(10, 2),

    input_asset_id    uuid REFERENCES assets (id) ON DELETE SET NULL,
    output_asset_id   uuid REFERENCES assets (id) ON DELETE SET NULL,

    error_code        text,
    error_message     text,
    attempts          integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),

    created_at        timestamptz NOT NULL DEFAULT now(),
    started_at        timestamptz,
    completed_at      timestamptz,

    -- Une génération terminée porte sa date de fin, et réciproquement.
    CONSTRAINT generations_completion_coherent CHECK (
        (status IN ('COMPLETED', 'FAILED', 'CANCELLED')) = (completed_at IS NOT NULL)
    ),
    -- Une génération réussie a forcément produit quelque chose.
    CONSTRAINT generations_completed_has_output CHECK (
        status <> 'COMPLETED' OR output_asset_id IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS generations_user_created_idx
    ON generations (user_id, created_at DESC);

-- Compte des générations actives, pour la limite de concurrence par plan (§83).
CREATE INDEX IF NOT EXISTS generations_active_idx
    ON generations (user_id)
    WHERE status IN ('QUEUED', 'PROCESSING', 'GENERATING', 'POST_PROCESSING');
