// Heatmap counties × months: color = number of fires, plus an optional second layer

import { cellKey, trailKey } from "./data.js";
import { months, monthNames, monthLong, fmt, fmtUsd, pctOf, plainText, remToPx } from "./format.js";

const HATCH_ID = "hatchPublic";
const color = name => FirePalette.token(`--data-${name}`);

// Hatching pattern shared by the cells, the legend and the tooltip
function ensureHatchPattern() {
    let line = d3.select(`#${HATCH_ID} line`);
    if (line.empty()) {
        line = d3.select("body").append("svg")
            .attr("width", 0).attr("height", 0).attr("aria-hidden", true).style("position", "absolute")
          .append("defs").append("pattern").attr("id", HATCH_ID)
            .attr("patternUnits", "userSpaceOnUse").attr("width", 5).attr("height", 5)
            .attr("patternTransform", "rotate(45)")
          .append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 5);
    }
    const contrast = FireAccessibility.settings.contrast;
    line.style("stroke", color("hatch")).style("stroke-width", contrast ? 2.4 : 2).style("stroke-opacity", contrast ? 1 : 0.75);
}

// --- Small graphics used in the legend and the tooltip ---

// Horizontal gauge: "share" in color (or hatched), the rest in the background color
function gauge(share, fillColor, restColor, hatched) {
    const W = 204, H = 16, w = Math.max(0, Math.min(1, share)) * W;
    return `<svg viewBox="0 0 ${W} ${H}" style="display:block; width:12.75rem; height:1rem; margin-top:0.25rem" aria-hidden="true">` +
        `<rect width="${W}" height="${H}" fill="${restColor}"/>` +
        `<rect width="${w}" height="${H}" fill="${hatched ? `url(#${HATCH_ID})` : fillColor}"/>` +
        (share > 0 && share < 1 ? `<line x1="${w}" x2="${w}" y1="0" y2="${H}" stroke="#000" stroke-width="1.5"/>` : "") +
        `<rect width="${W}" height="${H}" fill="none" stroke="#888"/></svg>`;
}

const swatch = c => `<span class="legend-swatch" style="background:${c}"></span>`;
const hatchSwatch = background =>
    `<svg class="legend-swatch" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" fill="${background}"/>` +
    `<rect width="10" height="10" fill="url(#${HATCH_ID})"/></svg>`;
const circle = (r, style) =>
    `<svg width="${2 * r + 2}" height="${2 * r + 2}" aria-hidden="true" style="vertical-align:middle">` +
    `<circle cx="${r + 1}" cy="${r + 1}" r="${r}" style="${style}"/></svg>`;

export function createHeatmap(data, { container, legend, live, onOpen }) {
    const { statsByCell, trailsByCell, trailsYear, counties, max } = data;
    const state = { year: data.years[data.years.length - 1], layer: "none" };
    let focusCell = null;   // active cell for the keyboard navigation { county, month }

    function render(update = {}) {
        Object.assign(state, update);
        const { year, layer } = state;
        const { contrast, textScale } = FireAccessibility.settings;
        ensureHatchPattern();
        container.selectAll("*").remove();

        // Size: the chart grows with the text size (accessibility setting).
        const labelPx = remToPx(0.7);
        const margin = { top: 12, right: 24, bottom: Math.round(labelPx * 4.5), left: Math.round(labelPx * 9) };
        const available = container.node().clientWidth - margin.left - margin.right;
        const width = Math.round(Math.max(760, Math.min(760 * textScale, available)));
        const height = Math.round(Math.max(600 * textScale, counties.length * labelPx * 1.4));

        const x = d3.scaleBand().domain(months).range([0, width]).padding(0.05);
        const y = d3.scaleBand().domain(counties).range([height, 0]).padding(0.05);
        const bw = x.bandwidth(), bh = y.bandwidth();

        // The circles must fit in a cell: max radius = half of the smallest side
        const rMax = Math.min(bw, bh) / 2 - 1;
        const costRadius = d3.scaleSqrt().domain([0, max.cost]).range([0, rMax]);
        const trailRadius = d3.scaleSqrt().domain([0, max.trails]).range([0, rMax]);
        const fireColor = d3.scaleSequential(FirePalette.sequential()).domain([0, max.fires]);
        const statOf = d => statsByCell.get(cellKey(d.county, year, d.month));
        const trailsOf = d => year === trailsYear ? trailsByCell.get(trailKey(d.county, d.month)) : undefined;

        renderLegend({ layer, fireColor, costRadius, trailRadius });

        const root = container.append("svg")
            .attr("width", width + margin.left + margin.right)
            .attr("height", height + margin.top + margin.bottom)
            .attr("tabindex", 0)
            .attr("role", "application")
            .attr("aria-roledescription", "heatmap")
            .attr("aria-label", `Heatmap of the number of fires per county and month in ${year}. ` +
                "Use the arrow keys to move between the cells and Enter to open the fire details.");
        const svg = root.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

        svg.append("rect").attr("class", "plot-frame")
            .attr("x", -3).attr("y", -3).attr("width", width + 6).attr("height", height + 6);

        svg.append("g").attr("class", "axis")
            .attr("transform", `translate(0, ${height})`)
            .call(d3.axisBottom(x).tickFormat(m => monthNames[m - 1]))
            .selectAll("text")
                .style("text-anchor", "end")
                .attr("dx", "-.8em")
                .attr("dy", ".15em")
                .attr("transform", "rotate(-35)");
        svg.append("g").attr("class", "axis").call(d3.axisLeft(y));

        const cells = svg.selectAll(".cell-group")
            .data(counties.flatMap(county => months.map(month => ({ county, month }))))
            .join("g")
            .attr("class", "cell-group clickable")
            .attr("transform", d => `translate(${x(d.month)}, ${y(d.county)})`)
            .on("click", (event, d) => { focusCell = d; FireTooltip.hide(); onOpen(d.county, year, d.month); })
            .on("mouseenter mousemove", (event, d) => FireTooltip.show(event, cellTip(d)))
            .on("mouseleave", () => FireTooltip.hide());

        cells.append("rect")
            .attr("class", "cell")
            .attr("width", bw).attr("height", bh)
            .style("fill", d => { const s = statOf(d); return s ? fireColor(s.fireCount) : color("empty"); });

        // --- Second layer ---
        const overlay = cells.append("g").attr("class", "overlay");
        if (layer === "costs") {
            overlay.filter(d => statOf(d)?.suppressionCost > 0).append("circle")
                .attr("cx", bw / 2).attr("cy", bh / 2)
                .attr("r", d => Math.max(1, costRadius(statOf(d).suppressionCost)))
                .style("fill", "none").style("stroke", color("cost")).style("stroke-width", contrast ? 2 : 1.2);
        }
        else if (layer === "trails") {
            const withTrails = overlay.filter(d => trailsOf(d)?.total > 0);
            withTrails.append("circle")
                .attr("cx", bw / 2).attr("cy", bh / 2)
                .attr("r", d => Math.max(1, trailRadius(trailsOf(d).total)))
                .style("fill", color("trail-open")).style("fill-opacity", contrast ? 0.8 : 0.5)
                .style("stroke", color("trail-open")).style("stroke-width", 0.8);
            withTrails.filter(d => trailsOf(d).closed > 0).append("circle")
                .attr("cx", bw / 2).attr("cy", bh / 2)
                .attr("r", d => Math.max(1, trailRadius(trailsOf(d).closed)))
                .style("fill", color("trail-closed"));
        }
        else if (layer === "public_burned") {
            const share = d => (statOf(d)?.publicBurnedPct || 0) / 100;
            const hatched = overlay.filter(d => share(d) > 0);
            hatched.append("rect")
                .attr("width", d => bw * share(d)).attr("height", bh)
                .style("fill", `url(#${HATCH_ID})`);
            hatched.filter(d => share(d) < 1).append("line")
                .attr("x1", d => bw * share(d)).attr("x2", d => bw * share(d))
                .attr("y1", 0).attr("y2", bh)
                .style("stroke", color("hatch")).style("stroke-width", 1);
        }

        // --- Keyboard navigation: arrows = move between the cells, Enter / Space = open the details ---
        const focusLayer = svg.append("g");
        function drawFocus(announce) {
            focusLayer.selectAll("*").remove();
            if (!focusCell) return;
            const fx = x(focusCell.month), fy = y(focusCell.county);
            focusLayer.append("rect").attr("class", "cell-focus")
                .attr("x", fx - 1.5).attr("y", fy - 1.5).attr("width", bw + 3).attr("height", bh + 3);
            focusLayer.append("rect").attr("class", "cell-focus-inner")
                .attr("x", fx + 1).attr("y", fy + 1).attr("width", bw - 2).attr("height", bh - 2);
            const html = cellTip(focusCell, true);
            const box = focusLayer.node().getBoundingClientRect();
            FireTooltip.show({ clientX: box.right, clientY: box.top }, html);
            if (announce) live.text(plainText(html));
        }
        const firstCell = () => ({ county: counties[counties.length - 1], month: 1 });

        // The focus frame is only shown for the keyboard navigation (not after a mouse click)
        root.on("focus", () => {
                if (!root.node().matches(":focus-visible")) return;
                focusCell = focusCell || firstCell();
                drawFocus(true);
            })
            .on("blur", () => { focusLayer.selectAll("*").remove(); FireTooltip.hide(); })
            .on("keydown", event => {
                const keys = ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End", "Enter", " "];
                if (!keys.includes(event.key)) return;
                event.preventDefault();
                if (!focusCell) { focusCell = firstCell(); drawFocus(true); return; }
                let ci = counties.indexOf(focusCell.county), m = focusCell.month;
                switch (event.key) {
                    case "ArrowRight": m = Math.min(12, m + 1); break;
                    case "ArrowLeft":  m = Math.max(1, m - 1); break;
                    case "ArrowUp":    ci = Math.min(counties.length - 1, ci + 1); break;   // inverted y axis: up = end of the list
                    case "ArrowDown":  ci = Math.max(0, ci - 1); break;
                    case "Home":       m = 1; break;
                    case "End":        m = 12; break;
                    default:           // Enter / Space
                        FireTooltip.hide();
                        onOpen(focusCell.county, year, focusCell.month);
                        return;
                }
                focusCell = { county: counties[ci], month: m };
                drawFocus(true);
            });

        // --- Tooltip of a cell: only the information of the current layer ---
        function cellTip(d, keyboard) {
            const s = statOf(d);
            const head = `<div class="tt-head">${d.county} · ${monthLong[d.month - 1]} ${year}</div>`;
            const foot = `<div class="tt-foot">${keyboard ? "Enter" : "Click"}: fire details</div>`;
            const none = text => `<div class="tt-big tt-none">—</div><div class="tt-line">${text}</div>`;
            let body;

            if (layer === "costs") {
                const cost = s ? s.suppressionCost : 0;
                body = cost > 0
                    ? `<div class="tt-big" style="color:${color("cost")}">${fmtUsd(cost)}</div>` +
                      `<div class="tt-line">suppression cost${s.totalAcres > 0 ? ` · ≈ ${fmtUsd(cost / s.totalAcres)} per burned acre` : ""}</div>`
                    : none(data.costYears.has(year) ? "no reported cost this month" : "no cost data for this year (costs are known from 2014)");
            }
            else if (layer === "trails") {
                const t = trailsOf(d);
                body = t && t.total > 0
                    ? `<div class="tt-big">${Math.round(t.closed / t.total * 100)}% <span class="tt-unit">of the trails restricted</span></div>` +
                      gauge(t.closed / t.total, color("trail-closed"), color("trail-open")) +
                      `<div class="tt-line">${swatch(color("trail-closed"))}${fmt(t.closed)} restricted &nbsp; ` +
                      `${swatch(color("trail-open"))}${fmt(t.open)} open</div>`
                    : none("no USFS trails");
            }
            else if (layer === "public_burned") {
                if (s && s.totalAcres > 0) {
                    const share = s.publicBurnedPct / 100, light = FirePalette.token("--data-sequential-light");
                    body = `<div class="tt-big">${pctOf(share, 1)} <span class="tt-unit">on public land</span></div>` +
                        gauge(share, null, light, true) +
                        `<div class="tt-line">${hatchSwatch(light)}public ${fmt(s.totalAcres * share)} ac &nbsp; ` +
                        `${swatch(light)}private ${fmt(s.totalAcres * (1 - share))} ac</div>`;
                } else body = none("no burned area");
            }
            else {
                const n = s ? s.fireCount : 0;
                body = `<div class="tt-big">${n} <span class="tt-unit">fire${n > 1 ? "s" : ""}</span></div>` +
                    `<div class="tt-line">${s ? `${fmt(s.totalAcres)} acres burned` : "no recorded fire"}</div>`;
            }
            return head + body + (s ? foot : "");
        }
    }

    // --- Legend (HTML): color of the cells + second layer, with the same scales as the cells ---
    function renderLegend({ layer, fireColor, costRadius, trailRadius }) {
        const stops = d3.range(0, 1.01, 0.1).map(t => `${fireColor(t * max.fires)} ${t * 100}%`).join(", ");
        let html = `<div class="legend-item"><span class="legend-title">Number of fires</span>` +
            `<span class="legend-gradient" style="background: linear-gradient(to right, ${stops})"></span>` +
            `<span class="legend-scale"><span>0</span><span>${Math.round(max.fires / 2)}</span><span>${max.fires}</span></span></div>` +
            `<div class="legend-item"><span class="legend-title">&nbsp;</span><span>${swatch(color("empty"))}no fire</span></div>`;

        const { contrast } = FireAccessibility.settings;
        if (layer === "costs") {
            const style = `fill:none; stroke:${color("cost")}; stroke-width:${contrast ? 2 : 1.2}`;
            html += `<div class="legend-item"><span class="legend-title">Suppression cost (circle area ∝ cost)</span><span class="legend-row">` +
                [max.cost / 10, max.cost / 2, max.cost].map(v =>
                    `<span>${circle(Math.max(1, costRadius(v)), style)} ${d3.format("$.2~s")(v).replace("G", "B")}</span>`).join("") +
                `</span></div>`;
        }
        else if (layer === "trails") {
            const open = `fill:${color("trail-open")}; fill-opacity:${contrast ? 0.8 : 0.5}; stroke:${color("trail-open")}`;
            html += `<div class="legend-item"><span class="legend-title">USFS trails, current inventory (circle area ∝ number)</span><span class="legend-row">` +
                `<span>${circle(Math.max(1, trailRadius(max.trails)), open)} all trails (max ${fmt(max.trails)})</span>` +
                `<span>${circle(Math.max(1, trailRadius(max.trails / 3)), `fill:${color("trail-closed")}`)} with a seasonal restriction that month</span></span></div>`;
        }
        else if (layer === "public_burned") {
            const background = fireColor(max.fires * 0.35);
            html += `<div class="legend-item"><span class="legend-title">Hatching = share of the burned area on public land</span><span class="legend-row">` +
                [0, 0.25, 0.5, 1].map(p =>
                    `<span><svg class="legend-hatch" viewBox="0 0 40 13" aria-hidden="true"><rect width="40" height="13" fill="${background}"/>` +
                    `<rect width="${40 * p}" height="13" fill="url(#${HATCH_ID})"/>` +
                    (p > 0 && p < 1 ? `<line x1="${40 * p}" x2="${40 * p}" y1="0" y2="13" stroke="${color("hatch")}"/>` : "") +
                    `</svg> ${p * 100}%</span>`).join("") +
                `</span></div>`;
        }
        legend.html(html);
    }

    return {
        render,
        get year() { return state.year; },
        get layer() { return state.layer; },
        focus() { container.select("svg").node()?.focus(); }
    };
}
