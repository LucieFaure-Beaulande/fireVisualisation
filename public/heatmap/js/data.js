// Data prepared by scripts/prepare-heatmap.mjs (run again by the admin console after each import), in data/:
//   - heatmap.csv          : one row per (year, month, county): fires, burned area, public share, costs
//   - fires/<year>.json    : one object per fire of the year (land, owner, causes, burned area), loaded on demand
//   - public-land.csv      : public land area per county
//   - hiking-trails.csv    : USFS trails per county and calendar month (no year:
//                            current inventory, closed = seasonal use restriction)

import { monthLong } from "./format.js";

const DATA = "data";

export const PUBLIC = "Public";
export const PRIVATE = "Private / Other";

const monthNumber = name => monthLong.indexOf(name) + 1;   // "January" → 1

function parseStat(d) {
    return {
        year: +d.year,
        month: +d.month,
        county: d.county,
        fireCount: +d.fire_count,
        totalAcres: +d.total_acres || 0,
        publicBurnedPct: +d.public_burned_pct || 0,
        suppressionCost: +d.suppression_cost_usd || 0
    };
}

// closed = trails restricted for at least one mode of travel that month
function parseTrails(d) {
    const total = +d.Total_Sentiers || 0;
    const closed = d3.max(Object.keys(d).filter(k => k.startsWith("Total_Fermes")), k => +d[k] || 0) || 0;
    return { county: d.County, month: monthNumber(d.Mois), total, closed, open: total - closed };
}

export const cellKey = (county, year, month) => `${county}|${year}|${month}`;
export const trailKey = (county, month) => `${county}|${month}`;

// the fires of a year, grouped by cell: each file is downloaded once, when a cell of its year is opened
const firesOfYear = new Map();
function loadFiresOfYear(year) {
    if (!firesOfYear.has(year)) firesOfYear.set(year, d3.json(`${DATA}/fires/${year}.json`)
        .then(rows => d3.group(rows.map((f, i) => ({ ...f, id: i, year })), f => cellKey(f.county, year, f.month))));
    return firesOfYear.get(year);
}

export async function loadData() {
    const [statRows, landRows, trailRows] = await Promise.all([
        d3.csv(`${DATA}/heatmap.csv`),
        d3.csv(`${DATA}/public-land.csv`),
        d3.csv(`${DATA}/hiking-trails.csv`)
    ]);

    const stats = statRows.map(parseStat);
    const trails = trailRows.map(parseTrails);
    const years = Array.from(new Set(stats.map(s => s.year))).sort((a, b) => a - b);

    return {
        stats,
        statsByCell: new Map(stats.map(s => [cellKey(s.county, s.year, s.month), s])),
        firesOfCell: async (county, year, month) => (await loadFiresOfYear(year)).get(cellKey(county, year, month)) || [],
        trailsByCell: new Map(trails.map(t => [trailKey(t.county, t.month), t])),
        publicLand: new Map(landRows.map(d => [d.county, +d.public_land_acres])),
        years,
        // the costs are only known from 2014 (WFIGS): the years without any cost are told apart in the tooltips
        costYears: new Set(stats.filter(s => s.suppressionCost > 0).map(s => s.year)),
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
