const width = 1100;
const height = 700;
const margin = 28;
const sizeClasses = ["A", "B", "C", "D", "E", "F", "G"];
const fisheyeSettings = {
  radius: 115,
  distortion: 0.35,
  maxScale: 4,
  detailThreshold: 1.8,
  dwellDelay: 700,
  openDuration: 400,
  closeDuration: 200,
  closeupDelay: 1000,
  closeupDuration: 500,
  closeupScale: 3,
  overviewDuration: 400,
  closeupFireScale: 2,
  closeupStationScale: 1.5,
  movementTolerance: 8,
  outsideOpacity: 0.3
};

const svg = d3.select("#map")
  .attr("viewBox", `0 0 ${width} ${height}`)
  .attr("preserveAspectRatio", "xMidYMid meet");

svg.append("title").text("Oregon wildfires by year");
const defs = svg.append("defs");
const focusGradient = defs.append("radialGradient")
  .attr("id", "fisheye-opacity")
  .attr("gradientUnits", "userSpaceOnUse")
  .attr("r", fisheyeSettings.radius);
focusGradient.append("stop").attr("offset", "0%").attr("stop-color", "white");
focusGradient.append("stop").attr("offset", "70%").attr("stop-color", "white");
const outsideStop = focusGradient.append("stop")
  .attr("offset", "100%")
  .attr("stop-color", "white")
  .attr("stop-opacity", 1);
defs.append("mask")
  .attr("id", "fisheye-mask")
  .attr("maskUnits", "userSpaceOnUse")
  .attr("maskContentUnits", "userSpaceOnUse")
  .attr("x", 0).attr("y", 0).attr("width", width).attr("height", height)
  .style("mask-type", "alpha")
  .append("rect")
  .attr("width", width).attr("height", height)
  .attr("fill", "url(#fisheye-opacity)");
defs.append("clipPath").attr("id", "map-clip")
  .append("rect").attr("width", width).attr("height", height);
const mapViewport = svg.append("g").attr("clip-path", "url(#map-clip)");
const mapContent = mapViewport.append("g").attr("class", "map-content");

const layers = {
  districts: mapContent.append("g").attr("class", "districts-layer"),
  links: mapContent.append("g").attr("class", "links-layer"),
  fires: mapContent.append("g").attr("class", "fires-layer"),
  stations: mapContent.append("g").attr("class", "stations-layer"),
  indicators: mapViewport.append("g").attr("class", "fisheye-indicators-layer")
    .attr("aria-hidden", "true").style("pointer-events", "none"),
  details: svg.append("g").attr("class", "fisheye-details-layer"),
  legend: svg.append("g").attr("class", "legend-layer")
};

const rulerSvg = d3.select("#year-ruler")
  .attr("viewBox", `0 0 ${width} 82`)
  .attr("preserveAspectRatio", "xMidYMid meet");
const status = d3.select("#status");
const tooltip = d3.select("#tooltip");
const returnButton = d3.select("#return-overview");

// Règle temporelle : clic ou glissement pour sélectionner une année.
function drawRuler(years, getCurrentYear, update) {
  // Keep one SVG unit per CSS pixel so labels remain readable on narrow screens.
  const bounds = rulerSvg.node().getBoundingClientRect();
  const textScale = parseFloat(FirePalette.token("--text-scale")) || 1;
  rulerSvg.attr("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
  rulerSvg.selectAll("*").remove();
  const rulerMargin = { left: 24 * textScale, right: 24 * textScale, top: 42 * textScale };
  const innerWidth = Math.max(1, bounds.width - rulerMargin.left - rulerMargin.right);
  const ruler = rulerSvg.append("g")
    .attr("transform", `translate(${rulerMargin.left}, ${rulerMargin.top})`);
  const yearScale = d3.scaleLinear(d3.extent(years), [0, innerWidth]);

  // Quand de nombreuses années sont disponibles, seules certaines étiquettes sont affichées.
  const labelStep = Math.ceil(years.length / Math.max(1, Math.floor(innerWidth / (48 * textScale))));

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
    .attr("class", "clickable")
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
  const handle = ruler.append("g").attr("class", "year-handle").style("pointer-events", "none");
  handle.append("circle")
    .attr("r", 8);
  handle.append("text")
    .attr("y", -16)
    .attr("text-anchor", "middle")
    .attr("font-weight", "bold");

  return {
    move(year) {
      handle.attr("transform", `translate(${yearScale(year)},0)`);
      handle.select("text").text(year);
    }
  };
}

function drawLegend(colorScale) {
  layers.legend.selectAll("*").remove();
  const legend = layers.legend.append("g");

  legend.append("text")
    .attr("class", "legend-title")
    .text("Fire size class");


  const colorLegend = legend.append("g");
  colorLegend.selectAll("g")
    .data(sizeClasses)
    .join("g")
    .each(function (d) {
      const item = d3.select(this);
      item.append("circle").attr("class", "legend-color").attr("r", 6).attr("fill", colorScale(d));
      item.append("text").attr("x", 13).attr("dy", "0.35em").text(d);
    });

  const stationLegend = legend.append("g");
  stationLegend.append("path")
    .attr("class", "station")
    .attr("d", d3.symbol().type(d3.symbolSquare).size(100));
  stationLegend.append("text")
    .attr("x", 11)
    .attr("dy", "0.35em")
    .text("Fire station");

  return function layout() {
    const cssWidth = svg.node().getBoundingClientRect().width;
    const unit = width / Math.max(1, cssWidth);
    const fontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.75;
    const row = fontSize * 1.9 * unit;
    const compact = window.matchMedia("(max-width: 600px)").matches;
    const padding = 16 * unit;
    const columns = compact ? Math.max(1, Math.min(7, Math.floor((cssWidth - 32) / (fontSize * 3.5)))) : 1;
    const columnWidth = (width - padding * 2) / columns;
    const rows = Math.ceil(sizeClasses.length / columns);
    legend.style("font-size", `${fontSize * unit}px`)
      .attr("transform", compact ? `translate(${padding},${height + row})` : `translate(${42},${54})`);
    colorLegend.attr("transform", `translate(0,${row})`);
    colorLegend.selectAll("g").attr("transform", (d, i) =>
      `translate(${(i % columns) * columnWidth},${Math.floor(i / columns) * row + row * 0.6})`);
    colorLegend.selectAll("circle").attr("r", 5 * unit);
    colorLegend.selectAll("text").attr("x", 13 * unit);
    stationLegend.attr("transform", `translate(0,${(rows + 2) * row})`);
    stationLegend.select("path").attr("d", d3.symbol().type(d3.symbolSquare).size((10 * unit) ** 2));
    stationLegend.select("text").attr("x", 13 * unit);
    const legendHeight = (rows + 3) * row;
    const viewHeight = compact ? height + legendHeight + row : height;
    svg.attr("viewBox", `0 0 ${width} ${viewHeight}`).style("aspect-ratio", `${width} / ${viewHeight}`);
    // Compensate for the responsive viewBox so SVG labels follow the text setting.
    svg.selectAll(".fisheye-progress text, .fisheye-detail").style("font-size", `${fontSize * unit}px`);
    svg.style("--map-label-size", `${fontSize * unit}px`);
  };
}

function positionTooltip(event) {
  const node = tooltip.node();
  const bounds = node.getBoundingClientRect();
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  const right = left + (viewport?.width ?? document.documentElement.clientWidth);
  const bottom = top + (viewport?.height ?? window.innerHeight);
  let x = event.clientX + 14;
  let y = event.clientY + 14;
  if (x + bounds.width > right - 8) x = event.clientX - bounds.width - 14;
  if (y + bounds.height > bottom - 8) y = event.clientY - bounds.height - 14;
  tooltip.style("left", `${Math.max(left + 8, Math.min(x, right - bounds.width - 8))}px`)
    .style("top", `${Math.max(top + 8, Math.min(y, bottom - bounds.height - 8))}px`);
}

function showTooltip(event, fire) {
  const name = fire.FireName || "Unnamed fire";
  const stationDescription = fire.stationLink
    ? `<br>Linked fire station: ${fire.stationLink.Station}`
    : "<br>No linked fire station";

  tooltip
    .html(`<strong>${name}</strong><br>Size class ${fire.Size_class} · ${d3.format(",.2~f")(fire.EstTotalAcres)} acres${stationDescription}`)
    .attr("hidden", null);
  positionTooltip(event);
}

function hideTooltip() {
  tooltip.attr("hidden", true);
}

function showStationTooltip(event, station) {
  tooltip
    .html(`<strong>${station.Station}</strong><br>${station.Agency}<br>${station.County} · ${station.FacilityType}<br>Unit: ${station.UnitNames}`)
    .attr("hidden", null);
  positionTooltip(event);
}

function showLinkTooltip(event, link) {
  tooltip
    .html(`<strong>${link.Station}</strong><br>→ ${link.FireName || "Unnamed fire"}<br>Estimated distance: ${d3.format(",.2~f")(link.DistanceKm)} km<br>Time to control: ${formatControlDuration(link.ControlDurationMinutes)}`)
    .attr("hidden", null);
  positionTooltip(event);
}

function formatControlDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "Unavailable";

  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;
  const parts = days > 0 ? [`${days} d`] : [];
  parts.push(`${hours} h`);
  if (remainingMinutes > 0) parts.push(`${remainingMinutes} min`);
  return parts.join(" ");
}

function fisheyePoint(baseX, baseY, focus, intensity = 1) {
  if (!focus || intensity === 0) return { x: baseX, y: baseY, scale: 1 };

  const deltaX = baseX - focus.x;
  const deltaY = baseY - focus.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance === 0) return {
    x: baseX, y: baseY,
    scale: 1 + (Math.min((fisheyeSettings.distortion + 1) / fisheyeSettings.distortion, fisheyeSettings.maxScale) - 1) * intensity
  };
  if (distance >= fisheyeSettings.radius) return { x: baseX, y: baseY, scale: 1 };

  const distortedDistance = (fisheyeSettings.distortion + 1) * fisheyeSettings.radius * distance /
    (fisheyeSettings.distortion * fisheyeSettings.radius + distance);
  const scale = 1 + (Math.min(distortedDistance / distance, fisheyeSettings.maxScale) - 1) * intensity;

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

// Projection et subdivision géographique effectuées une seule fois, avant l'animation.
function projectDistrict(feature, projection) {
  const polygons = [];
  let polygon;
  let ring;
  d3.geoStream(feature, projection.stream({
    polygonStart() { polygon = []; },
    polygonEnd() { polygons.push(polygon); },
    lineStart() { ring = []; },
    lineEnd() {
      if (ring.length) ring.push([...ring[0]]);
      polygon.push(ring);
    },
    point(x, y) { ring.push([x, y]); }
  }));
  return { type: "MultiPolygon", coordinates: polygons };
}

function fisheyeGeoPath(focus, intensity) {
  const transform = d3.geoTransform({
    point(baseX, baseY) {
      const point = fisheyePoint(baseX, baseY, focus, intensity);
      this.stream.point(point.x, point.y);
    }
  });

  return d3.geoPath(transform);
}

async function initialise() {
  try {
    const [rawFires, rawStations, validatedMappings, rawLinks, districts] = await Promise.all([
      loadFires("/data/fires-bubble-map.csv"),
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
        ControlDurationMinutes: Number(d.ControlDurationMinutes) > 0 ? Number(d.ControlDurationMinutes) : Number.NaN
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
    const projectedDistricts = districts.features.map(feature => projectDistrict(feature, projection));
    const geoPath = d3.geoPath();
    const colorScale = d3.scaleOrdinal()
      .domain(sizeClasses)
      .range(FirePalette.discrete(sizeClasses.length));
    const radiusScale = d3.scaleSqrt()
      .domain([0, d3.max(fires, d => d.EstTotalAcres)])
      .range([2, 26]);

    layers.districts.selectAll("path")
      .data(projectedDistricts)
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

    let layoutLegend = drawLegend(colorScale);

    const years = d3.sort(d3.union(fires.map(d => d.FireYear)));
    let currentYear = years[years.length - 1];
    let rulerControl;
    let firesForYear = [];
    let linksForYear = [];
    let fireSelection = layers.fires.selectAll("circle.fire");
    let linkSelection = layers.links.selectAll("path.fire-link");
    let lastGeometryFrame = null;
    let fisheyeEnabled = true;
    const fisheyeToggle = d3.select("#fisheye-toggle");
    const fisheyeState = d3.select("#fisheye-state");

    function renderSemanticDetail(focus, firePoints, view, closeupProgress) {
      const detail = focus ? firesForYear
        .map(fire => ({ fire, point: firePoints.get(fire.Serial) }))
        .filter(item => item.point.scale >= fisheyeSettings.detailThreshold)
        .sort((first, second) => second.point.scale - first.point.scale)
        .slice(0, 1) : [];

      layers.details.selectAll("text.fisheye-detail")
        .data(detail, d => d.fire.Serial)
        .join("text")
        .attr("class", "fisheye-detail")
        .attr("opacity", d => Math.min(1, (d.point.scale - fisheyeSettings.detailThreshold) / 0.4) * (1 - closeupProgress))
        .attr("x", d => view.k * d.point.x + view.x + 12)
        .attr("y", d => view.k * d.point.y + view.y - 12)
        .text(d => {
          const station = d.fire.stationLink?.Station ?? "No linked fire station";
          const duration = d.fire.stationLink
            ? ` · ${formatControlDuration(d.fire.stationLink.ControlDurationMinutes)}`
            : "";
          return `${d.fire.FireName || "Unnamed fire"} · ${station}${duration}`;
        });
    }

    function renderFisheye(focus = null, intensity = 0, frame = {}) {
      const closeupProgress = frame.closeupProgress ?? 0;
      const view = getCloseupTransform(focus, closeupProgress, width, height, fisheyeSettings.closeupScale);
      svg.attr("data-exploration-phase", frame.phase ?? "repos")
        .classed("closeup-active", ["rapprochement", "vue-rapprochée", "retour-carte"].includes(frame.phase));
      const showReturn = ["rapprochement", "vue-rapprochée"].includes(frame.phase) || closeupProgress > 0;
      // Le bouton disparaît au retour ; déplacer le focus clavier vers le contrôle voisin.
      if (!showReturn && document.activeElement === returnButton.node()) {
        fisheyeToggle.node().focus();
      }
      returnButton.property("hidden", !showReturn);
      const stateLabel = !fisheyeEnabled ? "Fisheye disabled"
        : frame.phase === "attente-rapprochement" ? "Hold still to open a close-up…"
          : ["rapprochement", "vue-rapprochée"].includes(frame.phase) ? "3× close-up. Press Esc to return."
            : frame.phase === "retour-carte" ? "Returning to the map…" : "Fisheye enabled";
      if (fisheyeState.text() !== stateLabel) fisheyeState.text(stateLabel);
      renderWaitIndicator(focus, frame);
      const geometryKey = `${focus?.x},${focus?.y},${intensity},${closeupProgress}`;
      // Pendant le compte à rebours, seul l'anneau change ; les milliers de tracés restent en cache.
      if (lastGeometryFrame === geometryKey) return;
      lastGeometryFrame = geometryKey;
      mapContent.attr("transform", `translate(${view.x},${view.y}) scale(${view.k})`);
      const active = focus && intensity > 0;
      const districtPath = active ? fisheyeGeoPath(focus, intensity) : geoPath;
      mapContent.attr("mask", active ? "url(#fisheye-mask)" : null);
      if (active) {
        focusGradient.attr("cx", focus.x).attr("cy", focus.y)
          .attr("fx", focus.x).attr("fy", focus.y);
        outsideStop.attr("stop-opacity", 1 - (1 - fisheyeSettings.outsideOpacity) * intensity);
      } else {
        outsideStop.attr("stop-opacity", 1);
      }
      const stationPoints = new Map(stations.map(station => [
        station.StationId,
        fisheyePoint(station.baseX, station.baseY, focus, intensity)
      ]));
      const firePoints = new Map(firesForYear.map(fire => [
        fire.Serial,
        fisheyePoint(fire.baseX, fire.baseY, focus, intensity)
      ]));
      layers.districts.selectAll("path").attr("d", districtPath);

      stationSelection
        .attr("transform", d => {
          const point = stationPoints.get(d.StationId);
          return `translate(${point.x}, ${point.y})`;
        })
        .attr("d", d => {
          const point = stationPoints.get(d.StationId);
          const targetScale = Math.min(view.k, fisheyeSettings.closeupStationScale);
          const symbolScale = (point.scale * (1 - closeupProgress) + targetScale * closeupProgress) / view.k;
          return d3.symbol().type(d3.symbolSquare).size(82 * symbolScale ** 2)();
        });

      fireSelection
        .attr("cx", d => firePoints.get(d.Serial).x)
        .attr("cy", d => firePoints.get(d.Serial).y)
        .attr("r", d => {
          const localScale = firePoints.get(d.Serial).scale;
          const targetScale = Math.min(view.k, fisheyeSettings.closeupFireScale);
          return d.baseRadius * (localScale * (1 - closeupProgress) + targetScale * closeupProgress) / view.k;
        });

      linkSelection.attr("d", d => connectionPathFromPoints(
        stationPoints.get(d.StationId),
        firePoints.get(d.FireSerial)
      ));

      renderSemanticDetail(active ? focus : null, firePoints, view, closeupProgress);
    }

    const ringRadius = 16;
    const ringLength = 2 * Math.PI * ringRadius;
    const waitIndicator = layers.indicators.append("g").attr("class", "fisheye-progress").attr("display", "none");
    waitIndicator.append("circle").attr("class", "fisheye-progress-track").attr("r", ringRadius);
    const waitArc = waitIndicator.append("circle")
      .attr("class", "fisheye-progress-fill").attr("r", ringRadius)
      .attr("stroke-dasharray", ringLength).attr("transform", "rotate(-90)");
    waitIndicator.append("text").attr("y", 32).attr("text-anchor", "middle").text("Opening close-up…");

    function renderWaitIndicator(focus, frame) {
      const waiting = focus && frame.phase === "attente-rapprochement";
      waitIndicator.attr("display", waiting ? null : "none");
      if (!waiting) return;
      waitIndicator.attr("transform", `translate(${focus.x},${focus.y})`);
      waitArc.attr("stroke-dashoffset", frame.reducedMotion ? 0 : ringLength * (1 - frame.waitProgress));
    }

    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fisheyeController = createFisheyeController({
      render: renderFisheye,
      settings: fisheyeSettings,
      reducedMotion: motionPreference.matches
    });
    motionPreference.addEventListener("change", event => {
      fisheyeController.setReducedMotion(event.matches);
    });

    function trackPointer(event) {
      if (event.pointerType === "touch") return;
      const [x, y] = d3.pointer(event, svg.node());
      // The responsive legend sits below the geographic viewport on small screens.
      if (x < 0 || x > width || y < 0 || y > height) {
        fisheyeController.leave();
        hideTooltip();
        return;
      }
      fisheyeController.move({ x, y, clientX: event.clientX, clientY: event.clientY, entered: event.type === "pointerenter" });
    }

    function returnToOverview() {
      fisheyeController.returnToOverview();
      hideTooltip();
    }

    returnButton.on("click", returnToOverview);
    d3.select(window).on("keydown.exploration", event => {
      if (event.key === "Escape" && fisheyeController.returnToOverview()) {
        event.preventDefault();
        hideTooltip();
      }
    });

    fisheyeToggle.on("click", () => {
      fisheyeEnabled = !fisheyeEnabled;
      fisheyeToggle
        .attr("aria-pressed", String(fisheyeEnabled))
        .text(fisheyeEnabled ? "Disable fisheye" : "Enable fisheye");
      fisheyeState.text(fisheyeEnabled ? "Fisheye enabled" : "Fisheye disabled");
      svg.classed("fisheye-enabled", fisheyeEnabled);
      fisheyeController.setEnabled(fisheyeEnabled);
      hideTooltip();
    });

    function updateMap(year) {
      lastGeometryFrame = null;
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

      fisheyeController.reset();
      hideTooltip();

      rulerControl?.move(currentYear);
      rulerSvg.attr("aria-valuemin", years[0])
        .attr("aria-valuemax", years[years.length - 1])
        .attr("aria-valuenow", currentYear)
        .attr("aria-valuetext", `Year ${currentYear}`);
      status.text(`Showing ${d3.format(",d")(firesForYear.length)} wildfires, ${d3.format(",d")(linksForYear.length)} estimated links, and ${d3.format(",d")(stations.length)} fire stations for ${currentYear}.`);
    }

    svg.on("pointerenter.fisheye", trackPointer)
      .on("pointermove.fisheye", trackPointer)
      .on("pointerleave.fisheye", () => {
        fisheyeController.leave();
        hideTooltip();
      })
      .on("pointercancel.fisheye", () => {
        fisheyeController.reset();
        hideTooltip();
      })
      .classed("fisheye-enabled", fisheyeEnabled);

    function layoutCharts() {
      rulerControl = drawRuler(years, () => currentYear, updateMap);
      rulerControl.move(currentYear);
      layoutLegend();
      hideTooltip();
    }
    window.addEventListener("fire:accessibilitychange", () => {
      colorScale.range(FirePalette.discrete(sizeClasses.length));
      fireSelection.attr("fill", d => colorScale(d.Size_class));
      layoutLegend = drawLegend(colorScale);
      layoutCharts();
    });
    const resizeObserver = new ResizeObserver(layoutCharts);
    resizeObserver.observe(document.querySelector(".controls"));
    window.addEventListener("resize", layoutCharts);
    document.fonts.ready.then(layoutCharts);
    layoutCharts();
    updateMap(currentYear);
    fisheyeToggle.property("disabled", false);
  } catch (error) {
    console.error(error);
    status.text("The map could not load the data.");
  }
}

initialise();
