# Site vitrine Aurya

Page unique, cinématique au scroll : le A d'Aurya en verre optique se
décompose en quatre fragments puis se recompose, sur cinq chapitres. Tout est
rendu en temps réel par Three.js — aucune image, aucune vidéo.

## Le voir

```bash
cd apps/site && python3 serve.py 5180
```

Puis http://127.0.0.1:5180

`index.html` a besoin d'un serveur (les modules JavaScript ne se chargent pas
depuis un `file://`). **`version-monofichier.html` s'ouvre d'un double-clic** :
c'est la version à envoyer par e-mail ou à déposer chez un hébergeur.

## Ce qu'il faut changer

| Quoi | Où |
|---|---|
| Les trois chiffres du chapitre Résultats | `site.json`, clé `figures` |
| L'adresse e-mail de contact | `site.json`, clé `email` |
| Les textes | `site.json` |
| La forme en verre | `assets/shapes/shape.svg` |

**Les trois chiffres sont des valeurs provisoires**, pas des mesures. À
remplacer par les tiens avant toute mise en ligne publique.

Après modification de `site.json`, reconstruire avec l'outil du paquet
`premium-3d-glass` (`tools/build_site.py`). Le script est idempotent.

## Couleurs

Le dégradé de fond suit la charte Aurya au fil du scroll :
`#10121C` → `#171A2B` → `#5B5FEF` → `#8B5CF6` → `#4DA3FF`.

## Formulaire de contact

Il ouvre la messagerie du visiteur avec un message prérempli. Aucun serveur
nécessaire : le site s'héberge donc n'importe où (Netlify, Vercel, GitHub
Pages, un simple dossier).
