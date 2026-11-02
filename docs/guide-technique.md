# Guide technique — Carte des incendies de l'Oregon

## 1. État du projet

Le projet contient un serveur Express, D3.js 7 et un jeu d'incendies déjà rendu
accessible au navigateur. La Bubble Map est accessible sous `/bubblemap/`, depuis
l'accueil commun aux quatre visualisations.

| Élément | État | Rôle |
| --- | --- | --- |
| `server.js` | Disponible | Sert `public/` et D3 local sous `/lib/d3.min.js`. |
| `public/data/fire-occurence.csv` | Disponible | Source des 23 490 incendies, de 2000 à 2022. |
| `public/js/fireData.js` | Disponible | Charge et convertit les colonnes du CSV. |
| `data/OR_Fire_Stations_*.xlsx` | Préparé par le script | Source des exports de casernes ; le tableur reste privé au serveur. |
| `data/Congressional_Districts.geojson` | Disponible via le serveur | Fond cartographique des six districts de l'Oregon. |
| `public/bubblemap/app.js` | Disponible | Bubble map annuelle, casernes, liens estimés et fisheye. |

La carte charge explicitement l'export allégé `/data/fires-bubble-map.csv`, les
exports des casernes et de leurs liens, puis le GeoJSON des districts. Les autres
visualisations gardent le CSV complet par défaut via le chargeur commun.

## 2. Données et règles d'interprétation

### Incendies

La source disponible fournit :

- `Serial` : identifiant unique du feu ;
- `FireYear` : année du feu ;
- `Lat_DD` et `Long_DD` : latitude et longitude ;
- `EstTotalAcres` : superficie estimée ;
- `Size_class` : classe de taille A à G ;
- `Discover_DateTime` et `Control_DateTime` : découverte et maîtrise ;
- nom, cause, district, unité et comté pour les détails.

Une bulle n'est rendue que si `Serial`, `FireYear`, les coordonnées et
`EstTotalAcres` sont disponibles. Son rayon dépend de `EstTotalAcres` et sa
couleur de `Size_class`. Cette classe doit être présentée comme une **classe de
taille**, pas comme une sévérité indépendante.

### Casernes

Le fichier Excel des casernes contient notamment `OBJECTID`, `Agency`,
`Station`, `Facility_Type`, `County`, `x` et `y`. Utiliser `OBJECTID` comme
identifiant, `x` comme longitude et `y` comme latitude.

Ne retenir pour le rendu des stations opérationnelles que les types incluant
`Fire Station`, `Federal Fire Facility` ou `State Fire Facility`. Les sites
administratifs, de formation et de maintenance ne doivent pas produire de liens.

### Districts

Le GeoJSON contient six polygones de districts électoraux dans un repère
longitude/latitude compatible avec les deux autres sources. Il fournit un fond
territorial et un contexte visuel, mais il ne constitue pas une limite historique
spécifique à chaque année des incendies.

### Durée estimée entre découverte et maîtrise

En l'absence de temps d'intervention des services de secours, calculer :

```js
estimatedControlHours = (controlDateTime - discoverDateTime) / 3_600_000;
```

Conserver la valeur seulement si les deux dates sont valides et si la durée est
strictement positive. Cette mesure décrit la durée estimée de gestion du feu
entre sa découverte et sa maîtrise. Elle ne mesure ni le délai d'alerte ni le
temps de trajet d'une caserne.

La légende doit employer le libellé : **« Durée estimée entre découverte et
maîtrise »**. Toute ligne de liaison utilisant cette durée doit être décrite de
la même façon.

## 3. Architecture cible

```text
public/
  index.html                 Accueil et liens vers les quatre visualisations
  bubblemap/index.html       Interface et contrôles de la carte
  bubblemap/style.css        Styles limités à la carte
  bubblemap/app.js           Rendu D3 et interactions
  bubblemap/fisheye-controller.js  Contrôleur du fisheye
  css/, js/                  Thème, accessibilité et palette partagés
  data/fire-occurence.csv    Source des incendies
  data/fires-bubble-map.csv   Incendies filtrés pour la carte
  data/fire-stations.csv     Casernes préparées
  data/fire-station-links.csv Liaisons estimées
  data/unit-station-mapping.csv Correspondances validées
  js/fireData.js             Chargement et conversion du CSV
scripts/
  prepare-data.mjs           Prépare les CSV avec filtrage territorial
```

La page de la carte charge D3 via `/lib/d3.min.js`, puis `/js/fireData.js`,
avant `/bubblemap/app.js`. Elle appelle `loadFires('/data/fires-bubble-map.csv')`.
Le serveur expose `/data/districts.geojson` depuis le GeoJSON source, sans copie.

## 4. Ordre de réalisation

### Étape 1 — Préparer les données complémentaires

1. Convertir le tableur de casernes en `public/data/fire-stations.csv`.
2. Filtrer les installations retenues et normaliser leurs propriétés : `id`,
   `agency`, `station`, `type`, `county`, `longitude`, `latitude`.
3. Servir le GeoJSON sous `/data/districts.geojson` et l'utiliser pour filtrer l'export des feux.
4. Charger les incendies via `loadFires('/data/fires-bubble-map.csv')`, les
   casernes via `d3.csv()` et les districts via `d3.json()`.

### Étape 2 — Construire la bubble map annuelle

1. Créer une projection `d3.geoMercator()` ajustée avec `projection.fitExtent()`
   sur les districts.
2. Dessiner les districts dans `districts-layer`.
3. Créer une échelle `d3.scaleSqrt()` à partir de `EstTotalAcres` pour le rayon.
4. Créer une échelle ordinale A → G pour la couleur des classes de taille.
5. Ajouter un sélecteur d'année de 2000 à 2022.
6. À chaque changement d'année, filtrer les feux et réaliser une jointure D3
   identifiée par `Serial`, avec une transition courte.

### Étape 3 — Afficher les casernes

1. Projeter les coordonnées normalisées des casernes.
2. Les rendre dans `stations-layer`, avec un symbole distinct des feux.
3. Afficher agence, station, comté et type dans une infobulle.
4. Prévoir une légende distincte pour les feux et les casernes.

### Étape 4 — Ajouter les liens estimés

Le jeu de données ne contient pas d'association attestée entre une caserne et
un incendie. Pour une démonstration spatiale, le projet peut relier un feu à la
caserne opérationnelle géographiquement la plus proche.

Chaque lien estimé contient :

```js
{
  fireId,
  stationId,
  distanceKm,
  estimatedControlHours
}
```

Ne montrer ces liens qu'au survol ou pour le feu sélectionné : afficher une ligne
pour chaque feu simultanément rendrait la carte illisible. La largeur peut être
proportionnelle à `estimatedControlHours`, avec une échelle racine carrée, mais
ne doit jamais être nommée « temps d'intervention ».

La caserne la plus proche est une approximation de proximité. Le fichier de
casernes est contemporain de 2020–2022, alors que les feux couvrent 2000–2022 ;
il ne permet donc pas d'affirmer qu'une station était active à la date d'un feu.

### Étape 5 — Ajouter le fisheye et les détails

1. Conserver pour chaque élément ses coordonnées projetées d'origine.
2. Au mouvement de la souris, appliquer une déformation radiale aux feux, aux
   casernes et aux deux extrémités du lien sélectionné.
3. Traiter le cas où la distance au foyer vaut zéro afin d'éviter une division
   par zéro.
4. Au-delà d'un facteur d'agrandissement défini, afficher une étiquette détaillée
   ou l'infobulle complète.
5. Réinitialiser les positions à la sortie de la carte.

## 5. Couches SVG et ordre d'affichage

```js
const layers = {
  districts: svg.append('g').attr('class', 'districts-layer'),
  links: svg.append('g').attr('class', 'links-layer'),
  stations: svg.append('g').attr('class', 'stations-layer'),
  fires: svg.append('g').attr('class', 'fires-layer')
};
```

Les liens restent sous les stations et les bulles. Les districts restent en fond.

## 6. Contrôles qualité avant livraison

- Rejeter les coordonnées ou superficies absentes avant le rendu.
- Rejeter les durées négatives, nulles ou calculées à partir de dates absentes.
- Vérifier que chaque changement d'année supprime les éléments de l'année
  précédente.
- Vérifier que les feux, les casernes et les districts partagent la même
  projection.
- Afficher clairement les unités : acres, kilomètres et heures.
- Distinguer visuellement les mesures observées des estimations.
