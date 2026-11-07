import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { partitionFiresByTerritory } from "./geographic-filter.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const currentFireInputPath = path.join(projectDirectory, "public", "data", "fires-current.csv");
const originalFireInputPath = path.join(projectDirectory, "public", "data", "fire-occurence.csv");
const fireOutputPath = path.join(projectDirectory, "public", "data", "fires-bubble-map.csv");
const stationInputPath = path.join(projectDirectory, "data", "OR_Fire_Stations_2532669185716841308.xlsx");
const stationOutputPath = path.join(projectDirectory, "public", "data", "fire-stations.csv");
const candidateOutputPath = path.join(projectDirectory, "public", "data", "unit-station-candidates.csv");
const mappingOutputPath = path.join(projectDirectory, "public", "data", "unit-station-mapping.csv");
const linkOutputPath = path.join(projectDirectory, "public", "data", "fire-station-links.csv");
// Même fond de carte que la route /data/districts.geojson de server.js.
const districtInputPath = path.join(projectDirectory, "data", "Congressional_Districts.geojson");
const excludedOutputPath = path.join(projectDirectory, "data", "fires-excluded.csv");

const outputColumns = [
  "Serial",
  "FireYear",
  "FireName",
  "UnitName",
  "DistrictName",
  "County",
  "Lat_DD",
  "Long_DD",
  "EstTotalAcres",
  "Size_class",
  "Discover_DateTime",
  "Control_DateTime"
];

const stationOutputColumns = [
  "StationId",
  "Agency",
  "Station",
  "FacilityType",
  "County",
  "Longitude",
  "Latitude"
];

const candidateOutputColumns = [
  "UnitName",
  "StationId",
  "Station",
  "Agency",
  "County",
  "CountyMatchesUnit",
  "MatchMethod",
  "ValidationReason",
  "Status"
];

const mappingOutputColumns = [
  "UnitName",
  "StationId",
  "Station",
  "Agency",
  "County",
  "MatchMethod",
  "ValidationReason"
];

const linkOutputColumns = [
  "FireSerial",
  "FireYear",
  "FireName",
  "UnitName",
  "FireLongitude",
  "FireLatitude",
  "StationId",
  "Station",
  "Agency",
  "StationLongitude",
  "StationLatitude",
  "DistanceKm",
  "Discover_DateTime",
  "Control_DateTime",
  "ControlDurationMinutes",
  "ControlDurationHours",
  "LinkMethod"
];

function parseCsv(content) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (character === '"') {
      if (inQuotes && content[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (character === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some(cell => cell !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (value !== "" || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  const [headers, ...values] = rows;
  return values.map(cells => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(columns, rows) {
  return [
    columns.join(","),
    ...rows.map(row => columns.map(column => escapeCsv(row[column])).join(","))
  ].join("\n");
}

function isBubbleRecord(fire) {
  const requiredColumns = ["Serial", "FireYear", "Lat_DD", "Long_DD", "EstTotalAcres"];

  return requiredColumns.every(column => fire[column]?.trim() !== "") &&
    Number.isFinite(Number(fire.Lat_DD)) &&
    Number.isFinite(Number(fire.Long_DD)) &&
    Number.isFinite(Number(fire.EstTotalAcres)) &&
    Number(fire.EstTotalAcres) >= 0;
}

function unzipXlsxEntries(file) {
  let endOfCentralDirectory = -1;

  for (let offset = file.length - 22; offset >= Math.max(0, file.length - 65_557); offset -= 1) {
    if (file.readUInt32LE(offset) === 0x06054b50) {
      endOfCentralDirectory = offset;
      break;
    }
  }

  if (endOfCentralDirectory === -1) throw new Error("Invalid XLSX archive (central directory not found).");

  const entryCount = file.readUInt16LE(endOfCentralDirectory + 10);
  let offset = file.readUInt32LE(endOfCentralDirectory + 16);
  const entries = new Map();

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (file.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid XLSX archive (unexpected ZIP entry).");

    const compression = file.readUInt16LE(offset + 10);
    const compressedSize = file.readUInt32LE(offset + 20);
    const fileNameLength = file.readUInt16LE(offset + 28);
    const extraLength = file.readUInt16LE(offset + 30);
    const commentLength = file.readUInt16LE(offset + 32);
    const localHeaderOffset = file.readUInt32LE(offset + 42);
    const name = file.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");

    if (file.readUInt32LE(localHeaderOffset) !== 0x04034b50) throw new Error(`Invalid XLSX archive entry (${name}).`);

    const localNameLength = file.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = file.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = file.subarray(dataStart, dataStart + compressedSize);

    if (compression === 0) entries.set(name, compressed);
    else if (compression === 8) entries.set(name, inflateRawSync(compressed));
    else throw new Error(`Unsupported XLSX compression for ${name}.`);

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function xmlText(value) {
  return decodeXml(value.replace(/<[^>]+>/g, ""));
}

function removeXmlNamespaces(value) {
  return value.replace(/(<\/?)[A-Za-z0-9_]+:/g, "$1");
}

function columnIndex(reference) {
  return reference.match(/[A-Z]+/)[0]
    .split("")
    .reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function parseXlsxRows(file) {
  const entries = unzipXlsxEntries(file);
  const worksheetEntry = [...entries.keys()].find(name => name.startsWith("xl/worksheets/") && name.endsWith(".xml"));
  const worksheet = worksheetEntry ? removeXmlNamespaces(entries.get(worksheetEntry).toString("utf8")) : "";

  if (!worksheet) throw new Error("The first worksheet in the fire station workbook could not be found.");

  const sharedStringsXml = removeXmlNamespaces(entries.get("xl/sharedStrings.xml")?.toString("utf8") ?? "");
  const sharedStrings = [...sharedStringsXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)]
    .map(match => xmlText(match[1]));
  const rows = [];

  for (const rowMatch of worksheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];

    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1];
      const reference = attributes.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = attributes.match(/\bt="([^"]+)"/)?.[1];
      const rawValue = cellMatch[2].match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
      const inlineValue = cellMatch[2].match(/<is>([\s\S]*?)<\/is>/)?.[1];
      const value = type === "s" ? sharedStrings[Number(rawValue)] :
        type === "inlineStr" ? xmlText(inlineValue ?? "") : decodeXml(rawValue);

      if (reference) cells[columnIndex(reference)] = value;
    }

    rows.push(cells);
  }

  const [headers, ...values] = rows;
  return values.map(cells => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function isOperationalStation(station) {
  const type = station.Facility_Type.trim();
  return type.includes("Fire Station") || type === "Federal Fire Facility" || type === "State Fire Facility";
}

function toStationRecord(station) {
  return {
    StationId: station.OBJECTID,
    Agency: station.Agency.trim(),
    Station: station.Station.trim() || station.Agency.trim(),
    FacilityType: station.Facility_Type.trim(),
    County: station.County.trim(),
    Longitude: station.x,
    Latitude: station.y
  };
}

function normalizeText(value) {
  return ` ${String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

function createStationCandidates(fires, stations) {
  const countiesByUnit = new Map();

  fires.forEach(fire => {
    if (!countiesByUnit.has(fire.UnitName)) countiesByUnit.set(fire.UnitName, new Set());
    if (fire.County) countiesByUnit.get(fire.UnitName).add(fire.County);
  });

  return [...countiesByUnit.keys()].sort().flatMap(unitName => {
    const normalizedUnit = normalizeText(unitName);
    const unitCounties = countiesByUnit.get(unitName);
    const candidates = stations.filter(station => {
      const stationText = normalizeText(`${station.Agency} ${station.Station}`);
      return stationText.includes(normalizedUnit);
    });

    if (candidates.length === 0) {
      return [{
        UnitName: unitName,
        StationId: "",
        Station: "",
        Agency: "",
        County: "",
        CountyMatchesUnit: "",
        MatchMethod: "Aucune correspondance de nom",
        Status: "Sans candidat"
      }];
    }

    return candidates.map(station => {
      const countyMatchesUnit = unitCounties.has(station.County);

      return {
        UnitName: unitName,
        StationId: station.StationId,
        Station: station.Station,
        Agency: station.Agency,
        County: station.County,
        CountyMatchesUnit: countyMatchesUnit ? "Oui" : "Non",
        MatchMethod: "UnitName présent dans Agency ou Station",
        ValidationReason: countyMatchesUnit
          ? "Nom correspondant et comté présent parmi les feux de l'unité"
          : "Comté absent parmi les feux de l'unité",
        Status: countyMatchesUnit ? "Validée" : "Rejetée"
      };
    });
  });
}

function haversineDistanceKm(longitudeA, latitudeA, longitudeB, latitudeB) {
  const toRadians = value => value * Math.PI / 180;
  const earthRadiusKm = 6371;
  const deltaLatitude = toRadians(latitudeB - latitudeA);
  const deltaLongitude = toRadians(longitudeB - longitudeA);
  const value = Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(latitudeA)) * Math.cos(toRadians(latitudeB)) * Math.sin(deltaLongitude / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function parseSourceDateTime(value) {
  const match = String(value ?? "").trim()
    .match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+(AM|PM)$/i);
  if (!match) return null;

  const [, month, day, year, hour, minute, second, period] = match;
  const hour24 = (Number(hour) % 12) + (period.toUpperCase() === "PM" ? 12 : 0);
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), hour24, Number(minute), Number(second)));

  return date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day) &&
    date.getUTCHours() === hour24 &&
    date.getUTCMinutes() === Number(minute) &&
    date.getUTCSeconds() === Number(second) ? date : null;
}

function controlDurationMinutes(discoverDateTime, controlDateTime) {
  const discover = parseSourceDateTime(discoverDateTime);
  const control = parseSourceDateTime(controlDateTime);
  if (!discover || !control) return "";

  const durationMinutes = Math.round((control.getTime() - discover.getTime()) / 60_000);
  return durationMinutes > 0 ? durationMinutes : "";
}

function createFireStationLinks(fires, stations, mappings) {
  const stationById = new Map(stations.map(station => [station.StationId, station]));
  const stationsByUnit = new Map();

  mappings.forEach(mapping => {
    const station = stationById.get(mapping.StationId);
    if (!station) return;
    if (!stationsByUnit.has(mapping.UnitName)) stationsByUnit.set(mapping.UnitName, []);
    stationsByUnit.get(mapping.UnitName).push(station);
  });

  return fires.flatMap(fire => {
    const candidates = stationsByUnit.get(fire.UnitName) ?? [];
    if (candidates.length === 0) return [];

    const fireLongitude = Number(fire.Long_DD);
    const fireLatitude = Number(fire.Lat_DD);
    const nearestStation = candidates
      .map(station => ({
        station,
        distanceKm: haversineDistanceKm(fireLongitude, fireLatitude, Number(station.Longitude), Number(station.Latitude))
      }))
      .reduce((nearest, candidate) => candidate.distanceKm < nearest.distanceKm ? candidate : nearest);
    const durationMinutes = controlDurationMinutes(fire.Discover_DateTime, fire.Control_DateTime);

    return [{
      FireSerial: fire.Serial,
      FireYear: fire.FireYear,
      FireName: fire.FireName,
      UnitName: fire.UnitName,
      FireLongitude: fire.Long_DD,
      FireLatitude: fire.Lat_DD,
      StationId: nearestStation.station.StationId,
      Station: nearestStation.station.Station,
      Agency: nearestStation.station.Agency,
      StationLongitude: nearestStation.station.Longitude,
      StationLatitude: nearestStation.station.Latitude,
      DistanceKm: nearestStation.distanceKm.toFixed(2),
      Discover_DateTime: fire.Discover_DateTime,
      Control_DateTime: fire.Control_DateTime,
      ControlDurationMinutes: durationMinutes,
      ControlDurationHours: durationMinutes === "" ? "" : (durationMinutes / 60).toFixed(2),
      LinkMethod: "Caserne validée la plus proche de la même unité"
    }];
  });
}

const fireSource = await readFile(currentFireInputPath, "utf8").catch(error => {
  if (error.code !== "ENOENT") throw error;
  return readFile(originalFireInputPath, "utf8");
});
const stationSource = await readFile(stationInputPath);
const districts = JSON.parse(await readFile(districtInputPath, "utf8"));
const fires = parseCsv(fireSource);
const validFires = fires.filter(isBubbleRecord);
const { retained: bubbleFires, excluded: excludedFires } = partitionFiresByTerritory(validFires, districts);
const stations = parseXlsxRows(stationSource)
  .filter(station => station.OBJECTID && station.Agency && station.Facility_Type && station.x && station.y)
  .filter(isOperationalStation)
  .filter(station => Number.isFinite(Number(station.x)) && Number.isFinite(Number(station.y)))
  .map(toStationRecord);
// La validation des correspondances garde son périmètre antérieur au filtre géographique.
const stationCandidates = createStationCandidates(validFires, stations);
const validatedStationMappings = stationCandidates
  .filter(candidate => candidate.Status === "Validée")
  .map(candidate => Object.fromEntries(mappingOutputColumns.map(column => [column, candidate[column]])));
const fireStationLinks = createFireStationLinks(bubbleFires, stations, validatedStationMappings);

await Promise.all([
  writeFile(fireOutputPath, `${toCsv(outputColumns, bubbleFires)}\n`, "utf8"),
  writeFile(excludedOutputPath, `${toCsv([...outputColumns, "ExclusionReason"], excludedFires)}\n`, "utf8"),
  writeFile(stationOutputPath, `${toCsv(stationOutputColumns, stations)}\n`, "utf8"),
  writeFile(candidateOutputPath, `${toCsv(candidateOutputColumns, stationCandidates)}\n`, "utf8"),
  writeFile(mappingOutputPath, `${toCsv(mappingOutputColumns, validatedStationMappings)}\n`, "utf8"),
  writeFile(linkOutputPath, `${toCsv(linkOutputColumns, fireStationLinks)}\n`, "utf8")
]);

console.log(`Geographic filter checked ${validFires.length} valid fires from ${fires.length} source rows (${bubbleFires.length} retained, ${excludedFires.length} excluded).`);
console.log(`Wrote ${path.relative(projectDirectory, fireOutputPath)} (${bubbleFires.length} fires retained).`);
console.log(`Wrote ${path.relative(projectDirectory, excludedOutputPath)} (${excludedFires.length} fires outside the mapped area).`);
console.log(`Wrote ${path.relative(projectDirectory, stationOutputPath)} (${stations.length} operational fire stations retained).`);
console.log(`Wrote ${path.relative(projectDirectory, candidateOutputPath)} (${stationCandidates.length} candidate matches reviewed).`);
console.log(`Wrote ${path.relative(projectDirectory, mappingOutputPath)} (${validatedStationMappings.length} matches validated).`);
console.log(`Wrote ${path.relative(projectDirectory, linkOutputPath)} (${fireStationLinks.length} estimated links).`);
