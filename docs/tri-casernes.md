# Tri des casernes

## Objectif

La carte n'affiche pas toutes les casernes de l'Oregon. Elle conserve seulement
celles qui sont pertinentes pour les unités présentes dans le jeu de données
des incendies.

## Règle de validation

Une caserne est retenue si :

1. le nom de l'unité (`UnitName`) apparaît dans le nom de la caserne ou de son
   agence ;
2. le comté de la caserne apparaît parmi les comtés des incendies de cette
   unité.

Un candidat qui ne respecte pas le second critère est rejeté. Une unité sans
candidat est conservée dans la table des candidats avec le statut `Sans candidat`.

## Fichiers générés

- `unit-station-candidates.csv` contient toutes les correspondances examinées,
  leur statut et la raison de la décision.
- `unit-station-mapping.csv` contient uniquement les correspondances validées.
  C'est ce fichier que la carte utilise pour filtrer les casernes.

La sélection indique une proximité nominale et territoriale. Elle ne prouve pas
qu'une caserne est intervenue sur un incendie précis.
