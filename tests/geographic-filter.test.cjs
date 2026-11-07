const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFile, writeFile, mkdir, mkdtemp, copyFile, rm } = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");

const filterModule = import("../scripts/geographic-filter.mjs");
const d3Module = import("d3");
const projectDirectory = path.resolve(__dirname, "..");
// Anneau extérieur dans le sens attendu par D3, sur une petite zone de la sphère.
const ring = (x = 0) => [[x, 0], [x, 10], [x + 10, 10], [x + 10, 0], [x, 0]];
const polygon = coordinates => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates } });
const collection = (...features) => ({ type: "FeatureCollection", features });
const fire = (Serial, longitude, latitude, County = "Other State") => ({
  Serial, Long_DD: String(longitude), Lat_DD: String(latitude), County
});

test("sépare les centres intérieurs et extérieurs sans modifier les feux", async () => {
  const { partitionFiresByTerritory, exclusionReason } = await filterModule;
  const fires = [fire("inside", 5, 5), fire("outside", 20, 5, "Oregon")];
  const original = structuredClone(fires);
  const result = partitionFiresByTerritory(fires, collection(polygon([ring()])));
  assert.deepEqual(result.retained, [fires[0]]);
  assert.deepEqual(result.excluded, [{ ...fires[1], ExclusionReason: exclusionReason }]);
  assert.deepEqual(fires, original);
});

test("respecte directement D3 sur les frontières, sommets et points voisins", async () => {
  const { partitionFiresByTerritory } = await filterModule;
  const { geoContains } = await d3Module;
  const feature = polygon([ring()]);
  const fires = [fire("edge", 0, 5), fire("vertex", 0, 0), fire("near-in", 0.0001, 5), fire("near-out", -0.0001, 5)];
  const result = partitionFiresByTerritory(fires, collection(feature));
  for (const item of fires) {
    assert.equal(result.retained.includes(item), geoContains(feature, [+item.Long_DD, +item.Lat_DD]));
  }
});

test("cherche dans tous les districts et toutes les composantes des MultiPolygon", async () => {
  const { partitionFiresByTerritory } = await filterModule;
  const districts = collection(polygon([ring()]), {
    type: "Feature", properties: {},
    geometry: { type: "MultiPolygon", coordinates: [[ring(20)], [ring(40)]] }
  });
  const fires = [fire("first", 5, 5), fire("second", 25, 5), fire("third", 45, 5), fire("gap", 15, 5)];
  const result = partitionFiresByTerritory(fires, districts);
  assert.deepEqual(result.retained.map(f => f.Serial), ["first", "second", "third"]);
  assert.deepEqual(result.excluded.map(f => f.Serial), ["gap"]);
});

test("exclut les points dans les trous des polygones", async () => {
  const { partitionFiresByTerritory } = await filterModule;
  const hole = [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]];
  const result = partitionFiresByTerritory([fire("hole", 5, 5), fire("land", 1, 5)], collection(polygon([ring(), hole])));
  assert.deepEqual(result.retained.map(f => f.Serial), ["land"]);
  assert.deepEqual(result.excluded.map(f => f.Serial), ["hole"]);
});

test("refuse un fond absent, vide ou mal formé au lieu d'exclure silencieusement tous les feux", async () => {
  const { partitionFiresByTerritory } = await filterModule;
  for (const invalid of [undefined, {}, collection(), collection(null), collection(polygon([])),
    collection(polygon([[[0, 0]]])), collection(polygon([[[0, 0], [0, 10], [10, 10], [10, 0]]]))]) {
    assert.throws(() => partitionFiresByTerritory([], invalid), /Invalid basemap/);
  }
});

test("un fond absent, illisible ou invalide arrête la préparation avant toute écriture", async t => {
  // Sous node_modules pour réutiliser D3 sans installer de dépendance dans la fixture.
  const cacheDirectory = path.join(projectDirectory, "node_modules", ".cache");
  await mkdir(cacheDirectory, { recursive: true });
  const fixture = await mkdtemp(path.join(cacheDirectory, "fire-geography-"));
  t.after(async () => {
    assert.equal(path.dirname(fixture), cacheDirectory);
    await rm(fixture, { recursive: true, force: true });
  });
  await Promise.all(["scripts", "data", "public/data"].map(folder => mkdir(path.join(fixture, folder), { recursive: true })));
  for (const name of ["prepare-data.mjs", "geographic-filter.mjs"]) {
    await copyFile(path.join(projectDirectory, "scripts", name), path.join(fixture, "scripts", name));
  }
  await writeFile(path.join(fixture, "public/data/fire-occurence.csv"), "Serial,FireYear,Lat_DD,Long_DD,EstTotalAcres\n1,2022,44,-120,1\n");
  await writeFile(path.join(fixture, "data/OR_Fire_Stations_2532669185716841308.xlsx"), "Unused: geographic validation must fail before parsing stations.");
  const outputs = ["public/data/fires-bubble-map.csv", "public/data/fire-stations.csv",
    "public/data/unit-station-candidates.csv", "public/data/unit-station-mapping.csv",
    "public/data/fire-station-links.csv", "data/fires-excluded.csv"];
  for (const output of outputs) await writeFile(path.join(fixture, output), `Existing export: ${output}\n`);
  const run = promisify(execFile);
  for (const content of [undefined, "{invalid JSON", JSON.stringify(collection())]) {
    if (content !== undefined) await writeFile(path.join(fixture, "data/Congressional_Districts.geojson"), content);
    await assert.rejects(run(process.execPath, [path.join(fixture, "scripts/prepare-data.mjs")]), error => {
      assert.match(error.stderr, content === undefined ? /ENOENT/ : content.startsWith("{invalid") ? /SyntaxError/ : /Invalid basemap/);
      return true;
    });
    for (const output of outputs) {
      assert.equal(await readFile(path.join(fixture, output), "utf8"), `Existing export: ${output}\n`);
    }
  }
});

test("les exports répartissent les 23 408 feux valides et ne gardent aucune liaison vers un feu exclu", async () => {
  const { csvParse } = await d3Module;
  const { exclusionReason } = await filterModule;
  const readCsv = async relative => csvParse(await readFile(path.join(projectDirectory, relative), "utf8"));
  const [source, retained, excluded, links] = await Promise.all([
    readCsv("public/data/fire-occurence.csv"), readCsv("public/data/fires-bubble-map.csv"),
    readCsv("data/fires-excluded.csv"), readCsv("public/data/fire-station-links.csv")
  ]);
  const required = ["Serial", "FireYear", "Lat_DD", "Long_DD", "EstTotalAcres"];
  const valid = source.filter(f => required.every(key => f[key]?.trim() !== "") &&
    Number.isFinite(+f.Lat_DD) && Number.isFinite(+f.Long_DD) &&
    Number.isFinite(+f.EstTotalAcres) && +f.EstTotalAcres >= 0);
  assert.equal(valid.length, 23408);
  assert.equal(retained.length, 23391);
  assert.equal(excluded.length, 17);
  assert.deepEqual(excluded.columns, [...retained.columns, "ExclusionReason"]);
  const retainedIds = new Set(retained.map(f => f.Serial));
  const excludedIds = new Set(excluded.map(f => f.Serial));
  const combined = [...retained, ...excluded];
  assert.equal(new Set(combined.map(f => f.Serial)).size, valid.length);
  assert.deepEqual(new Set(combined.map(f => f.Serial)), new Set(valid.map(f => f.Serial)));
  const sourceById = new Map(valid.map(f => [f.Serial, f]));
  for (const item of combined) {
    for (const column of retained.columns) assert.equal(item[column], sourceById.get(item.Serial)[column]);
  }
  for (const item of excluded) assert.equal(item.ExclusionReason, exclusionReason);
  for (const serial of ["101529", "102545", "102929"]) {
    assert.ok(excludedIds.has(serial));
    assert.ok(!retainedIds.has(serial));
  }
  for (const link of links) assert.ok(retainedIds.has(link.FireSerial), `Liaison orpheline : ${link.FireSerial}`);
});

test("les durées absentes ou nulles restent indisponibles sans supprimer les liaisons", async () => {
  const { csvParse } = await d3Module;
  const links = csvParse(await readFile(path.join(projectDirectory, "public/data/fire-station-links.csv"), "utf8"));
  const byId = new Map(links.map(link => [link.FireSerial, link]));
  // Ces feux ont une découverte et une maîtrise au même instant dans la source.
  for (const id of ["68956", "84284", "61575"]) {
    const link = byId.get(id);
    assert.ok(link, `La liaison du feu ${id} doit rester présente`);
    assert.equal(link.Discover_DateTime, link.Control_DateTime);
    assert.equal(link.ControlDurationMinutes, "");
    assert.equal(link.ControlDurationHours, "");
  }
  assert.ok(links.some(link => link.ControlDurationMinutes !== ""));
  for (const link of links) {
    if (link.ControlDurationMinutes === "") {
      assert.equal(link.ControlDurationHours, "");
    } else {
      assert.ok(Number(link.ControlDurationMinutes) > 0);
      assert.ok(Math.abs(Number(link.ControlDurationHours) - Number(link.ControlDurationMinutes) / 60) <= 0.0051);
    }
  }
});
