const width = 1100;
const height = 700;
const margin = 28;
const sizeClasses = ["A", "B", "C", "D", "E", "F", "G"];
const fisheyeSettings = {
  radius: 115,
  distortion: 0.35,
  maxScale: 4,
  detailThreshold: 1.8
};

const svg = d3.select("#map")
  .attr("viewBox", `0 0 ${width} ${height}`)
  .attr("preserveAspectRatio", "xMidYMid meet");

svg.append("title").text("Incendies annuels de l'Oregon");
const mapContent = svg.append("g").attr("class", "map-content");

const layers = {
  districts: mapContent.append("g").attr("class", "districts-layer"),
  links: mapContent.append("g").attr("class", "links-layer"),
  fires: mapContent.append("g").attr("class", "fires-layer"),
  stations: mapContent.append("g").attr("class", "stations-layer"),
  details: mapContent.append("g").attr("class", "fisheye-details-layer"),
  legend: svg.append("g").attr("class", "legend-layer")
};

const rulerSvg = d3.select("#year-ruler")
  .attr("viewBox", `0 0 ${width} 82`)
  .attr("preserveAspectRatio", "xMidYMid meet");
const status = d3.select("#status");
const tooltip = d3.select("#tooltip");

// Règle temporelle : clic ou glissement pour sélectionner une année.
function drawRuler(years, getCurrentYear, update) {
  const rulerMargin = { left: 42, right: 42, top: 42 };
  const innerWidth = width - rulerMargin.left - rulerMargin.right;
  const ruler = rulerSvg.append("g")
    .attr("transform", `translate(${rulerMargin.left}, ${rulerMargin.top})`);
  const yearScale = d3.scaleLinear(d3.extent(years), [0, innerWidth]);

  // Quand de nombreuses années sont disponibles, seules certaines étiquettes sont affichées.
  const labelStep = Math.ceil(years.length / Math.max(1, Math.floor(innerWidth / 36)));

  ruler.append("g")
    .call(d3.axisBottom(yearScale)
      .tickValues(years)
      .tickSizeOuter(0)
      .tickFormat((year, index) => index % labelStep === 0 ? year : ""));

  // Zone de clic volontairement plus grande que l'axe.
  ruler.append("rect")
    .attr("x", -10)
    .attr("y", -30)
    .attr("width", innerWidth + 20)
    .attr("height", 70)
    .attr("fill", "transparent")
    .style("cursor", "pointer")
    .call(d3.drag().on("start drag", event => {
      const closest = d3.least(years, year => Math.abs(year - yearScale.invert(event.x)));
      if (closest !== getCurrentYear()) update(closest);
    }));

  rulerSvg.on("keydown", event => {
    const index = years.indexOf(getCurrentYear());
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      update(years[index - 1]);
    }
    if (event.key === "ArrowRight" && index < years.length - 1) {
      event.preventDefault();
      update(years[index + 1]);
    }
  });

  // Curseur : cercle sur l'axe et année sélectionnée au-dessus.
  const handle = ruler.append("g").style("pointer-events", "none");
  handle.append("circle")
    .attr("r", 8)
    .attr("fill", "#222")
    .attr("stroke", "white")
    .attr("stroke-width", 2);
  handle.append("text")
    .attr("y", -16)
    .attr("text-anchor", "middle")
    .attr("font-weight", "bold")
    .style("font-size", "14px");

  return {
    move(year) {
      handle.attr("transform", `translate(${yearScale(year)},0)`);
      handle.select("text").text(year);
    }
  };
}

function drawLegend(colorScale) {
  const legend = layers.legend.append("g")
    .attr("transform", "translate(42, 54)");

  legend.append("text")
    .attr("class", "legend-title")
    .text("Légende");


  const colorLegend = legend.append("g").attr("transform", "translate(0, 32)");
  colorLegend.selectAll("g")
    .data(sizeClasses)
    .join("g")
    .attr("transform", (d, i) => `translate(0, ${18 + i * 19})`)
    .each(function (d) {
      const item = d3.select(this);
      item.append("circle").attr("r", 6).attr("fill", colorScale(d));
      item.append("text").attr("x", 13).attr("dy", "0.35em").text(d);
    });

  const stationLegend = legend.append("g").attr("transform", "translate(0, 200)");
  stationLegend.append("path")
    .attr("class", "station")
    .attr("d", d3.symbol().type(d3.symbolSquare).size(100));
  stationLegend.append("text")
    .attr("x", 11)
    .attr("dy", "0.35em")
    .text("Caserne pertinente");

}

function showTooltip(event, fire) {
  const name = fire.FireName || "Feu sans nom";
  const stationDescription = fire.stationLink
    ? `<br>Caserne associée : ${fire.stationLink.Station}`
    : "<br>Caserne associée : aucune liaison disponible";

  tooltip
    .html(`<strong>${name}</strong><br>Classe ${fire.Size_class} · ${d3.format(",.2~f")(fire.EstTotalAcres)} acres${stationDescription}`)
    .style("left", `${event.clientX + 14}px`)
    .style("top", `${event.clientY + 14}px`)
    .attr("hidden", null);
}

function hideTooltip() {
  tooltip.attr("hidden", true);
}

function showStationTooltip(event, station) {
  tooltip
    .html(`<strong>${station.Station}</strong><br>${station.Agency}<br>${station.County} · ${station.FacilityType}<br>Unité : ${station.UnitNames}`)
    .style("left", `${event.clientX + 14}px`)
    .style("top", `${event.clientY + 14}px`)
    .attr("hidden", null);
}

function showLinkTooltip(event, link) {
  tooltip
    .html(`<strong>${link.Station}</strong><br>→ ${link.FireName || "Feu sans nom"}<br>Distance estimée : ${d3.format(",.2~f")(link.DistanceKm)} km<br>Temps avant maîtrise : ${formatControlDuration(link.ControlDurationMinutes)}`)
    .style("left", `${event.clientX + 14}px`)
    .style("top", `${event.clientY + 14}px`)
    .attr("hidden", null);
}

function formatControlDuration(minutes) {
  if (!Number.isFinite(minutes)) return "indisponible";

  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;
  const parts = days > 0 ? [`${days} j`] : [];
  parts.push(`${hours} h`);
  if (remainingMinutes > 0) parts.push(`${remainingMinutes} min`);
  return parts.join(" ");
}

function fisheyePoint(baseX, baseY, focus) {
  if (!focus) return { x: baseX, y: baseY, scale: 1 };

  const deltaX = baseX - focus.x;
  const deltaY = baseY - focus.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance === 0) return { x: baseX, y: baseY, scale: fisheyeSettings.maxScale };
  if (distance >= fisheyeSettings.radius) return { x: baseX, y: baseY, scale: 1 };

  const distortedDistance = (fisheyeSettings.distortion + 1) * fisheyeSettings.radius * distance /
    (fisheyeSettings.distortion * fisheyeSettings.radius + distance);
  const scale = Math.min(distortedDistance / distance, fisheyeSettings.maxScale);

  return {
    x: focus.x + deltaX * scale,
    y: focus.y + deltaY * scale,
    scale
  };
}

function connectionPathFromPoints(start, end) {
  const startX = start.x;
  const startY = start.y;
  const endX = end.x;
  const endY = end.y;
  const middleX = (startX + endX) / 2;
  const middleY = (startY + endY) / 2;
  const controlX = middleX - (endY - startY) * 0.12;
  const controlY = middleY + (endX - startX) * 0.12;

  return `M${startX},${startY}Q${controlX},${controlY} ${endX},${endY}`;
}

function fisheyeGeoPath(projection, focus) {
  const transform = d3.geoTransform({
    point(longitude, latitude) {
      const [baseX, baseY] = projection([longitude, latitude]);
      const point = fisheyePoint(baseX, baseY, focus);
      this.stream.point(point.x, point.y);
    }
  });

  return d3.geoPath(transform);
}

async function initialise() {
  try {
    const [rawFires, rawStations, validatedMappings, rawLinks, districts] = await Promise.all([
      loadFires(),
      d3.csv("/data/fire-stations.csv", d => ({
        ...d,
        Longitude: Number(d.Longitude),
        Latitude: Number(d.Latitude)
      })),
      d3.csv("/data/unit-station-mapping.csv"),
      d3.csv("/data/fire-station-links.csv", d => ({
        ...d,
        FireSerial: Number(d.FireSerial),
        FireYear: Number(d.FireYear),
        FireLongitude: Number(d.FireLongitude),
        FireLatitude: Number(d.FireLatitude),
        StationLongitude: Number(d.StationLongitude),
        StationLatitude: Number(d.StationLatitude),
        DistanceKm: Number(d.DistanceKm),
        ControlDurationMinutes: d.ControlDurationMinutes === "" ? Number.NaN : Number(d.ControlDurationMinutes)
      })),
      d3.json("/data/districts.geojson")
    ]);

    const links = rawLinks.filter(d =>
      Number.isFinite(d.FireYear) &&
      Number.isFinite(d.FireLongitude) &&
      Number.isFinite(d.FireLatitude) &&
      Number.isFinite(d.StationLongitude) &&
      Number.isFinite(d.StationLatitude) &&
      Number.isFinite(d.DistanceKm)
    );
    const linkByFireSerial = new Map(links.map(link => [link.FireSerial, link]));
    const fires = rawFires
      .filter(d =>
        Number.isFinite(d.Lat_DD) &&
        Number.isFinite(d.Long_DD) &&
        Number.isFinite(d.EstTotalAcres) &&
        d.EstTotalAcres >= 0 &&
        Number.isFinite(d.FireYear)
      )
      .map(fire => ({ ...fire, stationLink: linkByFireSerial.get(fire.Serial) }));
    const unitsByStationId = d3.rollup(
      validatedMappings,
      matches => matches.map(match => match.UnitName).sort().join(", "),
      match => match.StationId
    );
    const stations = rawStations
      .filter(d => unitsByStationId.has(d.StationId))
      .filter(d => Number.isFinite(d.Longitude) && Number.isFinite(d.Latitude))
      .map(d => ({ ...d, UnitNames: unitsByStationId.get(d.StationId) }));

    const projection = d3.geoMercator()
      .fitExtent([[margin, margin], [width - margin, height - margin]], districts);
    const geoPath = d3.geoPath(projection);
    const colorScale = d3.scaleOrdinal()
      .domain(sizeClasses)
      .range(d3.schemeYlOrRd[7]);
    const radiusScale = d3.scaleSqrt()
      .domain([0, d3.max(fires, d => d.EstTotalAcres)])
      .range([2, 26]);

    layers.districts.selectAll("path")
      .data(districts.features)
      .join("path")
      .attr("d", geoPath)
      .attr("class", "district");

    stations.forEach(station => {
      [station.baseX, station.baseY] = projection([station.Longitude, station.Latitude]);
    });

    const stationSelection = layers.stations.selectAll("path.station")
      .data(stations, d => d.StationId)
      .join("path")
      .attr("class", "station")
      .on("pointerenter", showStationTooltip)
      .on("pointermove", showStationTooltip)
      .on("pointerleave", hideTooltip);

    drawLegend(colorScale);

    const years = d3.sort(d3.union(fires.map(d => d.FireYear)));
    let currentYear = years[years.length - 1];
    let rulerControl;
    let firesForYear = [];
    let linksForYear = [];
    let fireSelection = layers.fires.selectAll("circle.fire");
    let linkSelection = layers.links.selectAll("path.fire-link");
    let animationFrame = null;
    let queuedFocus = null;

    function renderSemanticDetail(focus, firePoints) {
      const detail = focus ? firesForYear
        .map(fire => ({ fire, point: firePoints.get(fire.Serial) }))
        .filter(item => item.point.scale >= fisheyeSettings.detailThreshold)
        .sort((first, second) => second.point.scale - first.point.scale)
        .slice(0, 1) : [];

      layers.details.selectAll("text.fisheye-detail")
        .data(detail, d => d.fire.Serial)
        .join("text")
        .attr("class", "fisheye-detail")
        .attr("x", d => d.point.x + 12)
        .attr("y", d => d.point.y - 12)
        .text(d => {
          const station = d.fire.stationLink?.Station ?? "Aucune caserne associée";
          const duration = d.fire.stationLink
            ? ` · ${formatControlDuration(d.fire.stationLink.ControlDurationMinutes)}`
            : "";
          return `${d.fire.FireName || "Feu sans nom"} · ${station}${duration}`;
        });
    }

    function renderFisheye(focus = null, withTransition = false) {
      const districtPath = focus ? fisheyeGeoPath(projection, focus) : geoPath;
      const stationPoints = new Map(stations.map(station => [
        station.StationId,
        fisheyePoint(station.baseX, station.baseY, focus)
      ]));
      const firePoints = new Map(firesForYear.map(fire => [
        fire.Serial,
        fisheyePoint(fire.baseX, fire.baseY, focus)
      ]));
      const stationTarget = withTransition ? stationSelection.transition().duration(180) : stationSelection;
      const fireTarget = withTransition ? fireSelection.transition().duration(180) : fireSelection;
      const linkTarget = withTransition ? linkSelection.transition().duration(180) : linkSelection;
      const districtTarget = withTransition
        ? layers.districts.selectAll("path").transition().duration(180)
        : layers.districts.selectAll("path");

      districtTarget.attr("d", districtPath);

      stationTarget
        .attr("transform", d => {
          const point = stationPoints.get(d.StationId);
          return `translate(${point.x}, ${point.y})`;
        })
        .attr("d", d => {
          const point = stationPoints.get(d.StationId);
          return d3.symbol().type(d3.symbolSquare).size(82 * point.scale ** 2)();
        });

      fireTarget
        .attr("cx", d => firePoints.get(d.Serial).x)
        .attr("cy", d => firePoints.get(d.Serial).y)
        .attr("r", d => d.baseRadius * firePoints.get(d.Serial).scale);

      linkTarget.attr("d", d => connectionPathFromPoints(
        stationPoints.get(d.StationId),
        firePoints.get(d.FireSerial)
      ));

      renderSemanticDetail(focus, firePoints);
    }

    function scheduleFisheye(event) {
      queuedFocus = (() => {
        const [x, y] = d3.pointer(event, svg.node());
        return { x, y };
      })();
      if (animationFrame !== null) return;

      animationFrame = requestAnimationFrame(() => {
        renderFisheye(queuedFocus);
        animationFrame = null;
      });
    }

    function resetFisheye() {
      queuedFocus = null;
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
      renderFisheye(null, true);
    }

    function updateMap(year) {
      currentYear = +year;
      firesForYear = fires
        .filter(d => d.FireYear === currentYear)
        .map(fire => {
          const [baseX, baseY] = projection([fire.Long_DD, fire.Lat_DD]);
          return { ...fire, baseX, baseY, baseRadius: radiusScale(fire.EstTotalAcres) };
        });
      linksForYear = links.filter(d => d.FireYear === currentYear);

      linkSelection = layers.links.selectAll("path.fire-link")
        .data(linksForYear, d => d.FireSerial)
        .join("path")
        .attr("class", "fire-link")
        .on("pointerenter", showLinkTooltip)
        .on("pointermove", showLinkTooltip)
        .on("pointerleave", hideTooltip);

      fireSelection = layers.fires.selectAll("circle.fire")
        .data(firesForYear, d => d.Serial)
        .join("circle")
        .attr("class", "fire")
        .attr("fill", d => colorScale(d.Size_class))
        .on("pointerenter", showTooltip)
        .on("pointermove", showTooltip)
        .on("pointerleave", hideTooltip);

      resetFisheye();

      rulerControl?.move(currentYear);
      rulerSvg.attr("aria-valuemin", years[0])
        .attr("aria-valuemax", years[years.length - 1])
        .attr("aria-valuenow", currentYear)
        .attr("aria-valuetext", `Année ${currentYear}`);
      status.text(`${firesForYear.length} incendies, ${linksForYear.length} liaisons estimées et ${stations.length} casernes pertinentes affichés pour ${currentYear}.`);
    }

    svg.on("pointermove.fisheye", scheduleFisheye)
      .on("pointerleave.fisheye", resetFisheye);

    rulerControl = drawRuler(years, () => currentYear, updateMap);
    updateMap(currentYear);
  } catch (error) {
    console.error(error);
    status.text("La carte n'a pas pu charger les données.");
  }
}

initialise();
