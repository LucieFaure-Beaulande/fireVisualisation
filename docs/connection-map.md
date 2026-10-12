# Connection map : feux et casernes

## Données utilisées

- Feu : `Serial`, `FireYear`, `UnitName`, latitude et longitude.
- Caserne : identifiant, nom, agence, latitude et longitude.
- Correspondance validée : `UnitName` et `StationId`.

## Construction des liaisons

Pour chaque feu, le script recherche les casernes validées de la même
`UnitName` et retient celle dont la distance géographique est la plus faible.
La distance est calculée à vol d'oiseau en kilomètres.

Le fichier `fire-station-links.csv` contient une ligne par liaison, avec les
coordonnées des deux extrémités, la distance, `Discover_DateTime`,
`Control_DateTime` et la durée calculée entre ces deux dates. Sur la carte, une
courbe relie la caserne au feu pour l'année sélectionnée ; son infobulle
affiche le temps avant maîtrise lorsqu'il est disponible.

## Lentille fisheye

Le déplacement de la souris applique une lentille locale à l'affichage : les
districts, feux, casernes et extrémités des liaisons proches du curseur sont
écartés et agrandis. Les coordonnées des jeux de données ne sont pas modifiées.
À la sortie de la carte, l'affichage revient à sa géographie initiale. Le feu
le plus agrandi affiche temporairement son nom, sa caserne associée et la durée
avant maîtrise.

## Limite

La liaison représente une caserne pertinente et proche. Elle ne constitue pas
une preuve que cette caserne a réellement été mobilisée ni son itinéraire.
La durée représente l'intervalle entre la découverte et la maîtrise du feu, et
non un temps de trajet de la caserne.
