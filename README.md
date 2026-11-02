# fireVisualisation

Visualisation des feux en Oregon de 2000 à 2022 avec D3.js.

Dataset : [Fire Occurrence and Cause Data (2000 - 2022)](https://www.kaggle.com/datasets/mattop/fire-occurrence-and-cause-data-2000-2022)

## Lancer le projet

```bash
npm install
npm run prepare-data
npm start
```

Le serveur sert le dossier `public/` sur http://localhost:3000 et la librairie d3 sous `/lib/d3.min.js`.

## Thème et accessibilité

La Bubble Map charge le thème commun (`css/theme.css`), les adaptations de la carte
(`bubblemap/style.css`), puis les styles d'accessibilité (`css/accessibility.css`).
Les couleurs d'interface et de données utilisent les variables CSS du thème.
Les classes de taille A à G suivent la gamme ColorBrewer Oranges dans les deux
palettes ; les casernes sont des carrés bleus dont la couleur suit la palette.

Le bouton **Accessibilité**, également accessible avec **Alt+A**, propose le
contraste renforcé, un grand curseur, une palette adaptée au daltonisme et cinq
tailles de texte (100 %, 125 %, 150 %, 175 %, 200 %). **Échap**, le bouton de fermeture ou un
clic extérieur ferment le panneau. Les réglages sont mémorisés dans le
navigateur sous la clé `fire-accessibility`. Si le stockage est bloqué, ils
restent disponibles pour la session. **Réinitialiser** rétablit les valeurs par
défaut. Inter est chargée lorsque la connexion le permet, avec la police système
comme solution de repli.

Exécuter `npm test` pour vérifier le filtrage géographique, la cohérence des
exports, le contrôleur du fisheye et la gestion des préférences d'accessibilité.

## Organisation

```
server.js                     serveur express
public/
  index.html                  page d'accueil : un lien vers chaque visualisation
  data/fire-occurence.csv     dataset brut, à ne pas modifier (23 490 feux, 38 colonnes)
  js/fireData.js              première transformation des données, commune à toutes les visualisations
  js/, css/                   style et composants communs (voir « Code partagé »)
  bubblemap/                  carte annuelle, casernes, liens estimés et fisheye
  heatmap/                    heatmap des feux par comté et par mois
  sunburst/                   sunburst des causes des incendies
  bulletgraph/                bullet graph des totaux de feux et de surface brûlées sur toutes les années, avec causes et médianes
```

Chaque visualisation a son propre dossier dans `public/`, qui contient tous ses fichiers, avec son `index.html` (servi sur `http://localhost:3000/<dossier>/`). Ajoutez ensuite une carte vers votre page dans `public/index.html` (un modèle est en commentaire).

## Code partagé (`public/js/`, `public/css/`)

| Fichier | Rôle |
|---|---|
| `css/theme.css` | style commun : police, couleurs (variables CSS issues de palettes publiées : Tableau 10, Okabe & Ito, ColorBrewer, Tailwind) et composants : `.page`, `.card`, `.toolbar`, `.segmented`, `.stats`, tableaux, `.breadcrumb`, `.legend`, `.tooltip`, `.fire-tooltip`, `.dialog` |
| `css/accessibility.css` + `js/accessibility.js` | panneau d'accessibilité (bouton en haut à droite, raccourci Alt + A), réglages mémorisés pour toutes les pages |
| `js/palette.js` | `FirePalette.token('--data-public')` lit une couleur du thème, `FirePalette.sequential()` donne un interpolateur d3 ; `FirePalette.discrete(classes = 7)` donne un tableau de couleurs |
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

## Première transformation

(`js/fireData.js`)
`loadFires(url)` charge un fichier csv et renvoie un tableau de feux. Sans paramètre, le dataset complet `/data/fire-occurence.csv` est chargé. La Bubble Map demande explicitement `/data/fires-bubble-map.csv`


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



## Préparer le dataset de la bubble map

`npm run prepare-data` exécute `scripts/prepare-data.mjs`. Le script conserve
seulement : `Serial`, `FireYear`, `FireName`, `UnitName`, `DistrictName`,
`County`, `Lat_DD`, `Long_DD`, `EstTotalAcres`, `Size_class`,
`Discover_DateTime` et `Control_DateTime`.

Les deux dates sont gardées pour calculer ultérieurement la durée estimée entre
la découverte et la maîtrise. Les lignes sans identifiant, année, coordonnées ou
superficie ne sont pas exportées.

Les feux valides sont ensuite filtrés avec `d3.geoContains` contre les districts
de `data/Congressional_Districts.geojson`, le même fond que celui servi à la
carte. Un feu est conservé si son centre appartient à au moins un district,
avec le comportement de D3 sur les frontières et sans marge supplémentaire.
Ce calcul est effectué uniquement lors de la préparation, jamais au chargement
de la page. Si le fond est absent, illisible ou invalide, la préparation échoue
avant toute écriture des exports.

`data/fires-excluded.csv` conserve les feux valides hors du territoire avec les
mêmes colonnes que le jeu allégé, plus `ExclusionReason` (« Hors du territoire
du fond de carte »). Le bilan affiche les nombres examinés, retenus et exclus.
Avec les données actuelles : 23 408 feux valides, 23 391 retenus et 17 exclus.
Le CSV brut et les coordonnées sources sont conservés ; `Other State` ne
décide pas de l'exclusion. Les cercles dont le centre est retenu restent entiers,
même si leur rayon dépasse une frontière.

`UnitName`, `DistrictName` et `County` sont conservés pour les futurs filtres
territoriaux et l'analyse du réseau de casernes. Ils ne prouvent toutefois pas
qu'une caserne précise est intervenue sur un feu.

Le même script prépare aussi `fire-stations.csv` depuis le fichier Excel des
casernes. Il conserve l'identifiant, l'agence, le nom, le type, le comté et les
coordonnées géographiques. Les sites administratifs, de formation ou de
maintenance ne sont pas inclus.

Le script génère également `unit-station-candidates.csv`. Une correspondance
est validée lorsque `UnitName` apparaît dans le nom ou l'agence d'une caserne
et que son comté est présent parmi les feux de cette unité. Les candidats dont
le comté ne correspond pas sont rejetés. Seules les lignes validées sont
copiées dans `unit-station-mapping.csv` et affichées sur la carte. Cette règle
désigne des casernes territorialement pertinentes, sans attester qu'elles sont
intervenues sur chaque feu.
Les correspondances continuent à utiliser tous les feux numériquement valides,
avant le filtrage géographique, pour préserver leur périmètre de validation.

Enfin, `fire-station-links.csv` relie chaque feu retenu à la caserne validée la plus
proche appartenant à sa `UnitName`. La distance est calculée à vol d'oiseau en
kilomètres. Ces liaisons visualisent une proximité estimée, et non le trajet ou
l'intervention historique d'une caserne.

Le fonctionnement de la carte et les conventions de données sont documentés dans [`docs/guide-technique.md`](docs/guide-technique.md).
