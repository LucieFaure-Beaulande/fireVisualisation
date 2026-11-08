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
admin/                        console d'administration des données (voir « Console d'administration »)
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
`loadFires(url)` charge un fichier csv et renvoie un tableau de feux. Sans paramètre, il charge `/data/fires-current.csv` avec `/data/fire-occurence.csv` comme source de secours. La Bubble Map demande explicitement `/data/fires-bubble-map.csv`.


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
Le tableur provient du jeu [Fire Stations sur Oregon GeoHub](https://geohub.oregon.gov/datasets/fac9a8c2add346efa83bfee0cd7923aa_0/explore).

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
La durée entre découverte et maîtrise est arrondie à la minute et conservée
uniquement si elle est strictement positive ; une durée nulle, négative ou
non calculable reste vide sans supprimer le feu ou sa liaison. Le fuseau source
n'est pas documenté : aucune correction de changement d'heure n'est affirmée.
La durée est affichée dans les détails, sans encodage par la largeur des liens.

Le fonctionnement de la carte et les conventions de données sont documentés dans [`docs/guide-technique.md`](docs/guide-technique.md).

## Console d'administration

Une page pour changer les données des visualisations sans toucher au dépôt git :
**http://localhost:3000/admin/** (adresse affichée au démarrage du serveur, aucune page n'y renvoie ;
une autre adresse avec la variable d'environnement `ADMIN_PATH`).

Pour chaque dataset : son état (lignes, années), ses fichiers, l'ajout d'un fichier CSV avec une vérification avant
(colonnes obligatoires, nouvelles années, lignes déjà présentes), le remplacement du fichier d'origine par un autre fichier
de même structure (par exemple les feux d'une autre région), le retrait d'un fichier ajouté et le retour aux données d'origine.

### Fonctionnement

```
public/data/fire-occurence.csv   fichier d'origine, jamais modifié
data/additions/fires/            fichiers ajoutés depuis la console (pas dans git)
data/additions/fires/base/       fichier qui remplace le fichier d'origine, s'il y en a un (pas dans git)
public/data/fires-current.csv    construit par le serveur : base (origine ou remplacement) + ajouts, sans doublons (pas dans git)
```

- Une ligne est identifiée par `Serial` : si un fichier ajouté contient un `Serial` déjà présent, la version la plus récente
  (`ModifiedDate`) est gardée.
- **Ajouter** complète les données. **Remplacer** utilise le fichier envoyé à la place du fichier d'origine et retire les
  fichiers ajoutés, qui complétaient les données précédentes. Dans les deux cas, le fichier doit avoir les colonnes obligatoires ;
  le fichier construit garde toujours les colonnes du fichier d'origine (une colonne absente reste vide).
- **Revenir aux données d'origine** retire le fichier de remplacement et les fichiers ajoutés.
- `loadFires()` lit `fires-current.csv` (ou le fichier d'origine s'il n'existe pas encore) : les visualisations qui l'utilisent
  (sunburst, bullet graph) affichent les données ajoutées après un rechargement de la page, sans rien changer à leur code.
- Les visualisations qui préparent leurs données avec un script (Python, Node) doivent relancer ce script après un ajout :
  voir ci-dessous.

### Brancher sa visualisation (`admin/datasets.js`)

**Relancer un script après chaque changement des feux** : ajouter une commande dans `afterChange` du dataset `fires`.
La console affiche son résultat et ce qu'elle a écrit. La commande est un programme et ses arguments, lancés dans `folder` :

```js
afterChange: [
    { label: 'Bubble map data', command: 'node', args: ['scripts/prepare-data.mjs'], folder: '.' },
    { label: 'Heatmap pipeline', command: 'python', args: ['pipeline.py'], folder: 'public/heatmap/pipeline' }
]
```

Le script doit lire `public/data/fires-current.csv` pour utiliser les données ajoutées.

**Gérer un autre dataset depuis la console** (par exemple des données externes, pour ajouter les coûts de 2023) :
ajouter une entrée à la liste de `admin/datasets.js`. La console affiche alors une carte de plus pour ce dataset,
avec les mêmes boutons (ajouter un fichier, retirer, revenir à l'origine). Exemple pour les coûts de la heatmap :

```js
{
    id: 'costs',
    label: 'Fire suppression costs (heatmap)',
    original: 'public/heatmap/pipeline/oregon_fire_costs_by_county_month.csv', // le fichier d'aujourd'hui, jamais modifié
    additions: 'data/additions/costs',                                        // les fichiers ajoutés (pas dans git)
    current: 'public/heatmap/pipeline/costs-current.csv',                     // origine + ajouts, construit par le serveur
    key: ['year', 'month', 'county'],   // ce qui identifie une ligne : une colonne, ou plusieurs
    year: 'year',                       // la colonne des années (pour résumer le contenu des fichiers)
    required: ['year', 'month', 'county', 'suppression_cost_usd'], // un fichier sans ces colonnes est refusé
    usedBy: [{ label: 'Heatmap', url: '/heatmap/' }],
    afterChange: []                     // les commandes à relancer après un ajout
}
```

Si une ligne ajoutée a la même clé qu'une ligne existante, elle la remplace. Avec une colonne de date de mise à jour
(`newest` et `dateFormat`, comme pour les feux), c'est la version la plus récente qui est gardée.
