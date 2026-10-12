# Image de production : API + interface dans un seul conteneur.
#
# Un seul service à héberger, donc une seule facture et aucune configuration
# CORS : l'API sert le build de l'interface, qui l'appelle en chemin relatif.
#
# Construction en deux temps. Les dépendances de développement — TypeScript,
# Vite, Vitest — servent à compiler mais n'ont rien à faire dans l'image
# finale : elles pèsent lourd et élargissent la surface d'attaque.

# ---------------------------------------------------------------- build

FROM node:22-slim AS build
WORKDIR /app

# Les manifestes d'abord : tant qu'ils ne changent pas, Docker réutilise la
# couche d'installation, qui est la plus lente.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/ai-core/package.json packages/ai-core/
COPY packages/auth/package.json packages/auth/
COPY packages/billing/package.json packages/billing/
COPY packages/database/package.json packages/database/
COPY packages/queue/package.json packages/queue/

RUN npm ci

COPY . .

RUN npm run build --workspace @ace/web

# ---------------------------------------------------------------- runtime

FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/ai-core/package.json packages/ai-core/
COPY packages/auth/package.json packages/auth/
COPY packages/billing/package.json packages/billing/
COPY packages/database/package.json packages/database/
COPY packages/queue/package.json packages/queue/

# `--omit=dev` sauf tsx, qui exécute les sources TypeScript au démarrage.
# Compiler en JavaScript serait plus propre ; ce sera le cas quand la chaîne
# de build des paquets sera en place.
RUN npm ci --omit=dev && npm i -g tsx@4

COPY apps/api/src apps/api/src
COPY packages/ai-core/src packages/ai-core/src
COPY packages/auth/src packages/auth/src
COPY packages/billing/src packages/billing/src
COPY packages/database/src packages/database/src
COPY packages/database/migrations packages/database/migrations
COPY packages/queue/src packages/queue/src

COPY --from=build /app/apps/web/dist /app/apps/web/dist
ENV WEB_DIST=/app/apps/web/dist

# L'application ne tourne pas en root : une faille d'exécution de code
# n'obtient alors que les droits d'un compte sans privilège.
USER node

EXPOSE 3001

# Les migrations s'appliquent au démarrage. Le migrateur est idempotent et
# prend un verrou : deux instances qui démarrent ensemble ne se marchent pas
# dessus.
CMD ["sh", "-c", "tsx packages/database/src/cli.ts && tsx apps/api/src/main.ts"]
