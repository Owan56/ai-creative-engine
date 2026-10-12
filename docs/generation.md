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

### La clé de stockage du rendu n'est pas forcément neuve

`assets.storage_key` est unique. Le câblage enregistrait le rendu par un
`INSERT` nu, en supposant qu'un moteur renvoie une clé différente à chaque
appel. C'est faux : le moteur de démonstration pointe toujours vers le même
fichier, et un moteur réel peut rendre un résultat mis en cache. La deuxième
génération mourait alors sur la contrainte d'unicité et se terminait en
`FAILED / INTERNAL`, avec un message incompréhensible pour l'utilisateur —
alors que le rendu avait réussi.

`persistVideoAsset()` insère désormais en `ON CONFLICT DO NOTHING`, puis
réutilise la ligne existante **uniquement si elle appartient au même
utilisateur**. Réutiliser sans vérifier le propriétaire livrerait la vidéo
de quelqu'un d'autre ; dans ce cas la fonction lève `AssetKeyConflict`.

Le bug a échappé aux tests parce que leur helper fabriquait sa propre clé à
partir de l'identifiant de génération — donc toujours unique, contrairement
au code de production. Les tests appellent maintenant la fonction réelle avec
la clé que le moteur renvoie. Trouvé en lançant deux générations de suite
depuis l'interface.

### Le coût est annoncé avant d'être débité

`POST /v1/generations/estimate` passe par le même routeur et le même plancher
d'un crédit que la création, sans rien réserver. Un test vérifie que les deux
montants coïncident : s'ils divergeaient, le prix affiché avant confirmation
serait un mensonge, ce qui est la seule raison d'être de cet endpoint.

L'estimation est volontairement calculée sans plafond de budget. Avec un
plafond, un solde insuffisant ferait répondre « aucun moteur disponible »,
ce qui est faux : le moteur existe, c'est le solde qui manque. Les deux cas
appellent des messages différents côté interface.

### L'interface ne devine pas les capacités

`GET /v1/capabilities` renvoie l'union des durées, résolutions et formats que
les moteurs actifs savent produire, sans jamais les nommer (§15). L'assistant
de création ne propose que ces valeurs.

Première version : la liste était écrite en dur côté client. Elle offrait
3 secondes et 4K, qu'aucun moteur ne rend — l'utilisateur parcourait les huit
étapes pour se heurter à un refus à la dernière. Un test parcourt chaque durée
annoncée et vérifie qu'elle est réellement produisible.

## Un piège de test, documenté pour ne pas s'y reprendre

Les fichiers de test partagent une base et tronquent les tables entre les cas.
En parallèle, le nettoyage d'un fichier efface les données d'un autre en
pleine exécution — d'où `fileParallelism: false` dans les paquets adossés à
la base. Un worker laissé en vie entre deux tests pose le même genre de
problème : il consomme les jobs du test suivant.

## Ce qui manque encore

- Le `CreativeDirector` : aujourd'hui le prompt arrive tout fait (§14)
- Le `CostEngine` (§68) : le prix vient aujourd'hui du routeur, pas encore
  d'un moteur de coût avec marges configurables
- Le stockage objet : les images produit ne sont pas transmises, donc le
  flux de création part de la description seule. L'assistant le dit à
  l'utilisateur plutôt que de laisser croire que l'image est envoyée
- Pas de progression fine : les statuts existent, leur diffusion vers le
  frontend non (§24)
- Pas encore de vrai moteur : tout tourne en mock, donc à zéro euro
