const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const projectDirectory = path.resolve(__dirname, "..");
const d3Module = import("d3");
const heatmapModule = import("../scripts/prepare-heatmap.mjs");

const readCsv = async (d3, file) => d3.csvParse((await readFile(path.join(projectDirectory, file), "utf8")).replace(/^﻿/, ""));

test("la heatmap regroupe tous les feux datés du dataset d'origine par comté et par mois", async () => {
  const d3 = await d3Module;
  const { prepareHeatmap, PUBLIC } = await heatmapModule;
  const fires = await readCsv(d3, "public/data/fire-occurence.csv");
  const { cells, firesByYear, years } = prepareHeatmap(fires, await readCsv(d3, "data/heatmap/fire-costs.csv"));

  const placed = d3.sum(Array.from(firesByYear.values()), group => group.length);
  assert.equal(d3.sum(cells, cell => cell.fire_count), placed);
  assert.deepEqual([years[0], years[years.length - 1]], [2000, 2022]);
  assert.equal(new Set(cells.map(cell => cell.county)).size, 36);
  assert.ok(cells.every(cell => !/error|#N\/A/i.test(cell.county)));
  // the costs are only known from 2014
  assert.ok(cells.filter(cell => cell.year < 2014).every(cell => cell.suppression_cost_usd === ""));
  assert.ok(cells.some(cell => cell.year >= 2014 && cell.suppression_cost_usd > 0));
  // the public share of a cell is its public burned area
  const cell = cells.find(c => c.total_acres > 100 && c.burned_acres_public > 0);
  const own = firesByYear.get(cell.year).filter(f => f.month === cell.month && f.county === cell.county);
  assert.equal(cell.burned_acres_public, +d3.sum(own, f => f.category === PUBLIC ? f.acres : 0).toFixed(2));
});

test("un fichier de feux ajouté dans la console fait apparaître sa nouvelle année", async () => {
  const { prepareHeatmap, PUBLIC, PRIVATE, UNSPECIFIED } = await heatmapModule;
  const row = (serial, owner, acres, county = "Lane County") => ({
    Serial: serial, FireName: " Test ", County: county, FO_LandOwnType: owner, EstTotalAcres: acres,
    HumanOrLightning: "Human", GeneralCause: "", SpecificCause: "ERROR: #N/A",
    Discover_DateTime: "07/19/2023 01:15:00 PM"
  });
  const { cells, firesByYear, years } = prepareHeatmap(
    [row(1, "USFS", "30"), row(2, "Private", "10"), row(3, "BIA", "0"), row(4, "BLM", "5", "ERROR: #N/A")],
    [{ year: "2023", month: "7", county: "LANE", suppression_cost_usd: "1000" }]
  );

  assert.deepEqual(years, [2023]);
  assert.deepEqual(cells, [{
    year: 2023, month: 7, county: "Lane", fire_count: 3, total_acres: 40, burned_acres_public: 30,
    burned_acres_private: 10, public_burned_pct: 75, suppression_cost_usd: 1000
  }]);
  const [first, , tribal] = firesByYear.get(2023);
  assert.equal(first.name, "Test");
  assert.equal(first.category, PUBLIC);
  assert.equal(tribal.category, PRIVATE);
  assert.equal(first.general, UNSPECIFIED);
  assert.equal(first.specific, UNSPECIFIED);
});

test("la console relance la préparation de la heatmap après un changement des feux ou des coûts", () => {
  const datasets = require("../admin/datasets.js");
  for (const id of ["fires", "costs"]) {
    const dataset = datasets.find(d => d.id === id);
    assert.ok(dataset.afterChange.some(step => step.command === "node" && step.args[0] === "scripts/prepare-heatmap.mjs"));
    assert.ok(dataset.usedBy.some(link => link.url === "/heatmap/"));
  }
});
