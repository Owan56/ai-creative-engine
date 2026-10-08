# AI Creative Engine

**AI Creative Engine for E-commerce** — transformez une simple photo produit
en publicité vidéo professionnelle.

> Create high-converting product ads from a single product image.

Les modèles de génération vidéo sont des **moteurs d'inférence internes
interchangeables**, pas le produit. La valeur est dans la chaîne qui va de la
photo produit à la publicité prête à publier.

## État d'avancement

| Phase | Contenu | État |
|---|---|---|
| 0 | Architecture, monorepo, interfaces, mock provider, auth, tests | 🟡 en cours |
| 1 | Dashboard, upload produit, génération mock, crédits | 🟡 en cours |
| 2 | Creative Director, prompt builder, concepts | ⬜ |
| 3 | Provider LTX, ComfyUI, GPU cloud | 🟡 écrit, pas encore exécuté sur GPU |

Phase 0 livrée à ce jour :

- `@ace/ai-core` — contrat de provider, registre de modèles avec garde de
  licence, routeur de sélection, provider factice
- `@ace/database` — schéma et migrations
- `@ace/billing` — crédits transactionnels : réservation, consommation,
  libération, idempotence des paiements
- `@ace/auth` — mots de passe scrypt, sessions révocables, cloisonnement
  strict entre comptes, validation d'upload, URL signées
- `@ace/queue` — chaîne de génération complète : réservation des crédits,
  routage, exécution, règlement, file BullMQ
- Moteurs : abstraction GPU, backend RunPod, client ComfyUI, provider LTX

103 tests, TypeScript strict. Les garanties de facturation et de sécurité ont
été vérifiées par mutation — voir [docs/billing.md](docs/billing.md) et
[docs/security.md](docs/security.md).

Environnement de développement complet via Docker Compose : `npm run dev:up`
démarre Postgres, Redis et un stockage S3, et attend qu'ils soient sains.

Reste à faire en phase 0 : design system.

## Démarrage

```bash
npm install
cp .env.example .env
npm run dev:up        # postgres, redis, stockage S3
npm run db:migrate
npm test
```

Aucun GPU n'est nécessaire : le provider par défaut en développement est
`MockVideoProvider`.

Les tests de facturation exigent un PostgreSQL. Sans `DATABASE_URL`, ils sont
ignorés plutôt que de passer en silence avec des doublures trompeuses :

```bash
export DATABASE_URL=postgresql://user@localhost/ace_dev
npm test
```

## Structure

```
packages/
  ai-core/          contrat des moteurs, registre, routeur, provider factice
  database/         schéma SQL et migrations
  billing/          crédits transactionnels
  auth/             authentification et cloisonnement des données
  queue/            orchestration des générations et file de jobs
infrastructure/
  docker/           configuration des services de développement
docs/
  architecture.md   décisions d'architecture
  development.md    démarrage local
  billing.md        garanties du système de crédits
  security.md       contrôles de sécurité et leur vérification
  models.md         registre des licences de modèles
```

## Documentation

- [Développement local](docs/development.md)
- [Architecture](docs/architecture.md)
- [Chaîne de génération](docs/generation.md)
- [Moteurs et GPU](docs/providers.md)
- [Crédits et facturation](docs/billing.md)
- [Sécurité](docs/security.md)
- [Licences des modèles](docs/models.md) — **à lire avant d'activer un modèle**
