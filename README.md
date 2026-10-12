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

Enfin, `fire-station-links.csv` relie chaque feu à la caserne validée la plus
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
