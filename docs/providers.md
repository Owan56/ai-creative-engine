# Moteurs et GPU

## Ajouter un moteur

Trois choses, rien d'autre (§119) :

1. `packages/ai-core/src/providers/<Nom>Provider.ts` implémentant `VideoModelProvider`
2. Une entrée dans `registry/bootstrap.ts` avec sa `ModelLicense`
3. Le cas échéant, un workflow ComfyUI

Aucune modification du frontend, du routeur ou du pipeline.

## Deux verrous avant la production

Activer un moteur ne suffit pas. `ModelRegistry.usable()` exige **à la fois**
`enabled` et `license.commercialAllowed`. LTX est livré avec
`commercialAllowed: false` : il peut être activé et testé, mais le routeur ne
le sélectionnera jamais tant que la licence n'a pas été lue et validée.

```bash
LTX_ENABLED=true              # active le moteur
LTX_COMMERCIAL_VERIFIED=true  # atteste la validation juridique
```

Le second drapeau est délibérément distinct. Un oubli de configuration ne doit
pas suffire à exploiter commercialement un modèle dont les conditions n'ont
pas été vérifiées.

## GPU

`GPUBackend` abstrait le fournisseur. `MockGPUBackend` simule tout le cycle —
provisionnement, facturation, arrêt — sans machine réelle, donc l'auto-scaling
se développe à zéro euro. `RunPodBackend` est le premier fournisseur réel.

Deux détails qui coûtent de l'argent si on les ignore :

**RunPod annonce `RUNNING` dès la création du pod.** Le conteneur n'a pas
encore démarré. On ne traduit en `IDLE` qu'une fois l'uptime positif, sinon un
worker enverrait du travail à une machine qui n'écoute pas encore.

**Un arrêt raté laisse un GPU allumé et facturé.** `stop()` journalise et
relaie l'erreur plutôt que de l'avaler : il faut le savoir.

## LTX

Le provider ne provisionne pas de GPU. Le worker alloue l'instance via
`GPUBackend` et passe son endpoint ComfyUI. Le provider reste donc testable
sans GPU, et le fournisseur GPU reste interchangeable.

ComfyUI est une couche d'inférence, jamais l'interface utilisateur (§21).

Les contraintes négatives par défaut (§100) écartent les artefacts connus :
produit déformé, logo erroné, objets en trop, duplication, texte parasite,
scintillement.

## Ce qui n'est pas vérifié

**Le code LTX et RunPod n'a jamais tourné contre du matériel réel.** Les
erreurs HTTP, le calcul de coût et la construction du workflow sont couverts
par des tests à transport injecté, mais l'intégration elle-même reste à
valider en conditions.

Deux chiffres sont des hypothèses, à recaler dès la première génération :

- `qualityScore`, `speedScore`, `productConsistencyScore` de LTX pilotent le
  routage. Faux, ils envoient le trafic au mauvais moteur.
- `estimateCost()` suppose un temps GPU proportionnel à la durée et au nombre
  de pixels. **C'est ce chiffre qui décide si un plan est rentable.**

## Première exécution réelle

```bash
export RUNPOD_API_KEY=...
export LTX_ENABLED=true
export LTX_ENDPOINT=http://<pod>:8188
export LTX_COMMERCIAL_VERIFIED=false   # tant que la licence n'est pas lue
```

Mesurer le temps GPU réel d'une génération, puis corriger `estimateCost()` et
la grille tarifaire avant d'ouvrir les inscriptions.
