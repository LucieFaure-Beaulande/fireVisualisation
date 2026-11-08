# USFS trails per Oregon county and calendar month (data/heatmap/hiking-trails.csv)
# Source: USFS "National Forest System Trails" geodatabase, downloaded in data/heatmap/raw/
# The inventory has no year: a trail is closed a month when one of its seasonal restrictions covers it.
# The column names (Mois, Total_Sentiers, Total_Fermes_*...) are read by scripts/prepare-heatmap.mjs.
#
# USAGE
#   pip install -r requirements.txt
#   python hiking_trails.py

import geopandas as gpd
import pandas as pd
import numpy as np
import re

# 1. The 36 counties of Oregon
print("1/5. Loading the 36 counties of Oregon...")
counties_url = "https://www2.census.gov/geo/tiger/TIGER2023/COUNTY/tl_2023_us_county.zip"
counties_gdf = gpd.read_file(counties_url)
oregon_counties = counties_gdf[counties_gdf['STATEFP'] == '41'][['NAME', 'geometry']].copy()
oregon_counties.rename(columns={'NAME': 'County'}, inplace=True)

# 2. The USFS trails
print("2/5. Loading the USFS trails...")
gdb_path = "../../data/heatmap/raw/S_USA.TrailNFS_Publish.gdb"
trails_gdf = gpd.read_file(gdb_path)

# Projection: Oregon Lambert (EPSG:2992)
target_crs = "EPSG:2992"
oregon_counties = oregon_counties.to_crs(target_crs)
trails_gdf = trails_gdf.to_crs(target_crs)

# 3. Spatial join trails <-> counties
print("3/5. Linking the trails to the counties...")
trails_centroids = trails_gdf.copy()
trails_centroids['geometry'] = trails_gdf.geometry.centroid

joined = gpd.sjoin(trails_centroids, oregon_counties, how="inner", predicate="intersects")
print(f"Trails linked to a county: {len(joined)}")

# 4. Restriction periods (MM/DD-MM/DD)
def is_restricted(val, month):
    """
    True when the trail is restricted during the month (1 to 12).
    """
    if pd.isna(val) or str(val).strip() in ['N/A', '', 'None']:
        return False
    
    s = str(val).strip()
    
    # period MM/DD-MM/DD
    match = re.search(r'(\d{2})/(\d{2})-(\d{2})/(\d{2})', s)
    if match:
        m_start = int(match.group(1))
        m_end = int(match.group(3))
        
        # period inside one year (e.g. 05/15 to 08/20)
        if m_start <= m_end:
            return m_start <= month <= m_end
        # period over two years (e.g. 11/15 to 05/15)
        else:
            return month >= m_start or month <= m_end
            
    if '01/01-12/31' in s:
        return True
        
    return False

# 5. The modes of travel
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

print("4/5. Closed and open trails per month and mode of travel...")

all_rows = []

# one row per county and month
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
            # county without USFS trails
            for mode_label in MODES.keys():
                row[f'Total_Ouverts_{mode_label}'] = 0
                row[f'Total_Fermes_{mode_label}'] = 0
        else:
            for mode_label, col_name in MODES.items():
                if col_name in county_trails.columns:
                    # closed / restricted this month
                    is_closed_series = county_trails[col_name].apply(lambda val: is_restricted(val, m_num))
                    fermes = int(is_closed_series.sum())
                    ouverts = total_sentiers - fermes
                else:
                    fermes = 0
                    ouverts = total_sentiers
                
                row[f'Total_Ouverts_{mode_label}'] = ouverts
                row[f'Total_Fermes_{mode_label}'] = fermes
                
        all_rows.append(row)

# 6. Final table
df_final = pd.DataFrame(all_rows)

output_csv = "../../data/heatmap/hiking-trails.csv"
df_final.to_csv(output_csv, index=False)

print(f"\n5/5. Done, file written: {output_csv}")
print("\nFirst rows:")
print(df_final.head(12).to_string())