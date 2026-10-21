// Data prepared by pipeline/pipeline.py and the scripts of data/
//   - final_heatmap_data.csv               : one row per (year, month, county): fires, burned area, costs
//   - fires_detail_parallel.json           : one object per fire (land, owner, causes, burned area)
//   - oregon_public_land_by_county.csv     : public land area per county
//   - oregon_hiking_paths_by_county_month.csv : USFS trails per county and calendar month (no year:
//                                            current inventory, closed = seasonal use restriction)

import { monthLong } from "./format.js";

const PIPELINE = "pipeline";

export const PUBLIC = "Public";
export const PRIVATE = "Private / Other";

const monthNumber = name => monthLong.indexOf(name) + 1;   // "January" → 1

function parseStat(d) {
    return {
        year: +d.Year,
        month: +d.Month,
        county: d.County,
        fireCount: +d.fire_count,
        totalAcres: +d.total_acres || 0,
        publicBurnedPct: +d.public_burned_pct || 0,
        suppressionCost: +d.suppression_cost_usd || 0
    };
}

function parseFire(d, i) {
    return {
        id: i,
        county: d.County, year: d.Year, month: d.Month,
        name: d.FireName || `Fire ${i + 1}`,
        acres: +d.EstTotalAcres || 0,
        category: d.land_category === PUBLIC ? PUBLIC : PRIVATE,
        owner: d.land_owner,
        origin: d.cause_category,
        general: d.general_cause,
        specific: d.specific_cause
    };
}

// closed = trails restricted for at least one mode of travel that month (same rule as pipeline.py)
function parseTrails(d) {
    const total = +d.Total_Sentiers || 0;
    const closed = d3.max(Object.keys(d).filter(k => k.startsWith("Total_Fermes")), k => +d[k] || 0) || 0;
    return { county: d.County, month: monthNumber(d.Mois), total, closed, open: total - closed };
}

export const cellKey = (county, year, month) => `${county}|${year}|${month}`;
export const trailKey = (county, month) => `${county}|${month}`;

export async function loadData() {
    const [statRows, fireRows, landRows, trailRows] = await Promise.all([
        d3.csv(`${PIPELINE}/final_heatmap_data.csv`),
        d3.json(`${PIPELINE}/fires_detail_parallel.json`),
        d3.csv(`${PIPELINE}/oregon_public_land_by_county.csv`),
        d3.csv(`${PIPELINE}/oregon_hiking_paths_by_county_month.csv`)
    ]);

    const stats = statRows.map(parseStat);
    const fires = fireRows.map(parseFire);
    const trails = trailRows.map(parseTrails);
    const years = Array.from(new Set(stats.map(s => s.year))).sort((a, b) => a - b);

    return {
        stats,
        statsByCell: new Map(stats.map(s => [cellKey(s.county, s.year, s.month), s])),
        firesByCell: d3.group(fires, f => cellKey(f.county, f.year, f.month)),
        trailsByCell: new Map(trails.map(t => [trailKey(t.county, t.month), t])),
        publicLand: new Map(landRows.map(d => [d.county, +d.public_land_acres])),
        years,
        // the trail data is a current inventory without year: it is only shown for the last year
        trailsYear: years[years.length - 1],
        counties: Array.from(new Set(stats.map(s => s.county))).sort(),
        max: {
            fires: d3.max(stats, s => s.fireCount) || 1,
            cost: d3.max(stats, s => s.suppressionCost) || 1,
            trails: d3.max(trails, t => t.total) || 1
        }
    };
}
