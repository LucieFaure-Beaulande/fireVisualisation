// Heatmap page: loads the data, wires the controls of the page and the accessibility panel

import { loadData } from "./data.js";
import { createHeatmap } from "./heatmap.js";
import { createParallel } from "./parallel.js";

FireAccessibility.init();

const data = await loadData();

const heatmap = createHeatmap(data, {
    container: d3.select("#heatmap"),
    legend: d3.select("#heatmapLegend"),
    live: d3.select("#srLive"),
    onOpen: (county, year, month) => parallel.open(county, year, month)
});
const parallel = createParallel(data, { onClose: () => heatmap.focus() });

const yearSelect = d3.select("#yearSelect");
const layerSelect = d3.select("#layerSelect");
const trailsOption = layerSelect.select("option[value='trails']")
    .text(`Trails with a seasonal restriction (${data.trailsYear} only)`);

// The trail data is a current inventory without year: the layer is only available for the last year
function updateTrailsOption(year) {
    const available = year === data.trailsYear;
    trailsOption.property("disabled", !available);
    if (!available && layerSelect.property("value") === "trails") layerSelect.property("value", "none");
}

yearSelect.selectAll("option").data(data.years).join("option").attr("value", d => d).text(d => d);
yearSelect.property("value", heatmap.year)
    .on("change", function () {
        const year = +this.value;
        updateTrailsOption(year);
        heatmap.render({ year, layer: layerSelect.property("value") });
    });
layerSelect.on("change", function () { heatmap.render({ layer: this.value }); });
updateTrailsOption(heatmap.year);

// Settings that change the drawing of the charts (the other ones only change the CSS)
const redrawOn = ["textScale", "palette", "contrast", "reset"];
FireAccessibility.onChange((settings, key) => {
    if (!redrawOn.includes(key)) return;
    heatmap.render();
    parallel.render();
});

// The width of the heatmap depends on the available space: redraw it when the window is resized
let resizeTimer;
window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => heatmap.render(), 150);
});

heatmap.render();

// Embedded on the home page: the year comes from the shared ruler
if (document.documentElement.classList.contains('embed')) {
    FireEmbed.onYear(year => {
        if (!data.years.includes(year)) return
        yearSelect.property('value', year)
        updateTrailsOption(year)
        heatmap.render({ year, layer: layerSelect.property('value') })
    })
}