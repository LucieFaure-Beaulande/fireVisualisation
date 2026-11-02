#!/usr/bin/env python3
"""
CSV simple (année, mois, county) du coût de lutte contre les incendies en Oregon.
Source unique : NIFC / WFIGS "Wildland Fire Incident Locations" (données IRWIN, ~2014 -> aujourd'hui),
champ EstimatedCostToDate (coût de suppression déclaré, USD nominaux). Aucune estimation : somme des
valeurs déclarées.
https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations/FeatureServer/0

Colonnes : year, month, county, state, suppression_cost_usd, n_incidents, n_incidents_with_cost

USAGE
  pip install requests pandas
  python fire_costs_oregon.py                     # 2014 -> année courante
  python fire_costs_oregon.py --years 2018-2022 --out couts.csv
  python fire_costs_oregon.py --exclude-cpx-children
"""
import argparse
import datetime as dt
import sys

import pandas as pd
import requests

WFIGS_URL = ("https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/"
             "WFIGS_Incident_Locations/FeatureServer/0/query")
FIELDS = ["IrwinID", "IncidentTypeCategory", "FireDiscoveryDateTime", "POOState",
          "POOCounty", "EstimatedCostToDate", "IsCpxChild"]
PAGE = 2000  # MaxRecordCount du service


def parse_years(s):
    if not s:
        return 2014, dt.date.today().year
    if "-" in s:
        a, b = s.split("-")
        return int(a), int(b)
    return int(s), int(s)


def fetch_wfigs():
    where = ("POOState IN ('US-OR','OR') "
             "AND (IncidentTypeCategory IS NULL OR IncidentTypeCategory <> 'RX')")
    rows, offset = [], 0
    while True:
        params = {"where": where, "outFields": ",".join(FIELDS), "returnGeometry": "false",
                  "orderByFields": "OBJECTID", "resultOffset": offset,
                  "resultRecordCount": PAGE, "f": "json"}
        r = requests.get(WFIGS_URL, params=params, timeout=120)
        r.raise_for_status()
        js = r.json()
        if "error" in js:
            sys.exit(f"Erreur API WFIGS : {js['error']}")
        feats = js.get("features", [])
        rows.extend(f["attributes"] for f in feats)
        print(f"  {len(rows)} incidents récupérés", end="\r")
        if len(feats) < PAGE and not js.get("exceededTransferLimit"):
            break
        offset += len(feats)
    print()
    return pd.DataFrame(rows)


def build(df, y0, y1, exclude_cpx_children):
    d = pd.to_datetime(df["FireDiscoveryDateTime"], unit="ms", utc=True, errors="coerce")
    d = d.dt.tz_convert("America/Los_Angeles")
    df = df.assign(year=d.dt.year, month=d.dt.month,
                   county=(df["POOCounty"].astype("string")
                           .str.replace(r"\s+County$", "", regex=True, case=False)
                           .str.strip().str.title()))
    df = df.dropna(subset=["year", "month", "county"])
    df = df[(df["year"] >= y0) & (df["year"] <= y1)]
    df = pd.concat([df[df["IrwinID"].isna()],
                    df[df["IrwinID"].notna()].drop_duplicates("IrwinID")])

    n_child = ((df["IsCpxChild"] == 1) & (df["EstimatedCostToDate"] > 0)).sum()
    if exclude_cpx_children:
        df = df[df["IsCpxChild"] != 1]
    else:
        print(f"  ATTENTION : {n_child} sous-incidents de complexes ont un coût > 0 ; "
              "risque de double comptage avec le complexe parent (voir --exclude-cpx-children).")

    df["has_cost"] = df["EstimatedCostToDate"].notna() & (df["EstimatedCostToDate"] > 0)
    g = df.groupby(["year", "month", "county"], as_index=False).agg(
        suppression_cost_usd=("EstimatedCostToDate", lambda s: s.sum(min_count=1)),
        n_incidents=("has_cost", "size"),
        n_incidents_with_cost=("has_cost", "sum"),
    )
    g = g[g["n_incidents_with_cost"] > 0].copy()
    g.insert(3, "state", "OR")
    return g.sort_values(["year", "month", "county"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", help="ex: 2020 ou 2018-2022 (défaut: 2014 -> année courante)")
    ap.add_argument("--out", default="../pipeline/oregon_fire_costs_by_county_month.csv")
    ap.add_argument("--exclude-cpx-children", action="store_true")
    a = ap.parse_args()
    y0, y1 = parse_years(a.years)
    out = build(fetch_wfigs(), y0, y1, a.exclude_cpx_children)
    out.to_csv(a.out, index=False)
    print(f"{len(out)} lignes écrites dans {a.out}")


if __name__ == "__main__":
    main()
