import geopandas as gpd
import pandas as pd
import numpy as np
import re

# 1. Chargement des comtés de l'Oregon
print("1/5. Chargement des 36 comtés de l'Oregon...")
counties_url = "https://www2.census.gov/geo/tiger/TIGER2023/COUNTY/tl_2023_us_county.zip"
counties_gdf = gpd.read_file(counties_url)
oregon_counties = counties_gdf[counties_gdf['STATEFP'] == '41'][['NAME', 'geometry']].copy()
oregon_counties.rename(columns={'NAME': 'County'}, inplace=True)

# 2. Chargement de la base des sentiers USFS
print("2/5. Chargement des sentiers USFS...")
gdb_path = "./S_USA.TrailNFS_Publish.gdb"
trails_gdf = gpd.read_file(gdb_path)

# Reprojection en Oregon Lambert (EPSG:2992)
target_crs = "EPSG:2992"
oregon_counties = oregon_counties.to_crs(target_crs)
trails_gdf = trails_gdf.to_crs(target_crs)

# 3. Jointure spatiale sentiers <-> comtés
print("3/5. Association des sentiers aux comtés...")
trails_centroids = trails_gdf.copy()
trails_centroids['geometry'] = trails_gdf.geometry.centroid

# Jointure spatiale
joined = gpd.sjoin(trails_centroids, oregon_counties, how="inner", predicate="intersects")
print(f"Total sentiers rattachés : {len(joined)}")

# 4. Fonction d'évaluation des plages de restriction (MM/DD-MM/DD)
def is_restricted(val, month):
    """
    Retourne True si le sentier est restreint/fermé durant le mois spécifié (1 à 12).
    """
    if pd.isna(val) or str(val).strip() in ['N/A', '', 'None']:
        return False
    
    s = str(val).strip()
    
    # Extraction de la plage MM/DD-MM/DD
    match = re.search(r'(\d{2})/(\d{2})-(\d{2})/(\d{2})', s)
    if match:
        m_start = int(match.group(1))
        m_end = int(match.group(3))
        
        # Plage dans la même année (ex: 05/15 à 08/20)
        if m_start <= m_end:
            return m_start <= month <= m_end
        # Plage à cheval sur deux années (ex: 11/15 à 05/15)
        else:
            return month >= m_start or month <= m_end
            
    if '01/01-12/31' in s:
        return True
        
    return False

# 5. Définition des modes de transport à analyser
# Vous pouvez en ajouter ou en retirer selon votre besoin
MODES = {
    'Hiker': 'HIKER_PEDESTRIAN_RESTRICTED',
    'Bicycle': 'BICYCLE_RESTRICTED',
    'Motorcycle': 'MOTORCYCLE_RESTRICTED',
    'ATV': 'ATV_RESTRICTED',
    'FourWD': 'FOURWD_RESTRICTED'
}

months = [
    (1, 'January'), (2, 'February'), (3, 'March'), (4, 'April'),
    (5, 'May'), (6, 'June'), (7, 'July'), (8, 'August'),
    (9, 'September'), (10, 'October'), (11, 'November'), (12, 'December')
]

print("4/5. Calcul des fermetures/ouvertures par mois et par mode de transport...")

all_rows = []

# Création du produit cartésien Comtés x Mois
counties_list = sorted(oregon_counties['County'].unique())

for county in counties_list:
    county_trails = joined[joined['County'] == county]
    total_sentiers = len(county_trails)
    
    for m_num, m_name in months:
        row = {
            'County': county,
            'Mois': m_name,
            'Total_Sentiers': total_sentiers
        }
        
        if total_sentiers == 0:
            # Comté sans sentiers USFS
            for mode_label in MODES.keys():
                row[f'Total_Ouverts_{mode_label}'] = 0
                row[f'Total_Fermes_{mode_label}'] = 0
        else:
            for mode_label, col_name in MODES.items():
                if col_name in county_trails.columns:
                    # Évaluation si fermé/restreint pour ce mois
                    is_closed_series = county_trails[col_name].apply(lambda val: is_restricted(val, m_num))
                    fermes = int(is_closed_series.sum())
                    ouverts = total_sentiers - fermes
                else:
                    fermes = 0
                    ouverts = total_sentiers
                
                row[f'Total_Ouverts_{mode_label}'] = ouverts
                row[f'Total_Fermes_{mode_label}'] = fermes
                
        all_rows.append(row)

# 6. Structuration du dataframe final
df_final = pd.DataFrame(all_rows)

# Sauvegarde au format CSV
output_csv = "../pipeline/oregon_hiking_paths_by_county_month.csv"
df_final.to_csv(output_csv, index=False)

print(f"\n5/5. Analyse terminée ! Fichier exporté : {output_csv}")
print("\nStructure des premières lignes :")
print(df_final.head(12).to_string())