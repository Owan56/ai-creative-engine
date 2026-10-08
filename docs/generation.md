# Chaîne de génération

```
accept()                      run()
   │                            │
   ├─ limite de concurrence     ├─ ModelRouter choisit un moteur
   ├─ réserve les crédits       ├─ provider.generate()
   ├─ crée la ligne             ├─ stocke le résultat
   └─ met en file               └─ consomme OU rend les crédits
```

## La propriété qui structure tout

**Les crédits réservés sont toujours réglés** — consommés en cas de succès,
rendus en cas d'échec. Un chemin de sortie qui les laisserait gelés
immobiliserait le solde de l'utilisateur sans que rien ne le signale, et
c'est le genre de bug qu'on ne découvre que par une réclamation client.

Les chemins couverts par des tests :

| Ce qui arrive | Crédits |
|---|---|
| Génération réussie | consommés |
| Le moteur échoue (§106) | rendus |
| Aucun moteur disponible | rendus |
| Le stockage du résultat échoue | rendus |
| Annulation avant démarrage | rendus |
| Solde insuffisant | jamais réservés |

Le cas « le stockage échoue » mérite une mention : la vidéo a bien été
générée, donc du GPU a été consommé. L'utilisateur n'a pourtant rien reçu, il
ne paie pas. C'est une perte assumée côté exploitant, pas un litige client.

## Décisions

### Le pipeline ne connaît pas BullMQ

`GenerationPipeline` ne voit ni Redis ni les jobs : il expose `accept()` et
`run()`. La file n'est qu'un transport qui appelle `run(id)`.

Conséquence utile : toute la logique se teste sans Redis, et la file devient
un détail d'exécution remplaçable.

### `run()` ne lève jamais

Un worker doit pouvoir enregistrer l'issue et passer au job suivant. Les
échecs sortent par le statut, pas par une exception. Le worker décide ensuite
s'il relaie l'échec à BullMQ pour déclencher un nouvel essai — ce qu'il ne
fait pas pour un refus de crédits ou une requête non supportée, qui ne
s'arrangeront pas en réessayant.

### L'identifiant de job vaut l'identifiant de génération

BullMQ refuse alors les doublons. Sans cela, un double clic ou un rejeu
d'appel API lancerait deux fois le même travail GPU.

### Une génération non réservée est marquée FAILED, jamais laissée QUEUED

Si la réservation échoue, la ligne existe pour la traçabilité mais sort de la
file. Laissée en QUEUED, un worker la reprendrait et tournerait gratuitement.

### Redis en `noeviction`

Rappel, parce que c'est la configuration la plus facile à perdre : la
politique par défaut de Redis évincerait des clés sous pression mémoire et
ferait disparaître des générations déjà payées.

## Vérification par mutation

| Protection retirée | Tests en échec |
|---|---|
| Libération des crédits à l'échec | 3 |
| Garde contre le rejeu d'une génération réglée | 1 |
| Contrôle du propriétaire à l'annulation | 3 |
| Limite de générations simultanées | 1 |

## Un piège de test, documenté pour ne pas s'y reprendre

Les fichiers de test partagent une base et tronquent les tables entre les cas.
En parallèle, le nettoyage d'un fichier efface les données d'un autre en
pleine exécution — d'où `fileParallelism: false` dans les paquets adossés à
la base. Un worker laissé en vie entre deux tests pose le même genre de
problème : il consomme les jobs du test suivant.

## Ce qui manque encore

- Le `CreativeDirector` : aujourd'hui le prompt arrive tout fait (§14)
- L'estimation de crédits vient de l'appelant ; elle devra venir du
  `CostEngine` (§68), sinon le client pourrait annoncer son propre prix
- Pas de progression fine : les statuts existent, leur diffusion vers le
  frontend non (§24)
- Pas encore de vrai moteur : tout tourne en mock, donc à zéro euro
