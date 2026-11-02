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

La page charge le thème commun (`css/theme.css`), les adaptations de la carte
(`css/style.css`), puis les styles d'accessibilité (`css/accessibility.css`).
Les couleurs d'interface et de données utilisent les variables CSS du thème.
Les classes de taille A à G suivent la gamme ColorBrewer Oranges dans les deux
palettes ; les casernes sont des carrés bleus dont la couleur suit la palette.

Le bouton **Accessibilité**, également accessible avec **Alt+A**, propose le
contraste renforcé, un grand curseur, une palette adaptée au daltonisme et trois
tailles de texte (100 %, 125 %, 150 %). **Échap**, le bouton de fermeture ou un
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
  data/fire-occurence.csv     dataset brut, à ne pas modifier (23 490 feux, 38 colonnes)
  data/fires-bubble-map.csv   dataset allégé généré pour la bubble map
  data/fire-stations.csv      casernes opérationnelles générées pour la carte
  data/unit-station-candidates.csv  correspondances UnitName–caserne examinées
  data/unit-station-mapping.csv     correspondances validées utilisées par la carte
  data/fire-station-links.csv       liaisons estimées entre feux et casernes
  js/fireData.js              première transformation des données, commune à toutes les visualisations
```

Le plan de réalisation et les conventions de données sont documentés dans
[`docs/guide-technique.md`](docs/guide-technique.md).

## Première transformation (`js/fireData.js`)

`loadFires(url)` charge un fichier csv et renvoie un tableau de feux. Sans paramètre, le dataset par défaut est chargé

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


Les colonnes gardent le nom qu'elles ont dans le csv

| Colonnes | Conversion | Cellule vide |
|---|---|---|
| `Serial`, `FireYear`, `EstTotalAcres`, `Protected_Acres`, `Lat_DD`, `Long_DD` | nombre | `null` |
| `Ign_DateTime`, `ReportDateTime`, `Discover_DateTime`, `Control_DateTime`, `CreationDate`, `ModifiedDate` | `Date` | `null` |
| `Area`, `DistrictName`, `UnitName`, `Size_class`, `HumanOrLightning`, `CauseBy`, `GeneralCause`, `SpecificCause`, `FO_LandOwnType`, `County`, `RegUseZone`, `RegUseRestriction`, `Industrial_Restriction` | texte (catégorie) | `"Unspecified"` |
| les autres (noms, codes, commentaires) | texte | `null` |
| `FireCategory` | supprimée : même valeur pour tous les feux | |
