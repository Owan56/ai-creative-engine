# Système de design Aurya

Traduction technique de la charte de marque. **Toute nouvelle interface
applique ces règles.** Avant de créer un composant : vérifier les tokens,
réutiliser l'existant, respecter palette, typographie, espacements, animations,
responsive et accessibilité. Aucun style arbitraire.

## Ce qu'Aurya doit transmettre

Premium · Intelligence · Créativité · Précision · Rapidité · Simplicité ·
Confiance.

L'utilisateur doit sentir une technologie très avancée derrière une interface
très simple. Jamais « une interface autour d'un modèle IA ».

## Principes

1. **Clarté avant décoration.**
2. **Le produit avant la technologie** — on vend le résultat, pas le moteur.
3. **Premium avant tape-à-l'œil.**
4. **Le mouvement doit avoir un but.**
5. **Les surfaces sombres créent la hiérarchie**, pas les ombres.
6. **Le gradient est un accent, jamais un fond.**
7. **Chaque écran a une action principale évidente.**

## Tokens

Source unique : `apps/web/src/styles/tokens.css`. Aucune couleur en dur dans
un composant.

| Token | Valeur | Usage |
|---|---|---|
| `--aurya-bg` | `#08090D` | Fond principal, navigation, grandes surfaces |
| `--aurya-surface` | `#10121C` | Cards, panneaux, modales |
| `--aurya-surface-2` | `#171A2B` | Surfaces interactives, inputs, hover |
| `--aurya-border` | `#24283A` | Séparateurs, bordures |
| `--aurya-blue` | `#4DA3FF` | CTA, liens, actifs, indicateurs IA |
| `--aurya-indigo` | `#5B5FEF` | Accent principal, progression |
| `--aurya-violet` | `#8B5CF6` | Accent créatif, premium |
| `--aurya-text` | `#F5F7FF` | Titres, texte principal |
| `--aurya-text-secondary` | `#C7CBD9` | Descriptions |
| `--aurya-text-muted` | `#777D91` | Métadonnées, placeholders |
| `--aurya-success` | `#22C55E` | Succès |
| `--aurya-warning` | `#F59E0B` | Avertissement |
| `--aurya-error` | `#EF4444` | Erreur |

### Gradient signature

```css
--aurya-gradient: linear-gradient(135deg, #4DA3FF 0%, #5B5FEF 45%, #8B5CF6 100%);
```

Réservé aux boutons principaux, à l'indicateur de navigation active et aux
barres de progression. **Jamais en fond de page, jamais sur plusieurs
éléments d'un même écran.**

### Règle 70 / 20 / 10

70 % surfaces sombres · 20 % typographie blanche et grise · 10 % bleu, indigo,
violet. Si un écran dépasse 10 % de couleur, il est hors charte.

## Typographie

**Inter**, repli `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
sans-serif`.

| Niveau | Taille | Graisse | Interlettrage |
|---|---|---|---|
| Display | 48–64 px | 700 | −0.04em |
| H1 | 40–48 px | 700 | −0.03em |
| H2 | 30–36 px | 650 | −0.02em |
| H3 | 22–26 px | 600 | −0.01em |
| Body | 15–16 px | 400 | 0 |
| Small | 13–14 px | 400 | 0 |
| Caption | 11–12 px | 500 | 0.02em |

## Rayons

| Élément | Rayon |
|---|---|
| Petits éléments | 6 px |
| Inputs | 8 px |
| Boutons | 10 px |
| Cards | 14 px |
| Grandes cards | 18 px |
| Modales | 20 px |

Jamais plus arrondi : Aurya reste professionnel.

## Boutons

| Variante | Fond | Texte | Bordure |
|---|---|---|---|
| Primary | gradient Aurya | `#FFFFFF` | aucune |
| Secondary | `--aurya-surface-2` | `--aurya-text` | `--aurya-border` |
| Ghost | transparent | `--aurya-text-secondary` | aucune |
| Danger | `--aurya-error` | `#FFFFFF` | aucune |

Hauteur 40–48 px, rayon 10 px. Hover : légère montée de luminosité. Ombre
très faible. **Danger uniquement pour une action réellement destructive.**

## Cards

Fond `--aurya-surface`, bordure 1 px `--aurya-border`, rayon 14–18 px, ombre
très faible. La profondeur vient du **contraste, de la bordure et de
l'espacement**, jamais d'une grosse ombre.

Hover : `translateY(-2px)` au maximum.

## Navigation

**Sidebar** 240–260 px, fond `--aurya-bg`. Entrées : Dashboard, Create,
Projects, Generations, Assets, Templates — séparateur — Credits, Billing —
séparateur — Settings.

L'entrée active prend `--aurya-surface-2` plus un filet en gradient Aurya à
gauche, subtil.

**Topbar** minimale : fil d'Ariane, crédits, notifications, profil. Rien de
plus.

## Iconographie

**Lucide**, contour, 2 px, minimal. Jamais d'icône 3D. **Jamais d'emoji comme
icône d'interface.**

## Animations

200–300 ms, `ease-out`. Uniquement `opacity`, `transform`, `scale` très léger,
`translate`. Pas d'animation permanente.

Micro-interactions : hover bouton = luminosité ; card = `translateY(-2px)` ;
focus = anneau indigo discret ; chargement = shimmer très léger.

Pendant l'analyse IA : **lueur en dégradé qui se déplace lentement**. Pas de
gros spinner, pas de particules, pas d'effet gaming.

## Effets de fond

Autorisés, très discrets :

```css
background: radial-gradient(circle at 50% 0%, rgba(91,95,239,0.12), transparent 50%);
```

Interdits : étoiles, particules, lignes cyberpunk, grille futuriste, néon
appuyé.

## Badges d'état

`AI READY` · `GENERATING` · `PROCESSING` · `COMPLETED` · `FAILED`

Uniquement les couleurs d'état. **L'information ne passe jamais par la seule
couleur** : un libellé accompagne toujours la pastille.

## Rédaction

Ton assuré, premium, simple, direct. Bouton principal : « Create Ad », pas
« Generate AI Video ». Accroche de dashboard : « Your next winning creative
starts here », pas « AI video generator ready ».

Interdit dans l'interface comme sur la vitrine : **LTX, Wan, Hunyuan** et tout
jargon technique. Ce sont des infrastructures internes.

Empty state type :

> **No creations yet.**
> Create your first product ad and see Aurya in action.
> → *Create your first ad*

## Responsive

Desktop : sidebar plus contenu. Tablette : sidebar compacte. Mobile :
navigation basse ou drawer. **Jamais une simple réduction du desktop.**

## Accessibilité

Contraste suffisant, focus visible, navigation au clavier, libellés ARIA,
textes alternatifs. Une information n'est jamais portée par la seule couleur.

## Thème

Le sombre est le mode principal. Les tokens sont déclarés sur `:root` et
redéclarés sous `[data-theme="light"]`, pour qu'un mode clair s'ajoute plus
tard **sans réécrire un seul composant**.

## Interdits

Violet partout · néon cyberpunk · glassmorphisme excessif · gradients en excès
· grosses ombres · cards trop arrondies · emoji en icône · esthétique gaming ou
crypto · dégradés arc-en-ciel ou roses · or · vert comme couleur de marque ·
animations excessives · jargon IA · interface façon ComfyUI · graphes de nœuds
· exposition de la complexité des modèles.

## Écarts assumés

Le **site vitrine** (`apps/site`) garde sa typographie Space Grotesk et ses
couleurs en dur. C'est une pièce cinématique autonome, produite par un moteur
distinct, et son rendu a été validé tel quel. Il n'utilise pas ces tokens ;
le reste de l'application, si.
