# Déploiement

Cible de ce document : une démonstration en ligne, sans GPU, qui coûte
quelques euros par mois. Tout fonctionne réellement — inscription, crédits,
les huit étapes de création, le suivi — sauf la vidéo elle-même, produite par
le moteur de démonstration.

## Ce qui tourne, et ce qui ne tourne pas encore

| Fonction | État en démonstration |
| --- | --- |
| Comptes, sessions | réel |
| Crédits : réservation, débit, remboursement | réel |
| Les huit étapes, l'estimation de coût | réelles |
| File de jobs, suivi des statuts | réels |
| **La vidéo produite** | **moteur de démonstration** |
| **Transfert des images produit** | **absent — pas de stockage objet** |

Les deux dernières lignes sont des manques, pas des approximations.
L'interface les annonce à l'utilisateur ; ne pas le faire reviendrait à
vendre une capacité qui n'existe pas.

## Un seul conteneur

L'image construit l'interface, puis l'API la sert elle-même. Une seule
origine : aucune configuration CORS, aucun proxy, et le chemin relatif `/v1`
que l'interface appelle tombe juste.

Le worker tourne dans le même processus quand `WORKER_IN_PROCESS=true`. Ce
n'est pas la forme cible — en production on sépare les deux, pour qu'une
génération longue ne soit pas interrompue par un redéploiement de l'API —
mais cela évite de payer un second conteneur pour une démonstration.

Sans worker, rien ne consomme la file : les générations restent en `QUEUED`
indéfiniment.

## Railway

1. **Nouveau projet** → *Deploy from GitHub repo* → ce dépôt, branche
   `claude/affectionate-cori-e3ul5x`.
2. **Ajouter PostgreSQL** (*New* → *Database* → *PostgreSQL*).
3. **Ajouter Redis** (*New* → *Database* → *Redis*).
4. Dans le service applicatif, onglet **Variables**, poser celles du tableau
   ci-dessous.
5. Onglet **Settings** → *Networking* → *Generate Domain*.

Railway détecte le `Dockerfile` et applique `railway.json`, qui déclare
`/health` comme sonde de démarrage.

### Variables

| Variable | Valeur | Pourquoi |
| --- | --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | référence au service, pas une copie |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` | idem |
| `WORKER_IN_PROCESS` | `true` | sinon rien ne traite les générations |
| `VIDEO_PROVIDER` | `mock` | aucun GPU, aucun coût |
| `ASSET_URL_SECRET` | `openssl rand -hex 32` | à régénérer par environnement |
| `NODE_ENV` | `production` | |

`PORT` est injectée par Railway ; ne pas la définir à la main.

La syntaxe `${{Postgres.DATABASE_URL}}` fait pointer la variable vers le
service : recopier la valeur à la main casserait l'application à la première
rotation d'identifiants.

### Ce qu'il ne faut pas poser

`STRIPE_SECRET_KEY`, `FAL_KEY`, `RUNPOD_API_KEY` : tant que la démonstration
tourne en mock, ces clés n'ont aucune utilité et élargissent la surface en
cas de fuite des variables.

## Migrations

Elles s'appliquent au démarrage du conteneur. Le migrateur est idempotent et
prend un verrou sur `schema_migrations` : deux instances qui démarrent
ensemble ne s'exécutent pas en double.

## Vérifier après déploiement

```
curl https://<domaine>/health          # {"status":"ok"}
```

Puis dans un navigateur : créer un compte, lancer une génération, vérifier
que le statut passe à « Terminée » et que le solde a baissé d'un crédit. Si
le statut reste « En attente », `WORKER_IN_PROCESS` n'est pas à `true`.

## Coût attendu

Application + PostgreSQL + Redis : environ 5 €/mois chez Railway, le palier
gratuit couvrant les premiers temps. Aucun coût d'inférence tant que
`VIDEO_PROVIDER=mock`.

Avec de vraies vidéos via fal.ai, compter environ 0,30 $ par clip de cinq
secondes en 1080p — facturé à l'usage, donc nul sans trafic.

## Avant d'ouvrir au public

Ce déploiement convient à une démonstration montrée à des personnes
choisies. Il manque encore, pour accueillir de vrais clients :

- le stockage objet, sans quoi la promesse « photo produit → vidéo » n'est
  pas tenue ;
- Stripe, donc aucun moyen d'encaisser ;
- un vrai moteur : les vidéos produites ne sont pas exploitables ;
- la séparation API / worker ;
- une politique de sauvegarde de la base.
