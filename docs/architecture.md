# Architecture

## Principe directeur

Le produit n'est pas une interface autour d'un modèle vidéo. C'est une
infrastructure de génération publicitaire dans laquelle **le modèle, le
fournisseur GPU, le stockage et le paiement sont tous interchangeables**.

Conséquence pratique : aucun `if (model === "ltx")` ne doit exister hors du
dossier `providers/`. Ajouter un moteur doit se limiter à un fichier
implémentant `VideoModelProvider` plus une entrée dans le `ModelRegistry`.

## Flux

```
Frontend → API → Queue → Worker → Creative Director → Model Router
                                                           ↓
                                                      Provider
                                                           ↓
                                                   ComfyUI / GPU
                                                           ↓
                                            Quality Control → FFmpeg → S3
```

Le frontend ne parle jamais au GPU. Il parle à l'API, qui empile un job.

## Décisions prises

### Le registre porte la licence, pas seulement l'activation

`ModelRegistry.usable()` exige **trois** conditions : activé, hors
maintenance, et `license.commercialAllowed`. Un modèle open-weight n'est pas
automatiquement exploitable commercialement.

Ce choix rend impossible, par construction, qu'un modèle à licence restreinte
parte en production par simple oubli d'un `enabled: true`. Un test couvre
précisément ce cas.

### Aucun modèle n'est activé par défaut

`register()` pose `enabled: false` sauf mention explicite. L'activation est un
geste délibéré, jamais un effet de bord d'un ajout de code.

### Le coût est normalisé contre le budget, pas contre la concurrence

Dans le scoring du routeur, `costScore = 1 - credits / maxCredits`. Un modèle
reste bon marché dans l'absolu même s'il est seul candidat. Normaliser contre
les autres candidats rendrait le score instable selon le parc disponible.

### `supportsRequest` est partagé

La règle de compatibilité vit dans `VideoModelProvider.ts` et sert à la fois au
routeur et aux providers. Une divergence entre les deux produirait un job
accepté puis rejeté en cours d'exécution — avec des crédits déjà réservés.

### Le mode `product` pèse la fidélité à 65 %

Pour un produit e-commerce, un rendu magnifique qui change la couleur du
produit est un échec commercial. Les poids restent configurables par mode.

## Risques identifiés

### Économie du produit

Le coût GPU réel d'une génération n'est pas encore mesuré. Les prix des plans
(19,90 € / 39,90 € / 79,90 €) sont des hypothèses tant que le `CostEngine` n'a
pas tourné sur du vrai GPU. **Mesurer avant de figer la grille tarifaire.**

### Notation automatique de la cohérence produit

Produire un `productConsistency: 0.92` fiable est un problème de recherche, pas
une fonctionnalité de sprint. Prévoir une revue humaine, et un score
volontairement approximatif plutôt qu'un faux score précis.

### Démarrage à froid du GPU

L'allumage d'un worker à la demande ajoute 1 à 3 minutes avant la première
image. L'UI de progression doit couvrir ce temps, sinon l'utilisateur conclut
à une panne.
