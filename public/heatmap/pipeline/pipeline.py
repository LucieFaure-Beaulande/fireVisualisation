import pandas as pd
import numpy as np
import os

print("1. Chargement et nettoyage du dataset principal des feux...")
fires_df = pd.read_csv("fire-occurence.csv")

# Nettoyage et conversion des dates
fires_df['Discover_DateTime'] = pd.to_datetime(fires_df['Discover_DateTime'], errors='coerce')
fires_df['Year'] = fires_df['Discover_DateTime'].dt.year
fires_df['Month'] = fires_df['Discover_DateTime'].dt.month

# Standardisation du nom des comtés
fires_df['County'] = (
    fires_df['County']
    .astype(str)
    .str.replace(r"\s+County$", "", regex=True, case=False)
    .str.strip()
    .str.title()
)

fires_df = fires_df.dropna(subset=['Year', 'Month', 'County'])
fires_df['EstTotalAcres'] = pd.to_numeric(fires_df['EstTotalAcres'], errors='coerce').fillna(0)

# Public vs private land, from FO_LandOwnType.
# Consistent with the public land area per county (surface-admin-publique.py, PAD-US):
#   - public          = federal (USFS, BLM, NPS), state, county, municipal, other public agency
#   - private / other = private owners + tribal land (BIA, not "public" in PAD-US) + unspecified owner
# land_owner keeps the original FO_LandOwnType value (shown in the tooltips).
# The values of the dataset are kept in English; empty cells become 'Unspecified' (as in public/js/fireData.js).
UNKNOWN = 'Unspecified'
PRIVATE = 'Private / Other'
PUBLIC_OWNERS = {'USFS', 'BLM', 'NPS', 'State', 'County', 'Municipal', 'Other Public', 'Ocean Shores'}

def clean_text(col):
    """Strip the spaces of a text column; empty cells become 'Unspecified'."""
    if col not in fires_df.columns:
        return pd.Series(UNKNOWN, index=fires_df.index)
    s = fires_df[col].astype('string').str.strip().str.replace(r"\s+", " ", regex=True)
    return s.replace({'': pd.NA}).fillna(UNKNOWN).astype(str)

fires_df['land_owner'] = clean_text('FO_LandOwnType')
fires_df['land_category'] = fires_df['land_owner'].map(lambda x: 'Public' if x in PUBLIC_OWNERS else PRIVATE)

# Cause hierarchy: origin (Human / Lightning) > general cause > specific cause
fires_df['cause_category'] = clean_text('HumanOrLightning')
fires_df['general_cause'] = clean_text('GeneralCause')
fires_df['specific_cause'] = clean_text('SpecificCause')

# Fire name (shown in the tooltips of the detail view)
if 'FireName' in fires_df.columns:
    fires_df['FireName'] = fires_df['FireName'].astype('string').str.strip().fillna('Unnamed').astype(str)
else:
    fires_df['FireName'] = 'Unnamed'

# Agrégation de base par Year, Month, County pour la Heatmap
fires_agg = fires_df.groupby(['Year', 'Month', 'County'], as_index=False).agg(
    fire_count=('Serial', 'count'),
    total_acres=('EstTotalAcres', 'sum')
)

# Surface brûlée publique vs privée par (Year, Month, County)
burned_land = fires_df.groupby(['Year', 'Month', 'County', 'land_category'], as_index=False)['EstTotalAcres'].sum()
burned_pivot = burned_land.pivot_table(index=['Year', 'Month', 'County'], columns='land_category', values='EstTotalAcres', fill_value=0).reset_index()
if 'Public' not in burned_pivot.columns: burned_pivot['Public'] = 0
if PRIVATE not in burned_pivot.columns: burned_pivot[PRIVATE] = 0

burned_pivot.rename(columns={'Public': 'burned_acres_public', PRIVATE: 'burned_acres_private'}, inplace=True)
fires_agg = pd.merge(fires_agg, burned_pivot, on=['Year', 'Month', 'County'], how='left')

# Calcul du pourcentage de surface brûlée sur terrains publics par rapport à la surface totale brûlée du mois/comté
fires_agg['public_burned_pct'] = np.where(
    fires_agg['total_acres'] > 0,
    (fires_agg['burned_acres_public'] / fires_agg['total_acres']) * 100,
    0
)

print("2. Intégration des coûts...")
try:
    costs_df = pd.read_csv("oregon_fire_costs_by_county_month.csv")
    costs_df['County'] = costs_df['county'].astype(str).str.replace(r"\s+County$", "", regex=True, case=False).str.strip().str.title()
    costs_agg = costs_df.groupby(['year', 'month', 'County'], as_index=False)['suppression_cost_usd'].sum()
    costs_agg.rename(columns={'year': 'Year', 'month': 'Month'}, inplace=True)
    fires_agg = pd.merge(fires_agg, costs_agg, on=['Year', 'Month', 'County'], how='left')
except FileNotFoundError:
    fires_agg['suppression_cost_usd'] = np.nan

print("3. Intégration des sentiers (cumul de tous les modes)...")
try:
    trails_df = pd.read_csv("oregon_hiking_paths_by_county_month.csv")
    month_map = {'January': 1, 'February': 2, 'March': 3, 'April': 4, 'May': 5, 'June': 6,
                 'July': 7, 'August': 8, 'September': 9, 'October': 10, 'November': 11, 'December': 12}
    if 'Mois' in trails_df.columns:
        trails_df['Month'] = trails_df['Mois'].map(month_map)
    trails_df['County'] = trails_df['County'].astype(str).str.replace(r"\s+County$", "", regex=True, case=False).str.strip().str.title()
    
    fermes_cols = [c for c in trails_df.columns if 'Fermes' in c]
    ouverts_cols = [c for c in trails_df.columns if 'Ouverts' in c]
    trails_df['max_fermes'] = trails_df[fermes_cols].max(axis=1)
    
    trails_agg = trails_df.groupby(['County', 'Month'], as_index=False).agg(
        total_sentiers=('Total_Sentiers', 'sum'),
        total_fermes=('max_fermes', 'sum')
    )
    trails_agg['total_ouverts'] = trails_agg['total_sentiers'] - trails_agg['total_fermes']
    fires_agg = pd.merge(fires_agg, trails_agg, on=['County', 'Month'], how='left')
except FileNotFoundError:
    pass

# Export du CSV final pour la heatmap
fires_agg.to_csv("./final_heatmap_data.csv", index=False)

# Export détaillé des feux individuels (pour le Parallel Sets au clic)
# Axes : County, Year, Month, land_category (foncier) + land_owner (gestionnaire) + hiérarchie des causes
# (cause_category > general_cause > specific_cause) + FireName et EstTotalAcres
detail_fires = fires_df[[
    'Year', 'Month', 'County', 'FireName', 'land_category', 'land_owner',
    'cause_category', 'general_cause', 'specific_cause', 'EstTotalAcres'
]].copy()
detail_fires['Year'] = detail_fires['Year'].astype(int)
detail_fires['Month'] = detail_fires['Month'].astype(int)
detail_fires.to_json("./fires_detail_parallel.json", orient='records', force_ascii=False)

print("Pipeline complète exécutée avec succès !")