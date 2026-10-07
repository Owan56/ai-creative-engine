# Registre des licences de modèles

> **Règle absolue** : ne jamais affirmer qu'un modèle est commercialement
> exploitable sans avoir vérifié sa licence **actuelle** et le territoire
> d'exploitation. Les licences changent ; ce document doit être revérifié.

Chaque entrée du `ModelRegistry` porte un objet `ModelLicense` avec un champ
`verifiedAt`. Si cette date est ancienne, la licence doit être revue avant
toute exploitation commerciale.

## État des modèles

| Modèle | Activé par défaut | Usage commercial | À vérifier avant activation |
|---|---|---|---|
| `mock` | ✅ développement | sans objet | — |
| `ltx` | ⬜ non implémenté | à vérifier | licence courante, territoire |
| `wan` | ⬜ non implémenté | à vérifier | licence courante + dépendances tierces |
| `hunyuan` | ❌ **désactivé** | **non** par défaut | licence Tencent Community, restrictions territoriales |

## Hunyuan — pourquoi désactivé

HunyuanVideo est distribué sous une licence communautaire Tencent comportant
des restrictions d'usage et de territoire. Le drapeau `HUNYUAN_ENABLED` vaut
`false` par défaut et le registre refuse de le sélectionner tant que
`commercialAllowed` est faux, même si quelqu'un l'active par erreur.

Avant toute activation commerciale : **validation juridique** de la licence
courante et du territoire de l'entreprise comme de l'utilisateur final.

## Wan

Le dépôt officiel annonce une licence Apache 2.0 pour les modèles Wan 2.2.
Conserver néanmoins les notices de licence requises et **vérifier les
dépendances tierces**, qui peuvent porter des conditions différentes de celles
du modèle lui-même.

## LTX

Vérifier la licence courante avant activation. Utiliser les workflows ComfyUI
officiels lorsque c'est possible, sans coupler l'application métier au
workflow.

## Procédure d'ajout d'un modèle

1. Lire la licence à sa source officielle, et la joindre au dossier.
2. Créer `<Nom>Provider.ts` implémentant `VideoModelProvider`.
3. Enregistrer le provider avec son `ModelLicense` renseigné honnêtement,
   `verifiedAt` à la date du jour.
4. Laisser `enabled: false` jusqu'à validation juridique.
5. Documenter ici.
