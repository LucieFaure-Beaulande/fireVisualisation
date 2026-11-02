import { geoContains } from "d3";

export const exclusionReason = "Hors du territoire du fond de carte";

function validPolygon(coordinates) {
  return Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every(ring =>
    Array.isArray(ring) && ring.length >= 4 && ring.every(point =>
      Array.isArray(point) && point.length >= 2 &&
      Number.isFinite(point[0]) && Number.isFinite(point[1])
    ) && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]
  );
}

export function partitionFiresByTerritory(fires, districts) {
  if (districts?.type !== "FeatureCollection" || !Array.isArray(districts.features) ||
      districts.features.length === 0 || !districts.features.every(feature => {
        const geometry = feature?.geometry;
        return feature?.type === "Feature" && (
          geometry?.type === "Polygon" ? validPolygon(geometry.coordinates) :
            geometry?.type === "MultiPolygon" && Array.isArray(geometry.coordinates) &&
            geometry.coordinates.length > 0 && geometry.coordinates.every(validPolygon)
        );
      })) {
    throw new Error("Fond de carte invalide : des districts Polygon ou MultiPolygon sont requis.");
  }

  const retained = [];
  const excluded = [];
  for (const fire of fires) {
    const point = [Number(fire.Long_DD), Number(fire.Lat_DD)];
    if (districts.features.some(feature => geoContains(feature, point))) {
      retained.push(fire);
    } else {
      excluded.push({ ...fire, ExclusionReason: exclusionReason });
    }
  }
  return { retained, excluded };
}
