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
  data/fire-occurence.csv     dataset brut, à ne pas modifier (23 490 feux, 38 colonnes)
  js/fireData.js              première transformation des données
  js/theme.js                 chargement du style commum, à utiliser si on le souhaite dans nos pages
  css/theme.css               style commun, à charger si on le souhaite : police, couleurs de la page, composants
  sunburst/                   sunburst des causes des incendies
  bulletgraph/                bullet graph des totaux de feux et de surface brûlées sur toutes les années, avec causes et médianes
```

Chaque visualisation a son dossier dans `public/`, qui contient tous ses fichiers

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

