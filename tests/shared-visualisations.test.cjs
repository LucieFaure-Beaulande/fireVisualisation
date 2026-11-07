const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const projectDirectory = path.resolve(__dirname, "..");
const d3Module = import("d3");

test("la heatmap reçoit un interpolateur et la carte sept couleurs discrètes", async () => {
  const d3 = await d3Module;
  let paletteName = "Oranges";
  const context = vm.createContext({
    d3, window: {}, document: { documentElement: {} },
    getComputedStyle: () => ({ getPropertyValue: () => paletteName })
  });
  vm.runInContext(await readFile(path.join(projectDirectory, "public/js/palette.js"), "utf8"), context);
  const palette = context.window.FirePalette;
  assert.equal(palette.sequential(), d3.interpolateOranges);
  assert.equal(d3.scaleSequential(palette.sequential()).domain([0, 10])(5), d3.interpolateOranges(0.5));
  assert.deepEqual(palette.discrete(), d3.schemeOranges[7]);
  assert.equal(d3.scaleOrdinal().domain(["A", "B", "C", "D", "E", "F", "G"]).range(palette.discrete(7))("G"), d3.schemeOranges[7][6]);
  paletteName = "Blues";
  assert.equal(palette.sequential(), d3.interpolateBlues);
  assert.deepEqual(palette.discrete(5), d3.schemeBlues[5]);
  paletteName = "unknown";
  assert.equal(palette.sequential(), d3.interpolateOranges);
  assert.deepEqual(palette.discrete(), d3.schemeOranges[7]);
});

test("le dataset complet garde ses causes et son cache, la carte peut charger son export séparément", async () => {
  const d3 = await d3Module;
  const requests = [];
  const context = vm.createContext({
    d3: {
      timeParse: d3.timeParse,
      csv(url, parseRow) {
        requests.push(url);
        if (url === "/data/fires-current.csv") return Promise.reject(new Error("404 Not Found"));
        return readFile(path.join(projectDirectory, "public", url), "utf8").then(csv => d3.csvParse(csv, parseRow));
      }
    }
  });
  vm.runInContext(await readFile(path.join(projectDirectory, "public/js/fireData.js"), "utf8"), context);
  const completePromise = context.loadFires();
  assert.equal(context.loadFires(), completePromise);
  const [complete, map] = await Promise.all([completePromise, context.loadFires("/data/fires-bubble-map.csv")]);
  assert.equal(complete.length, 23490);
  assert.equal(map.length, 23391);
  for (const field of ["HumanOrLightning", "GeneralCause", "SpecificCause"]) {
    assert.ok(complete.columns.includes(field));
    assert.ok(complete.some(fire => fire[field] && fire[field] !== "Unspecified"));
    assert.ok(!map.columns.includes(field));
  }
  assert.equal(typeof complete[0].FireYear, "number");
  assert.deepEqual(requests, ["/data/fires-current.csv", "/data/fires-bubble-map.csv", "/data/fire-occurence.csv"]);
  const invalid = context.parseFire({ County: "ERROR: #N/A", FO_LandOwnType: "ERROR: #N/A" });
  assert.equal(invalid.County, "Unspecified");
  assert.equal(invalid.FO_LandOwnType, "Unspecified");
  assert.equal(await context.loadFires(), complete);
  assert.equal(await context.loadFires("/data/fires-bubble-map.csv"), map);
  assert.equal(requests.length, 3);
});
