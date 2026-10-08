# Développement local

## Démarrage

```bash
npm install
cp .env.example .env
npm run dev:up        # postgres, redis, stockage S3
npm run db:migrate
npm test
```

`dev:up` utilise `--wait` : la commande ne rend la main que lorsque chaque
service est *sain*, pas seulement démarré. Sans cela, la migration qui suit
part contre une base qui n'accepte pas encore de connexions.

**Aucun GPU n'est nécessaire.** Le provider par défaut est le mock (§112).

## Services

| Service | Port | Rôle |
|---|---|---|
| `postgres` | 5432 | Base principale |
| `redis` | 6379 | File de jobs BullMQ |
| `s3` | 8333 | Stockage objet compatible S3 |
| `s3-init` | — | Crée le bucket puis s'arrête |

Les ports se changent par variable d'environnement (`POSTGRES_PORT`,
`REDIS_PORT`, `S3_PORT`) si l'un d'eux est déjà pris sur votre machine.

### Commandes

```bash
npm run dev:up       # démarrer et attendre que tout soit sain
npm run dev:logs     # suivre les journaux
npm run dev:down     # arrêter, en conservant les données
npm run dev:reset    # arrêter ET effacer les volumes
```

## Pourquoi SeaweedFS et pas MinIO

Le cahier des charges mentionnait MinIO. **Ses images ne sont plus
distribuées publiquement sur Docker Hub** — `minio/minio` renvoie
« repository does not exist », quay.io est souvent filtré en entreprise, et
l'image Bitnami a été retirée.

SeaweedFS expose la même API S3, persiste réellement les données et gère les
URL signées. Le code écrit contre lui fonctionne sans modification contre
S3, R2, Scaleway ou Backblaze en production — c'est tout l'intérêt de s'en
tenir à l'API S3 plutôt qu'au SDK d'un fournisseur.

Les identifiants de développement (`ace` / `ace-secret-local`) sont dans
`infrastructure/docker/seaweedfs-s3.json`. Ils sont triviaux à dessein :
cette stack est locale et ne doit jamais être exposée.

## Deux détails qui coûtent du temps si on les ignore

**La racine S3 répond 403 à une requête anonyme.** C'est le comportement
attendu — les actifs ne sont jamais publics (§85). La sonde de santé vérifie
donc que le service *répond en HTTP*, pas qu'il autorise l'accès. Une sonde
écrite avec `wget --spider` échoue sur ce 403 et fait passer un service sain
pour défaillant.

**Redis tourne en `noeviction`.** BullMQ ne supporte pas que ses clés
disparaissent sous les jobs en cours. La politique par défaut de Redis
évincerait des clés sous pression mémoire et ferait disparaître des
générations déjà payées.

## Migrations

```bash
npm run db:migrate
```

Rejouables sans risque : chaque migration est enregistrée dans
`schema_migrations` et ignorée si déjà appliquée. Le migrateur verrouille sa
ligne de suivi, donc deux instances qui démarrent ensemble n'appliquent pas
la même migration deux fois.

## Tests

```bash
npm test
```

Les suites `auth` et `billing` ont besoin d'un PostgreSQL. **Sans
`DATABASE_URL`, elles sont ignorées plutôt que de passer en silence** avec
des doublures : un test de sécurité qui passe contre un mock ne prouve rien.

```bash
DATABASE_URL=postgresql://ace:ace@localhost:5432/ace_test npm test
```

Les suites appliquent les migrations elles-mêmes, avec le migrateur de
production. Ne montez jamais une base de test à la main : une contrainte
oubliée fait passer des tests qui ne protègent plus rien.

## Vérification par mutation

Les garanties de facturation et de sécurité ont été éprouvées en retirant
chaque protection pour confirmer que les tests tombent. Si vous touchez à
`CreditService` ou à `AssetAccess`, refaites-le — le détail est dans
[billing.md](billing.md) et [security.md](security.md).
