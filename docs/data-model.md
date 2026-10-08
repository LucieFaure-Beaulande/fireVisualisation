# Modèle de données de visualisation

## `fires.json`

Un tableau contenant au minimum : `id`, `year`, `name`, `latitude`, `longitude`,
`acres`, `sizeClass`, `discoverDateTime`, `controlDateTime` et
`estimatedControlHours`.

## `stations.json`

Un tableau de casernes opérationnelles : `id`, `agency`, `station`, `type`,
`county`, `latitude` et `longitude`.

## `districts.geojson`

Le fond des districts électoraux de l'Oregon, conservé au format GeoJSON.

## Liens estimés

Lorsqu'ils seront préparés, les liens doivent contenir `fireId`, `stationId`,
`distanceKm` et `estimatedControlHours`. Ils représentent la caserne la plus
proche et non une intervention historique attestée.
