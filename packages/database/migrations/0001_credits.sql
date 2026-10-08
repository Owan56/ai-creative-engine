-- Socle utilisateurs + crédits.
--
-- Le solde est protégé par la base, pas par le code applicatif : les
-- contraintes CHECK rendent un solde négatif ou une réservation supérieure
-- au solde physiquement impossibles, quel que soit le bug applicatif.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------- users

CREATE TABLE IF NOT EXISTS users (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email       text NOT NULL,
    name        text,
    role        text NOT NULL DEFAULT 'USER'
                CHECK (role IN ('USER', 'ADMIN')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Unicité insensible à la casse : Owan@x.com et owan@x.com sont le même compte.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key
    ON users (lower(email));

-- ---------------------------------------------------------------- comptes

-- balance  : crédits possédés
-- reserved : crédits gelés par des générations en cours
-- disponible = balance - reserved
CREATE TABLE IF NOT EXISTS credit_accounts (
    user_id     uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    balance     integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
    reserved    integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    updated_at  timestamptz NOT NULL DEFAULT now(),

    -- Le garde-fou central : on ne peut jamais geler plus que l'on possède.
    CONSTRAINT credit_accounts_reserved_within_balance
        CHECK (reserved <= balance)
);

-- ---------------------------------------------------------------- réservations

DO $$ BEGIN
    CREATE TYPE credit_reservation_status AS ENUM ('HELD', 'CONSUMED', 'RELEASED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS credit_reservations (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    -- Une génération ne peut porter qu'une seule réservation. C'est la base
    -- qui l'impose : un worker rejoué ne peut pas geler deux fois.
    generation_id  uuid NOT NULL UNIQUE,

    credits        integer NOT NULL CHECK (credits > 0),
    status         credit_reservation_status NOT NULL DEFAULT 'HELD',
    created_at     timestamptz NOT NULL DEFAULT now(),
    expires_at     timestamptz,
    settled_at     timestamptz,

    -- Une réservation réglée porte forcément sa date de règlement.
    CONSTRAINT credit_reservations_settled_coherent
        CHECK ((status = 'HELD') = (settled_at IS NULL))
);

CREATE INDEX IF NOT EXISTS credit_reservations_user_status_idx
    ON credit_reservations (user_id, status);

-- Réservations expirées à balayer par le nettoyage périodique.
CREATE INDEX IF NOT EXISTS credit_reservations_expiry_idx
    ON credit_reservations (expires_at)
    WHERE status = 'HELD';

-- ---------------------------------------------------------------- grand livre

CREATE TABLE IF NOT EXISTS credit_transactions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind            text NOT NULL CHECK (kind IN (
                        'GRANT', 'PURCHASE', 'CONSUME', 'RELEASE', 'EXPIRE', 'ADJUST'
                    )),
    -- Montant signé : positif crédite, négatif débite.
    amount          integer NOT NULL,
    balance_after   integer NOT NULL CHECK (balance_after >= 0),
    reservation_id  uuid REFERENCES credit_reservations (id) ON DELETE SET NULL,

    -- Idempotence des webhooks de paiement (§109) : un webhook Stripe reçu
    -- deux fois ne crédite qu'une fois.
    idempotency_key text UNIQUE,

    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_transactions_user_created_idx
    ON credit_transactions (user_id, created_at DESC);
