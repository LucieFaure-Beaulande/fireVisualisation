const width = 1100;
const height = 700;
const margin = 28;
const sizeClasses = ["A", "B", "C", "D", "E", "F", "G"];

const svg = d3.select("#map")
  .attr("viewBox", `0 0 ${width} ${height}`)
  .attr("preserveAspectRatio", "xMidYMid meet");

svg.append("title").text("Incendies annuels de l'Oregon");

const layers = {
  districts: svg.append("g").attr("class", "districts-layer"),
  links: svg.append("g").attr("class", "links-layer"),
  stations: svg.append("g").attr("class", "stations-layer"),
  fires: svg.append("g").attr("class", "fires-layer"),
  legend: svg.append("g").attr("class", "legend-layer")
};

const yearSelect = d3.select("#year-select");
const status = d3.select("#status");
const tooltip = d3.select("#tooltip");

function drawLegend(colorScale, radiusScale) {
  const colorLegend = layers.legend.append("g")
    .attr("class", "color-legend")
    .attr("transform", "translate(42, 54)");

  colorLegend.append("text")
    .attr("class", "legend-title")
    .text("Classe de taille");

  colorLegend.selectAll("g")
    .data(sizeClasses)
    .join("g")
    .attr("transform", (d, i) => `translate(0, ${18 + i * 19})`)
    .each(function (d) {
      const item = d3.select(this);
      item.append("circle").attr("r", 6).attr("fill", colorScale(d));
      item.append("text").attr("x", 13).attr("dy", "0.35em").text(d);
    });

  const sizeLegend = layers.legend.append("g")
    .attr("class", "size-legend")
    .attr("transform", "translate(180, 54)");


}

function showTooltip(event, fire) {
  const name = fire.FireName || "Feu sans nom";
  tooltip
    .html(`<strong>${name}</strong><br>Classe ${fire.Size_class} · ${d3.format(",.2~f")(fire.EstTotalAcres)} acres`)
    .style("left", `${event.clientX + 14}px`)
    .style("top", `${event.clientY + 14}px`)
    .attr("hidden", null);
}

function hideTooltip() {
  tooltip.attr("hidden", true);
}

async function initialise() {
  try {
    const [rawFires, districts] = await Promise.all([
      loadFires(),
      d3.json("/data/districts.geojson")
    ]);

    const fires = rawFires.filter(d =>
      Number.isFinite(d.Lat_DD) &&
      Number.isFinite(d.Long_DD) &&
      Number.isFinite(d.EstTotalAcres) &&
      d.EstTotalAcres >= 0 &&
      Number.isFinite(d.FireYear)
    );

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

    drawLegend(colorScale, radiusScale);

    const years = d3.sort(d3.union(fires.map(d => d.FireYear)));
    yearSelect
      .selectAll("option")
      .data(years)
      .join("option")
      .attr("value", d => d)
      .text(d => d);

    function updateMap(year) {
      const firesForYear = fires.filter(d => d.FireYear === +year);

      layers.fires.selectAll("circle.fire")
        .data(firesForYear, d => d.Serial)
        .join(
          enter => enter.append("circle")
            .attr("class", "fire")
            .attr("cx", d => projection([d.Long_DD, d.Lat_DD])[0])
            .attr("cy", d => projection([d.Long_DD, d.Lat_DD])[1])
            .attr("r", 0)
            .attr("fill", d => colorScale(d.Size_class))
            .on("pointerenter", showTooltip)
            .on("pointermove", showTooltip)
            .on("pointerleave", hideTooltip)
            .call(enter => enter.transition().duration(300).attr("r", d => radiusScale(d.EstTotalAcres))),
          update => update
            .attr("fill", d => colorScale(d.Size_class))
            .call(update => update.transition().duration(300)
              .attr("cx", d => projection([d.Long_DD, d.Lat_DD])[0])
              .attr("cy", d => projection([d.Long_DD, d.Lat_DD])[1])
              .attr("r", d => radiusScale(d.EstTotalAcres))),
          exit => exit.call(exit => exit.transition().duration(200).attr("r", 0).remove())
        );

      status.text(`${firesForYear.length} incendies affichés pour ${year}.`);
    }

    yearSelect
      .property("value", years[years.length - 1])
      .on("change", event => updateMap(event.target.value));

    updateMap(yearSelect.property("value"));
  } catch (error) {
    console.error(error);
    status.text("La carte n'a pas pu charger les données.");
  }
}

initialise();
