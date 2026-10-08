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
| 0 | Architecture, monorepo, interfaces, mock provider, tests | 🟡 en cours |
| 1 | Dashboard, upload produit, génération mock, crédits | ⬜ |
| 2 | Creative Director, prompt builder, concepts | ⬜ |
| 3 | Provider LTX, ComfyUI, GPU cloud | ⬜ |

Phase 0 livrée à ce jour :

- `@ace/ai-core` — contrat de provider, registre de modèles avec garde de
  licence, routeur de sélection, provider factice
- `@ace/database` — schéma et migrations
- `@ace/billing` — crédits transactionnels : réservation, consommation,
  libération, idempotence des paiements

32 tests, TypeScript strict. Les garanties de facturation ont été vérifiées
par mutation — voir [docs/billing.md](docs/billing.md).

Reste à faire en phase 0 : Docker Compose, authentification, design system.

## Démarrage

```bash
npm install
npm run typecheck
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
docs/
  architecture.md   décisions d'architecture
  billing.md        garanties du système de crédits
  models.md         registre des licences de modèles
```

## Documentation

- [Architecture](docs/architecture.md)
- [Crédits et facturation](docs/billing.md)
- [Licences des modèles](docs/models.md) — **à lire avant d'activer un modèle**
