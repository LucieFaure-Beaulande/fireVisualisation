from pathlib import Path
import io
import zipfile

import geopandas as gpd
import pandas as pd
import requests


# --------------------------------------------------
# CONFIGURATION
# --------------------------------------------------

OUTPUT_DIR = Path("../pipeline")
OUTPUT_DIR.mkdir(exist_ok=True)

OUTPUT_CSV = OUTPUT_DIR / "oregon_public_land_by_county.csv"

YEAR = 2025

# USGS PAD-US 4.1 : couche Fee (propriété foncière)
PADUS_URL = (
    "https://edits.nationalmap.gov/arcgis/rest/services/"
    "PAD-US/PAD_US_4_1/MapServer/0/query"
)

# Projection métrique adaptée aux calculs de superficie
AREA_CRS = "EPSG:5070"

ACRES_PER_KM2 = 247.105381


def download_counties():
    """Télécharge et charge les limites des comtés de l'Oregon."""

    print("Téléchargement des comtés...")

    urls = [
        "https://www2.census.gov/geo/tiger/TIGER2025/"
        "COUNTY/tl_2025_us_county.zip",
        "https://www2.census.gov/geo/tiger/TIGER2024/"
        "COUNTY/tl_2024_us_county.zip",
    ]

    extract_dir = OUTPUT_DIR / "counties"
    extract_dir.mkdir(parents=True, exist_ok=True)

    counties = None

    for url in urls:
        try:
            print(f"Essai : {url}")

            response = requests.get(url, timeout=180)
            response.raise_for_status()

            # Extraire l'archive ZIP sur le disque.
            with zipfile.ZipFile(
                io.BytesIO(response.content)
            ) as archive:
                archive.extractall(extract_dir)

            # Trouver le Shapefile extrait.
            shp_files = list(extract_dir.rglob("*.shp"))

            if not shp_files:
                raise RuntimeError(
                    "Aucun fichier .shp trouvé dans l'archive."
                )

            # Lire le fichier local avec GeoPandas.
            counties = gpd.read_file(shp_files[0])
            print("Fichier géographique chargé.")
            break

        except Exception as e:
            print(f"Échec : {e}")
            counties = None

    if counties is None:
        raise RuntimeError(
            "Impossible de télécharger ou lire les comtés."
        )

    # Oregon : code FIPS 41
    counties = counties[
        counties["STATEFP"].astype(str) == "41"
    ].copy()

    counties = counties[
        ["GEOID", "NAME", "geometry"]
    ].to_crs("EPSG:5070")

    if len(counties) != 36:
        raise RuntimeError(
            f"36 comtés attendus, {len(counties)} trouvés."
        )

    print(f"{len(counties)} comtés téléchargés.")
    return counties


def download_padus():
    """Récupère les parcelles PAD-US par pagination."""
    print("Téléchargement des terrains PAD-US...")

    session = requests.Session()
    features = []
    offset = 0
    page_size = 1000

    while True:
        params = {
            "where": "State_Nm = 'OR'",
            "outFields": (
                "OBJECTID,Own_Type,Own_Name,Loc_Own,"
                "Mang_Type,Mang_Name,Loc_Mang,GIS_Acres,"
                "Unit_Nm,Category,State_Nm"
            ),
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
            "resultOffset": offset,
            "resultRecordCount": page_size,
            "orderByFields": "OBJECTID",
        }

        response = session.get(
            PADUS_URL, params=params, timeout=180
        )
        response.raise_for_status()
        data = response.json()

        if "error" in data:
            raise RuntimeError(
                f"Erreur du service PAD-US : {data['error']}"
            )

        page = data.get("features", [])
        if not page:
            break

        features.extend(page)
        offset += len(page)

        print(f"  {len(features)} parcelles récupérées...")

        if len(page) < page_size:
            break

    if not features:
        raise RuntimeError(
            "Aucune parcelle reçue. Vérifie le filtre State_Nm "
            "et la disponibilité du service USGS."
        )

    lands = gpd.GeoDataFrame.from_features(
        features, crs="EPSG:4326"
    )

    lands = lands[lands.geometry.notna()].copy()
    lands = lands[~lands.geometry.is_empty].copy()

    # Conserver les polygones et corriger les géométries invalides.
    lands = lands[
        lands.geometry.geom_type.isin(
            ["Polygon", "MultiPolygon"]
        )
    ].copy()

    lands = lands.to_crs(AREA_CRS)

    print(f"{len(lands)} géométries exploitables.")
    return lands


def calculate_areas(counties, lands):
    """Calcule les superficies publiques par comté."""

    # Sélection des catégories de propriétaires publics.
    # Les terrains tribaux sont exclus par défaut, car leur
    # statut foncier et juridique est particulier.
    public_types = {
        "FED",   # Gouvernement fédéral
        "STAT",  # État
        "CNTY",  # Comté
        "CITY",  # Municipalité
        "REG",   # Organisme régional
        "RWD",   # District d'eau
        "SDC",   # Autre organisme d'État
        "OTHS",  # Autre organisme d'État
        "SDNR",  # Terrains de trust de l'État
        "SDOL",
        "SLB",
    }

    if "Own_Type" in lands.columns:
        public_lands = lands[
            lands["Own_Type"].isin(public_types)
        ].copy()
    else:
        raise RuntimeError(
            "Le champ Own_Type est absent du service PAD-US."
        )

    if public_lands.empty:
        raise RuntimeError(
            "Aucun terrain ne correspond aux types publics."
        )

    # Nettoyer les géométries avant les intersections.
    public_lands["geometry"] = (
        public_lands.geometry.make_valid()
    )

    # Un même terrain peut traverser plusieurs comtés :
    # on calcule uniquement la partie située dans chaque comté.
    results = []

    for _, county in counties.iterrows():
        county_name = county["NAME"]
        county_fips = county["GEOID"]
        county_geom = county.geometry

        print(f"Calcul : {county_name} County...")

        candidates = public_lands[
            public_lands.intersects(county_geom)
        ]

        clipped = []

        for geom in candidates.geometry:
            intersection = geom.intersection(county_geom)

            if not intersection.is_empty:
                clipped.append(intersection)

        # L'union empêche de compter deux fois les zones
        # qui se chevauchent entre plusieurs enregistrements.
        if clipped:
            county_public_geom = (
                gpd.GeoSeries(
                    clipped, crs=AREA_CRS
                ).union_all()
            )
            area_m2 = county_public_geom.area
        else:
            area_m2 = 0.0

        area_km2 = area_m2 / 1_000_000
        area_acres = area_km2 * ACRES_PER_KM2

        county_area_km2 = county_geom.area / 1_000_000

        results.append({
            "county_fips": county_fips,
            "county": county_name,
            "public_land_km2": round(area_km2, 3),
            "public_land_acres": round(area_acres, 2),
            "county_area_km2": round(county_area_km2, 3),
            "public_land_percent": round(
                100 * area_km2 / county_area_km2, 2
            ) if county_area_km2 else 0,
        })

    result_df = pd.DataFrame(results)

    result_df = result_df.sort_values(
        "public_land_km2", ascending=False
    )

    return result_df


def main():
    counties = download_counties()
    lands = download_padus()

    results = calculate_areas(counties, lands)

    results.to_csv(
        OUTPUT_CSV,
        index=False,
        encoding="utf-8-sig",
    )

    print("\nRésultat enregistré :", OUTPUT_CSV)
    print("\nLes 10 comtés ayant le plus de terrains publics :")
    print(results.head(10).to_string(index=False))


if __name__ == "__main__":
    main()