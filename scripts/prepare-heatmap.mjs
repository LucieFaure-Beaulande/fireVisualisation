// Data of the heatmap (public/heatmap/): run after each change of the fires or of the costs in the admin console
//
// public/data/fires-current.csv  (or fire-occurence.csv)  ─┐
// data/heatmap/costs-current.csv (or fire-costs.csv)       ─┼──► public/heatmap/data/heatmap.csv     one row per (year, month, county)
// data/heatmap/hiking-trails.csv                           ─┤    public/heatmap/data/fires/<year>.json the fires of a year (detail view)
// data/heatmap/public-land.csv                             ─┘    public/heatmap/data/hiking-trails.csv, public-land.csv (copied)
//
// The sources of data/heatmap/ are built by the Python scripts of scripts/heatmap/ (see the README).

import { readFile, writeFile, mkdir, rm, copyFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as d3 from "d3";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const sourceDirectory = path.join(projectDirectory, "data", "heatmap");
const outputDirectory = path.join(projectDirectory, "public", "heatmap", "data");

const fireInputs = ["fires-current.csv", "fire-occurence.csv"].map(file => path.join(projectDirectory, "public", "data", file));
const costInputs = ["costs-current.csv", "fire-costs.csv"].map(file => path.join(sourceDirectory, file));
const copiedSources = ["hiking-trails.csv", "public-land.csv"];

// Same conventions as public/js/fireData.js: errors of the source are empty cells, empty cells are "Unspecified"
export const UNSPECIFIED = "Unspecified";
export const PUBLIC = "Public";
export const PRIVATE = "Private / Other";
const errorValues = ["ERROR: #N/A"];

// Public vs private land, from FO_LandOwnType, consistent with the public land area (scripts/heatmap/public_land.py, PAD-US):
//   - public          = federal (USFS, BLM, NPS), state, county, municipal, other public agency
//   - private / other = private owners + tribal land (BIA, not "public" in PAD-US) + unspecified owner
const publicOwners = new Set(["USFS", "BLM", "NPS", "State", "County", "Municipal", "Other Public", "Ocean Shores"]);

const parseDateTime = d3.timeParse("%m/%d/%Y %I:%M:%S %p");

function clean(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return errorValues.includes(text) ? "" : text;
}

const category = value => clean(value) || UNSPECIFIED;

// "LANE county" → "Lane", as in the costs and trails files
export function countyName(value) {
  return clean(value).replace(/\s+County$/i, "").toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_, before, letter) => before + letter.toUpperCase());
}

// one fire of the csv file → the values used by the heatmap, null when it cannot be placed (no date or county)
export function parseFire(row) {
  const date = parseDateTime(clean(row.Discover_DateTime));
  const county = countyName(row.County);
  if (!date || !county) return null;
  const owner = category(row.FO_LandOwnType);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    county,
    name: clean(row.FireName) || "Unnamed",
    acres: +clean(row.EstTotalAcres) || 0,
    category: publicOwners.has(owner) ? PUBLIC : PRIVATE,
    owner,
    origin: category(row.HumanOrLightning),
    general: category(row.GeneralCause),
    specific: category(row.SpecificCause)
  };
}

const cellKey = (year, month, county) => `${year}|${month}|${county}`;

// fires and costs (csv rows) → the rows of heatmap.csv and the fires grouped by year
export function prepareHeatmap(fireRows, costRows = []) {
  const fires = fireRows.map(parseFire).filter(Boolean);

  const costs = d3.rollup(costRows, rows => d3.sum(rows, d => +d.suppression_cost_usd || 0),
    d => cellKey(+d.year, +d.month, countyName(d.county)));

  const cells = d3.rollups(fires, group => {
    const total = d3.sum(group, f => f.acres);
    const publicAcres = d3.sum(group, f => f.category === PUBLIC ? f.acres : 0);
    const { year, month, county } = group[0];
    const cost = costs.get(cellKey(year, month, county));
    return {
      year, month, county,
      fire_count: group.length,
      total_acres: +total.toFixed(2),
      burned_acres_public: +publicAcres.toFixed(2),
      burned_acres_private: +(total - publicAcres).toFixed(2),
      public_burned_pct: total > 0 ? +(100 * publicAcres / total).toFixed(2) : 0,
      suppression_cost_usd: cost ?? ""
    };
  }, f => cellKey(f.year, f.month, f.county)).map(([, cell]) => cell);

  cells.sort((a, b) => d3.ascending(a.year, b.year) || d3.ascending(a.month, b.month) || d3.ascending(a.county, b.county));

  const firesByYear = d3.group(fires, f => f.year);
  return { cells, firesByYear, years: Array.from(firesByYear.keys()).sort(d3.ascending) };
}

async function firstExisting(files) {
  for (const file of files) {
    try { await access(file); return file; } catch { /* next file */ }
  }
  throw new Error(`None of these files exists: ${files.map(file => path.relative(projectDirectory, file)).join(", ")}`);
}

const readCsv = async file => d3.csvParse((await readFile(file, "utf8")).replace(/^﻿/, ""));

async function main() {
  const fireInput = await firstExisting(fireInputs);
  const costInput = await firstExisting(costInputs);
  const { cells, firesByYear, years } = prepareHeatmap(await readCsv(fireInput), await readCsv(costInput));

  // the fires of each year in their own file: the page only loads the year it shows
  const fireDirectory = path.join(outputDirectory, "fires");
  await rm(fireDirectory, { recursive: true, force: true });
  await mkdir(fireDirectory, { recursive: true });
  for (const [year, fires] of firesByYear)
    await writeFile(path.join(fireDirectory, `${year}.json`), JSON.stringify(fires.map(({ year, ...fire }) => fire)));

  await writeFile(path.join(outputDirectory, "heatmap.csv"), d3.csvFormat(cells));
  for (const file of copiedSources) await copyFile(path.join(sourceDirectory, file), path.join(outputDirectory, file));

  console.log(`Read ${path.relative(projectDirectory, fireInput)} and ${path.relative(projectDirectory, costInput)}.`);
  console.log(`Wrote public/heatmap/data/heatmap.csv (${cells.length} cells) and fires/<year>.json (${years[0]}-${years[years.length - 1]}).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
