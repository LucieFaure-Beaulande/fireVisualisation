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
La durée est arrondie à la minute ; les valeurs nulles, négatives ou non
calculables sont indisponibles. Elle n'est pas encodée par la largeur des liens.

## Lentille fisheye

Lorsque le fisheye est activé, une pause du curseur de 700 ms déclenche une
ouverture progressive de 400 ms. Les districts, feux, casernes et extrémités
des liaisons suivent la même déformation, dans un rayon de 115 unités SVG.
La périphérie de la lentille s'atténue progressivement et l'extérieur conserve
30 % de sa visibilité. La légende et les commandes restent lisibles.

Les petits mouvements sont tolérés jusqu'à 8 pixels écran par rapport au
point d'ancrage. Au-delà, la lentille se ferme en 200 ms et une nouvelle
attente commence. Le bouton de désactivation et le changement d'année
réinitialisent immédiatement la vue. Les coordonnées des jeux de données
ne sont pas modifiées.

Le feu le plus agrandi affiche progressivement son nom, sa caserne associée
et la durée avant maîtrise. Les infobulles restent disponibles.

## Vue rapprochée

Après la stabilisation du fisheye, une seconde supplémentaire d'immobilité
déclenche une vue rapprochée ×3. Un anneau indique cette seconde attente.
Le rapprochement commence vers 2,1 secondes et se termine vers 2,6 secondes
après le début de l'immobilité. Pendant la transition de 500 ms, la déformation
et l'atténuation du fisheye disparaissent progressivement, puis la carte garde
ses formes géographiques normales.

La vue rapprochée reste fixe quand la souris se déplace ou quitte la carte,
ce qui permet de consulter les infobulles. Les bulles sont limitées à ×2 de
leur rayon initial et les casernes à ×1,5 de leur taille initiale. Les
liaisons restent attachées à leurs extrémités. La légende reste fixe.

Le bouton « Revenir à la carte » ou Échap restaure la vue d'ensemble en
400 ms, même au milieu du rapprochement. Une nouvelle exploration nécessite
un nouveau déplacement ou une nouvelle entrée du curseur. La désactivation
du fisheye et le changement d'année restaurent immédiatement la carte.

Les préférences système de réduction des animations sont respectées : les
deux délais sont conservés, l'anneau reste statique et les changements de vue
sont appliqués directement.

## Limite

La liaison représente une caserne pertinente et proche. Elle ne constitue pas
une preuve que cette caserne a réellement été mobilisée ni son itinéraire.
La durée représente l'intervalle entre la découverte et la maîtrise du feu, et
non un temps de trajet de la caserne.
Le fuseau horaire des dates sources n'est pas documenté. Le calcul ne permet
pas d'affirmer une correction des changements d'heure.
