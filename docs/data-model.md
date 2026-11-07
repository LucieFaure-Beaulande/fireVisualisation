# Modèle de données de visualisation

## `fires-bubble-map.csv`

Le CSV allégé de la première étape conserve : `Serial`, `FireYear`, `FireName`,
`UnitName`, `DistrictName`, `County`, `Lat_DD`, `Long_DD`, `EstTotalAcres`,
`Size_class`, `Discover_DateTime` et `Control_DateTime`.

Les deux dates restent sous leur forme source. Une étape ultérieure pourra
calculer la durée uniquement quand elles sont valides et que `Control_DateTime`
est postérieure à `Discover_DateTime`.

## `fire-stations.csv`

Le CSV des casernes opérationnelles contient `StationId`, `Agency`, `Station`,
`FacilityType`, `County`, `Longitude` et `Latitude`. Il est séparé des incendies
pour éviter de dupliquer une caserne sur chaque feu.

## `unit-station-candidates.csv`

Cette table contient les candidats de correspondance entre une `UnitName` et une
caserne. `CountyMatchesUnit` constitue un contrôle géographique simple.
Une ligne est `Validée` si le nom correspond et si son comté apparaît dans les
feux de cette unité. Une ligne est `Rejetée` si le comté ne correspond pas.

## `unit-station-mapping.csv`

Cette table ne contient que les correspondances validées. La carte l'utilise
pour filtrer les casernes affichées. Cette validation désigne une pertinence
territoriale, non une intervention historique attestée.

## `fire-station-links.csv`

Cette table contient une liaison par feu lorsqu'une caserne validée existe pour
sa `UnitName`. Elle garde les coordonnées du feu et de la caserne, la distance
à vol d'oiseau (`DistanceKm`) et la méthode de sélection. La caserne retenue
est la plus proche parmi les casernes validées de la même unité. La liaison est
une estimation de proximité, non une preuve d'intervention ou un itinéraire.
`Discover_DateTime` et `Control_DateTime` sont conservés ;
`ControlDurationMinutes` et `ControlDurationHours` mesurent leur écart lorsque
les deux dates sont valides et chronologiques.
La durée est arrondie à la minute et renseignée uniquement si cette valeur est
strictement positive. Sinon les deux champs restent vides, sans supprimer la
liaison. Le fuseau source n'étant pas documenté, aucune correction de changement
d'heure n'est affirmée.

## `districts.geojson`

Le fond des districts électoraux de l'Oregon, conservé au format GeoJSON.

## Liens estimés

Lorsqu'ils seront préparés, les liens doivent contenir `fireId`, `stationId`,
`distanceKm` et `estimatedControlHours`. Ils représentent la caserne la plus
proche et non une intervention historique attestée.
