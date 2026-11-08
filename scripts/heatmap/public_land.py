# Public land area per Oregon county (data/heatmap/public-land.csv)
# Source: USGS PAD-US 4.1 (Fee layer) and the Census TIGER counties
#
# USAGE
#   pip install -r requirements.txt
#   python public_land.py

from pathlib import Path
import io
import zipfile

import geopandas as gpd
import pandas as pd
import requests


# --------------------------------------------------
# CONFIGURATION
# --------------------------------------------------

OUTPUT_DIR = Path("../../data/heatmap")
OUTPUT_CSV = OUTPUT_DIR / "public-land.csv"

YEAR = 2025

# USGS PAD-US 4.1 : Fee layer (land ownership)
PADUS_URL = (
    "https://edits.nationalmap.gov/arcgis/rest/services/"
    "PAD-US/PAD_US_4_1/MapServer/0/query"
)

# metric projection for the areas
AREA_CRS = "EPSG:5070"

ACRES_PER_KM2 = 247.105381


def download_counties():
    """Download and read the boundaries of the counties of Oregon."""

    print("Downloading the counties...")

    urls = [
        "https://www2.census.gov/geo/tiger/TIGER2025/"
        "COUNTY/tl_2025_us_county.zip",
        "https://www2.census.gov/geo/tiger/TIGER2024/"
        "COUNTY/tl_2024_us_county.zip",
    ]

    extract_dir = OUTPUT_DIR / "raw" / "counties"
    extract_dir.mkdir(parents=True, exist_ok=True)

    counties = None

    for url in urls:
        try:
            print(f"Trying: {url}")

            response = requests.get(url, timeout=180)
            response.raise_for_status()

            # extract the zip archive
            with zipfile.ZipFile(
                io.BytesIO(response.content)
            ) as archive:
                archive.extractall(extract_dir)

            # the extracted shapefile
            shp_files = list(extract_dir.rglob("*.shp"))

            if not shp_files:
                raise RuntimeError(
                    "No .shp file in the archive."
                )

            
            counties = gpd.read_file(shp_files[0])
            print("Geographic file loaded.")
            break

        except Exception as e:
            print(f"Failed: {e}")
            counties = None

    if counties is None:
        raise RuntimeError(
            "Cannot download or read the counties."
        )

    # Oregon: FIPS code 41
    counties = counties[
        counties["STATEFP"].astype(str) == "41"
    ].copy()

    counties = counties[
        ["GEOID", "NAME", "geometry"]
    ].to_crs("EPSG:5070")

    if len(counties) != 36:
        raise RuntimeError(
            f"36 counties expected, {len(counties)} found."
        )

    print(f"{len(counties)} counties downloaded.")
    return counties


def download_padus():
    """Fetch the PAD-US parcels, page by page."""
    print("Downloading the PAD-US land...")

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
                f"PAD-US service error: {data['error']}"
            )

        page = data.get("features", [])
        if not page:
            break

        features.extend(page)
        offset += len(page)

        print(f"  {len(features)} parcels fetched...")

        if len(page) < page_size:
            break

    if not features:
        raise RuntimeError(
            "No parcel received. Check the State_Nm filter "
            "and the availability of the USGS service."
        )

    lands = gpd.GeoDataFrame.from_features(
        features, crs="EPSG:4326"
    )

    lands = lands[lands.geometry.notna()].copy()
    lands = lands[~lands.geometry.is_empty].copy()

    # keep the polygons only
    lands = lands[
        lands.geometry.geom_type.isin(
            ["Polygon", "MultiPolygon"]
        )
    ].copy()

    lands = lands.to_crs(AREA_CRS)

    print(f"{len(lands)} usable geometries.")
    return lands


def calculate_areas(counties, lands):
    """Public land area per county."""

    # public owner types
    # tribal land is excluded: its legal status is specific
    public_types = {
        "FED",   # federal government
        "STAT",  # state
        "CNTY",  # county
        "CITY",  # city
        "REG",   # regional agency
        "RWD",   # water district
        "SDC",   # other state agency
        "OTHS",  # other state agency
        "SDNR",  # state trust land
        "SDOL",
        "SLB",
    }

    if "Own_Type" in lands.columns:
        public_lands = lands[
            lands["Own_Type"].isin(public_types)
        ].copy()
    else:
        raise RuntimeError(
            "The Own_Type field is missing from the PAD-US service."
        )

    if public_lands.empty:
        raise RuntimeError(
            "No land matches the public types."
        )

    # fix the invalid geometries before the intersections
    public_lands["geometry"] = (
        public_lands.geometry.make_valid()
    )

    # a parcel can cross several counties: only the part inside each county is counted
    results = []

    for _, county in counties.iterrows():
        county_name = county["NAME"]
        county_fips = county["GEOID"]
        county_geom = county.geometry

        print(f"Computing: {county_name} County...")

        candidates = public_lands[
            public_lands.intersects(county_geom)
        ]

        clipped = []

        for geom in candidates.geometry:
            intersection = geom.intersection(county_geom)

            if not intersection.is_empty:
                clipped.append(intersection)

        # the union avoids counting twice the overlapping parcels
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

    print("\nResult written:", OUTPUT_CSV)
    print("\nThe 10 counties with the most public land:")
    print(results.head(10).to_string(index=False))


if __name__ == "__main__":
    main()