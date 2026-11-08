#!/usr/bin/env python3
"""
Fire suppression costs in Oregon per year, month and county (data/heatmap/fire-costs.csv).
Single source: NIFC / WFIGS "Wildland Fire Incident Locations" (IRWIN data, ~2014 -> today),
field EstimatedCostToDate (declared suppression cost, nominal USD). No estimation: sum of the declared values.
https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations/FeatureServer/0

Columns: year, month, county, state, suppression_cost_usd, n_incidents, n_incidents_with_cost

USAGE
  pip install -r requirements.txt
  python fire_costs.py                     # 2014 -> current year
  python fire_costs.py --years 2018-2022 --out costs.csv
  python fire_costs.py --exclude-cpx-children
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
PAGE = 2000  # MaxRecordCount of the service


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
            sys.exit(f"WFIGS API error: {js['error']}")
        feats = js.get("features", [])
        rows.extend(f["attributes"] for f in feats)
        print(f"  {len(rows)} incidents fetched", end="\r")
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
        print(f"  WARNING: {n_child} child incidents of complexes have a cost > 0; "
              "they may be counted twice with the parent complex (see --exclude-cpx-children).")

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
    ap.add_argument("--years", help="e.g. 2020 or 2018-2022 (default: 2014 -> current year)")
    ap.add_argument("--out", default="../../data/heatmap/fire-costs.csv")
    ap.add_argument("--exclude-cpx-children", action="store_true")
    a = ap.parse_args()
    y0, y1 = parse_years(a.years)
    out = build(fetch_wfigs(), y0, y1, a.exclude_cpx_children)
    out.to_csv(a.out, index=False)
    print(f"{len(out)} rows written to {a.out}")


if __name__ == "__main__":
    main()
