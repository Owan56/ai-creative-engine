# Sécurité

## Cloisonnement entre comptes

> Les utilisateurs ne doivent jamais pouvoir accéder aux fichiers d'un autre
> utilisateur. (§63)

La règle est appliquée dans la **couche d'accès** (`AssetAccess`), pas dans
les routes. Une route qu'on oublie de protéger est une fuite ; une couche
d'accès qui filtre par défaut ne s'oublie pas.

Conséquence de conception : aucune méthode ne prend un identifiant seul.
Toutes commencent par l'utilisateur appelant. On ne peut pas appeler la
« version non protégée » par mégarde, puisqu'il n'y en a pas.

### 404, pas 403

Un actif appartenant à autrui renvoie `NotFoundError`, pas `ForbiddenError`.
Un 403 confirmerait que l'identifiant existe, ce qui permet de sonder le
catalogue par balayage d'UUID.

## Mots de passe

- **scrypt** de la bibliothèque standard Node : aucune dépendance externe sur
  un composant de sécurité, aucun binaire natif à compiler.
- `N = 2^15` vise ~100 ms par hachage : assez lent contre une attaque hors
  ligne, assez rapide pour une connexion.
- Sel de 32 octets par utilisateur : deux comptes avec le même mot de passe
  n'ont pas la même empreinte, et les tables précalculées ne servent à rien.
- Comparaison en **temps constant** : une comparaison naïve laisserait fuiter
  le nombre d'octets corrects par sa durée.
- Longueur maximale de 1024 caractères : sans cela, un mot de passe d'un
  mégaoctet devient un vecteur de déni de service sur le hachage.

## Sessions

Jetons opaques en base, pas de JWT. Un JWT ne se révoque pas sans liste
noire — ce qui revient à consulter la base, en plus compliqué. Ici, révoquer
est une écriture.

- 32 octets d'aléa cryptographique.
- **Le jeton n'est jamais stocké** : la base ne garde que son empreinte
  SHA-256. Une fuite de la table `sessions` ne livre aucune session
  utilisable.
- Expiration et révocation vérifiées à chaque résolution.
- Un changement de mot de passe révoque toutes les sessions — c'est l'intérêt
  de l'opération quand le compte est compromis.

## Énumération de comptes

Une adresse inconnue et un mot de passe faux renvoient **le même code et le
même message**. Le chemin « compte inexistant » exécute quand même un hachage
contre une empreinte leurre, pour que la durée de réponse ne trahisse pas
l'existence du compte.

## Uploads

> Ne jamais faire confiance à l'extension. (§64)

- Le type réel est déduit des **premiers octets**, jamais de l'extension ni du
  `Content-Type` déclaré par le client.
- Liste blanche de types, jamais liste noire.
- Le nom fourni par l'utilisateur **n'est jamais réutilisé** : la clé de
  stockage est générée (`<userId>/<kind>/<16 octets aléatoires>.<ext>`), ce
  qui élimine traversée de chemin et collisions.

## Actifs privés

Les actifs ne sont jamais publics. Les liens sont **signés et temporaires**
(§85) : la signature couvre la clé de stockage *et* l'expiration, donc ni
l'une ni l'autre ne peut être modifiée après coup. Vérification en temps
constant.

## Vérification par mutation

Chaque contrôle a été éprouvé en le retirant, pour confirmer que les tests
tombent. Un test de sécurité qui passerait aussi sans la protection est pire
qu'absent : il donne une fausse assurance.

| Contrôle retiré | Tests en échec |
|---|---|
| Propriété dans `get()` | 2 |
| Filtre utilisateur dans `listForUser()` | 1 |
| Hachage du jeton de session | 1 |
| Expiration de session | 1 |
| Propriété à la suppression | 2 |

## Ce qui reste à faire

- Limitation de débit sur la connexion (anti-force brute)
- Verrouillage temporaire après N échecs
- CORS strict et protection CSRF selon le mode de transport retenu
- Journal d'audit des accès administrateur (§65)
- Rotation du secret de signature des URL
