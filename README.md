# fireVisualisation

Visualisation des feux en Oregon de 2000 à 2022 avec D3.js.

Dataset : [Fire Occurrence and Cause Data (2000 - 2022)](https://www.kaggle.com/datasets/mattop/fire-occurrence-and-cause-data-2000-2022)

## Lancer le projet

```bash
npm install
npm start
```

Le serveur sert le dossier `public/` sur http://localhost:3000 et la librairie d3 sous `/lib/d3.min.js`.

## Organisation

```
server.js                     serveur express
public/
  index.html                  page d'accueil : un lien vers chaque visualisation
  data/fire-occurence.csv     dataset brut, à ne pas modifier (23 490 feux, 38 colonnes)
  js/fireData.js              première transformation des données, commune à toutes les visualisations
  js/, css/                   style et composants communs (voir « Code partagé »)
  heatmap/                    heatmap des feux par comté et par mois
  sunburst/                   sunburst des causes des incendies
```

Chaque visualisation a son propre dossier dans `public/`, qui contient tous ses fichiers, avec son `index.html` (servi sur `http://localhost:3000/<dossier>/`). Ajoutez ensuite une carte vers votre page dans `public/index.html` (un modèle est en commentaire).

## Code partagé (`public/js/`, `public/css/`)

| Fichier | Rôle |
|---|---|
| `css/theme.css` | style commun : police, couleurs (variables CSS issues de palettes publiées : Tableau 10, Okabe & Ito, ColorBrewer, Tailwind) et composants : `.page`, `.card`, `.toolbar`, `.segmented`, `.stats`, tableaux, `.breadcrumb`, `.legend`, `.tooltip`, `.fire-tooltip`, `.dialog` |
| `css/accessibility.css` + `js/accessibility.js` | panneau d'accessibilité (bouton en haut à droite, raccourci Alt + A), réglages mémorisés pour toutes les pages |
| `js/palette.js` | `FirePalette.token('--data-public')` lit une couleur du thème, `FirePalette.sequential()` donne l'échelle séquentielle d3 |
| `js/tooltip.js` | `FireTooltip.show(event, html)`, `.move(event)`, `.hide()` (style `.fire-tooltip`) |

Utilisation dans une page :

```html
<link rel="stylesheet" href="/css/theme.css">
<link rel="stylesheet" href="/css/accessibility.css">
...
<script src="/lib/d3.min.js"></script>
<script src="/js/palette.js"></script>
<script src="/js/tooltip.js"></script>
<script src="/js/accessibility.js"></script>
<script>
    FireAccessibility.init()                               // ajoute le bouton « Accessibilité » et son panneau
    FireAccessibility.onChange((settings, key) => draw())  // redessiner quand textScale, palette ou contrast change
</script>
```

Pour que les réglages s'appliquent aux graphiques :
- tailles de texte en `rem` (aussi pour le texte des svg) : elles suivent la taille du texte choisie ;
- couleurs des données lues avec `FirePalette.token(...)` au moment du dessin : elles suivent la palette (standard ou daltonisme) ;
- `FireAccessibility.settings.contrast` pour épaissir les traits en contraste élevé ;
- classe `clickable` sur les éléments svg cliquables : le curseur agrandi les signale.

## transformations 

(`js/fireData.js`)
`loadFires(url)` charge un fichier csv et renvoie un tableau de feux. Sans paramètre, le dataset par défaut est chargé


Les colonnes gardent le nom qu'elles ont dans le csv

| Colonnes | Conversion | Cellule vide |
|---|---|---|
| `Serial`, `FireYear`, `EstTotalAcres`, `Protected_Acres`, `Lat_DD`, `Long_DD` | nombre | `null` |
| `Ign_DateTime`, `ReportDateTime`, `Discover_DateTime`, `Control_DateTime`, `CreationDate`, `ModifiedDate` | `Date` | `null` |
| `Area`, `DistrictName`, `UnitName`, `Size_class`, `HumanOrLightning`, `CauseBy`, `GeneralCause`, `SpecificCause`, `FO_LandOwnType`, `County`, `RegUseZone`, `RegUseRestriction`, `Industrial_Restriction` | texte (catégorie) | `"Unspecified"` |
| les autres (noms, codes, commentaires) | texte | `null` |
| `FireCategory` | supprimée : même valeur pour tous les feux | |

La valeur `ERROR: #N/A` présente dans le csv (colonnes `FO_LandOwnType` et `County`) est traitée comme une cellule vide.

### Ne pas modifier le tableau renvoyé

Le csv est chargé et transformé une seule fois : tous les appels à `loadFires()` renvoient le même tableau.
Il ne faut donc pas le modifier directement (pas de `fires.sort()`, pas d'ajout de propriété à un feu),
sinon les autres visualisations sont affectées.

Utiliser `filter`, `map`, `d3.group` ou `fires.slice().sort()`, qui travaillent sur une copie.

