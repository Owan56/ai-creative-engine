-- Authentification, projets et actifs.
--
-- Principe (§63, §85) : tout objet appartient à un utilisateur, et cette
-- appartenance est portée par le schéma. Aucune lecture ne doit pouvoir
-- remonter l'objet d'autrui, même sur une requête mal écrite — d'où le
-- `user_id` répliqué sur chaque table et contraint par clé étrangère.

-- ---------------------------------------------------------------- secrets

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_hash text,
    ADD COLUMN IF NOT EXISTS password_salt text;

-- ---------------------------------------------------------------- sessions

CREATE TABLE IF NOT EXISTS sessions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    -- Le jeton n'est JAMAIS stocké en clair. Une fuite de base ne doit pas
    -- donner de sessions utilisables.
    token_hash  text NOT NULL UNIQUE,

    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    user_agent  text,
    ip          inet
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at)
    WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------- projets

CREATE TABLE IF NOT EXISTS projects (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projects_user_idx ON projects (user_id);

-- ---------------------------------------------------------------- actifs

DO $$ BEGIN
    CREATE TYPE asset_kind AS ENUM
        ('PRODUCT_IMAGE', 'VIDEO', 'THUMBNAIL', 'AUDIO', 'EXPORT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS assets (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    project_id    uuid REFERENCES projects (id) ON DELETE SET NULL,
    kind          asset_kind NOT NULL,

    -- Clé interne dans l'object storage. Jamais un nom fourni par
    -- l'utilisateur : on génère un UUID pour éviter toute traversée de
    -- chemin et toute collision (§64).
    storage_key   text NOT NULL UNIQUE,

    content_type  text NOT NULL,
    size_bytes    bigint NOT NULL CHECK (size_bytes >= 0),
    -- Empreinte du contenu, pour la déduplication et l'audit.
    sha256        text,
    metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz
);

CREATE INDEX IF NOT EXISTS assets_user_idx ON assets (user_id)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS assets_project_idx ON assets (project_id)
    WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------- produits

CREATE TABLE IF NOT EXISTS products (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    project_id      uuid REFERENCES projects (id) ON DELETE CASCADE,
    name            text NOT NULL,
    category        text,
    description     text,
    price_cents     integer CHECK (price_cents IS NULL OR price_cents >= 0),
    url             text,
    image_asset_id  uuid REFERENCES assets (id) ON DELETE SET NULL,
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_user_idx ON products (user_id);
