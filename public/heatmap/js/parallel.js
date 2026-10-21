// Parallel coordinates of the fires of a cell (county × month), in a dialog

import { cellKey, PUBLIC, PRIVATE } from "./data.js";
import { monthLong, fmt, fmtPct, pctOf, plural, truncate, remToPx } from "./format.js";

const DIMS = [
    { key: "category", title: "Land" },
    { key: "owner",    title: "Owner" },
    { key: "origin",   title: "Origin" },
    { key: "general",  title: "General cause" },
    { key: "specific", title: "Specific cause" }
];
const GAP = 14;               // space between two categories of an axis (px)

const color = name => FirePalette.token(`--data-${name}`);
const landColors = () => ({ [PUBLIC]: color("public"), [PRIVATE]: color("private") });

export function createParallel(data, { onClose }) {
    const { firesByCell, publicLand } = data;
    const el = {
        dialog: d3.select("#pcDialog"),
        backdrop: d3.select("#pcBackdrop"),
        title: d3.select("#pcTitle"),
        legend: d3.select("#pcLegend"),
        summary: d3.select("#pcSummary"),
        info: d3.select("#pcInfo"),
        chart: d3.select("#pcChart"),
        weightBy: d3.select("#weightBy")
    };
    let current = null;   // { county, year, month, fires }

    const hideInfo = () => el.info.attr("hidden", true).html("");
    const showInfo = html => {
        el.info.attr("hidden", null).html(`<button type="button" class="info-close" aria-label="Close the details">✕</button>${html}`);
        el.info.select(".info-close").on("click", hideInfo);
    };

    function open(county, year, month) {
        const fires = (firesByCell.get(cellKey(county, year, month)) || []).filter(f => f.acres > 0);
        current = { county, year, month, fires };
        el.dialog.attr("hidden", null);
        el.backdrop.attr("hidden", null);
        render();
        document.getElementById("pcClose").focus();
    }

    function close() {
        el.dialog.attr("hidden", true);
        el.backdrop.attr("hidden", true);
        FireTooltip.hide();
        current = null;
        onClose();
    }

    function render() {
        if (!current) return;
        const { county, year, month, fires } = current;
        // Thickness of the ribbons: burned area (acres) or number of fires
        const byAcres = el.weightBy.property("value") === "acres";
        const wOf = f => byAcres ? f.acres : 1;
        const MIN_SLOT = byAcres ? 1 : 0;      // by area, each fire stays visible (≥ 1 px)
        const colors = landColors();
        const colorOf = f => colors[f.category];
        // Colour-blind palette: the private land also has a pattern, so that it does not rely on the color only
        const patterned = category => FireAccessibility.settings.palette === "cvd" && category === PRIVATE;

        el.title.text(`${county} County — ${monthLong[month - 1]} ${year}: causes of the fires`);
        // Legend: one square per land type, hatched like the ribbons with the colour-blind palette
        el.legend.html(Object.entries(colors)
            .filter(([k]) => fires.some(f => f.category === k))
            .map(([k, c]) => `<span><svg width="14" height="14" aria-hidden="true"><rect width="14" height="14" rx="2" fill="${c}"/>` +
                (patterned(k) ? '<path d="M-2,6 6,-2 M-2,14 14,-2 M6,16 16,6" stroke="#fff" stroke-width="2.5" stroke-opacity="0.8"/>' : "") +
                `</svg>${k === PUBLIC ? "Public land" : "Private / other land"}</span>`).join(""));

        el.chart.selectAll("*").remove();
        hideInfo();
        FireTooltip.hide();
        if (!fires.length) {
            el.summary.text("No fire with a reported burned area this month in this county.");
            return;
        }

        // --- Order of the categories and sort of the fires (limits the crossings) ---
        const order = {};
        DIMS.forEach(dim => {
            const weights = d3.rollups(fires, v => d3.sum(v, wOf), f => f[dim.key]);
            const publicFirst = c => dim.key === "owner" ? (fires.find(f => f.owner === c).category === PUBLIC ? 0 : 1) : 0;
            const unknownLast = c => /^(Unspecified|Under Invest)/.test(c) ? 1 : 0;
            order[dim.key] = weights.sort((a, b) =>
                (dim.key === "category" ? (a[0] === PUBLIC ? -1 : 1) : 0) ||
                publicFirst(a[0]) - publicFirst(b[0]) || unknownLast(a[0]) - unknownLast(b[0]) || b[1] - a[1]
            ).map(d => d[0]);
        });
        const rank = Object.fromEntries(Object.entries(order).map(([k, list]) => [k, new Map(list.map((c, i) => [c, i]))]));
        const sorted = fires.slice().sort((a, b) => {
            for (const dim of DIMS) {
                const diff = rank[dim.key].get(a[dim.key]) - rank[dim.key].get(b[dim.key]);
                if (diff) return diff;
            }
            return b.acres - a.acres;   // same path: the biggest fires first
        });
        const totalAcres = d3.sum(sorted, f => f.acres);

        // --- Size: the height follows the number of fires and categories, within the screen ---
        // Width: the one of the dialog, and at least 60 rem so that the labels keep their room with a bigger text
        // (the chart then scrolls horizontally)
        const W = Math.max(el.chart.node().clientWidth, Math.round(remToPx(60)));
        const maxCats = d3.max(Object.values(order), list => list.length);
        const gaps = GAP * (maxCats - 1);
        // room taken by the title, the controls, the summary and the note (≈ 23 rem)
        const maxH = Math.max(300, window.innerHeight * 0.92 - remToPx(23));
        const H = Math.max(gaps + 200, Math.min(720, maxH, Math.max(320, Math.min(560, sorted.length * 7 + 200)) + gaps));
        const margin = { top: Math.round(remToPx(2)), right: 16, bottom: 10, left: 36 };
        const w = W - margin.left - margin.right;
        // Last axis moved to the left: its labels (specific causes) use the right margin
        const xAxis = d3.scalePoint().domain(DIMS.map(d => d.key)).range([0, w - remToPx(13.5)]);
        const MIN_BAND = remToPx(0.875);   // min height of a category, for its label

        // Axes: stacked blocks, height ∝ chosen measure (with a min height);
        // each fire takes a slot of thickness ∝ its measure (≥ MIN_SLOT)
        const totalW = d3.sum(sorted, wOf) || 1;
        const minBandOf = c => Math.max(MIN_BAND, c.fires.length * MIN_SLOT);
        const bands = {};
        DIMS.forEach(dim => {
            const cats = order[dim.key].map(name => ({ name, fires: sorted.filter(f => f[dim.key] === name) }));
            cats.forEach(c => c.w = d3.sum(c.fires, wOf));
            const usable = H - GAP * (cats.length - 1);
            cats.forEach(c => c.h = c.w / totalW * usable);
            const small = cats.filter(c => c.h < minBandOf(c));
            if (small.length && small.length < cats.length) {
                small.forEach(c => c.h = minBandOf(c));
                const big = cats.filter(c => !small.includes(c)), bigSum = d3.sum(big, c => c.w) || 1;
                const rest = usable - d3.sum(small, c => c.h);
                big.forEach(c => c.h = c.w / bigSum * rest);
            }
            let y = 0;
            cats.forEach(c => {
                c.y0 = y; y += c.h + GAP;
                // Slots of the fires in the block: ∝ measure, with a minimum, the rest shared by the biggest ones
                const minS = Math.min(MIN_SLOT, c.h / c.fires.length);
                const raw = c.fires.map(f => wOf(f) / (c.w || 1) * c.h);
                const isSmall = raw.map(r => r < minS);
                const bigRaw = d3.sum(raw.filter((r, i) => !isSmall[i])) || 1;
                const avail = c.h - isSmall.filter(Boolean).length * minS;
                let cy = c.y0;
                c.fires.forEach((f, i) => {
                    const slot = isSmall[i] ? minS : raw[i] / bigRaw * avail;
                    f._y = f._y || {}; f._slot = f._slot || {};
                    f._y[dim.key] = cy + slot / 2;
                    f._slot[dim.key] = slot;
                    cy += slot;
                });
            });
            bands[dim.key] = cats;
        });

        const rootSvg = el.chart.append("svg")
            .attr("viewBox", `0 0 ${W} ${H + margin.top + margin.bottom}`)
            .attr("role", "group")
            .attr("aria-label", `Parallel coordinates of the ${sorted.length} fires of ${county} in ${monthLong[month - 1]} ${year}. ` +
                `The thickness of the ribbons and the values of the categories follow ${byAcres ? "the burned area" : "the number of fires"}.`)
            .attr("width", W).style("display", "block");
        const svg = rootSvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

        // Ribbon patterns (colour-blind palette): color + white hatching
        const defs = rootSvg.append("defs");
        const patternFor = c => {
            const id = "rib-" + c.replace("#", "");
            if (defs.select("#" + id).empty()) {
                const p = defs.append("pattern").attr("id", id).attr("patternUnits", "userSpaceOnUse")
                    .attr("width", 6).attr("height", 6).attr("patternTransform", "rotate(45)");
                p.append("rect").attr("width", 6).attr("height", 6).attr("fill", c);
                p.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 6)
                    .attr("stroke", "#fff").attr("stroke-width", 2.5).attr("stroke-opacity", 0.8);
            }
            return `url(#${id})`;
        };

        const fireTip = f => `<div class="tt-head">${f.name}</div>${fmt(f.acres, 2)} acres · ${f.category === PUBLIC ? "public land" : "private / other land"}` +
                             `<br>${f.owner}<br>Cause: ${f.origin} › ${f.general} › ${f.specific}`;
        const xs = DIMS.map(d => xAxis(d.key));
        const xLast = xs[xs.length - 1];

        // --- Ribbons: fires with the same path on all the axes ---
        const groups = d3.groups(sorted, f => DIMS.map(d => f[d.key]).join("|")).map(([key, list]) => ({ key, fires: list }));
        const ribbonPath = list => {
            if (!list.length) return null;
            const top = DIMS.map(d => d3.min(list, f => f._y[d.key] - f._slot[d.key] / 2));
            const bot = DIMS.map((d, i) => Math.max(d3.max(list, f => f._y[d.key] + f._slot[d.key] / 2), top[i] + 1));
            let p = `M${xs[0]},${top[0]}`;
            for (let i = 0; i < xs.length - 1; i++) {
                const xm = (xs[i] + xs[i + 1]) / 2;
                p += `C${xm},${top[i]} ${xm},${top[i + 1]} ${xs[i + 1]},${top[i + 1]}`;
            }
            p += `L${xLast},${bot[xs.length - 1]}`;
            for (let i = xs.length - 1; i > 0; i--) {
                const xm = (xs[i] + xs[i - 1]) / 2;
                p += `C${xm},${bot[i]} ${xm},${bot[i - 1]} ${xs[i - 1]},${bot[i - 1]}`;
            }
            return p + "Z";
        };
        const groupTitle = g => DIMS.map(d => g.fires[0][d.key]).join(" › ");

        // Full ribbons in grey (visible only when a filter is active) + filtered colored ribbons
        const ghosts = svg.append("g").selectAll("path").data(groups).join("path")
            .attr("class", "pc-ghost").attr("d", g => ribbonPath(g.fires)).attr("hidden", true);
        const ribbons = svg.append("g").selectAll("path").data(groups).join("path")
            .attr("class", "pc-ribbon clickable")
            .attr("d", g => ribbonPath(g.fires))
            .style("fill", g => patterned(g.fires[0].category) ? patternFor(colorOf(g.fires[0])) : colorOf(g.fires[0]))
            .on("mouseenter", (e, g) => {
                const list = g.fires.filter(active);
                FireTooltip.show(e, list.length === 1 ? fireTip(list[0])
                    : `<div class="tt-head">${plural(list.length, "fire")} · ${fmt(d3.sum(list, f => f.acres))} acres</div>${groupTitle(g)}`);
            })
            .on("mousemove", FireTooltip.move)
            .on("mouseleave", FireTooltip.hide)
            .on("click", (e, g) => {
                pin(g.fires);
                if (g.fires.length === 1) showFire(g.fires[0]); else showGroup(g.fires.filter(active), groupTitle(g));
            });

        // --- Axes: blocks, clickable labels, brushes ---
        const filters = new Map();   // dimension key -> [y0, y1]
        const brushes = new Map();
        DIMS.forEach(dim => {
            const g = svg.append("g").attr("transform", `translate(${xAxis(dim.key)},0)`);
            g.append("text").attr("class", "pc-axis-title").attr("y", -remToPx(1)).attr("text-anchor", "middle").text(dim.title);
            g.append("line").attr("class", "pc-axis-line").attr("y1", 0).attr("y2", H);

            bands[dim.key].forEach(c => {
                g.append("rect").attr("class", "pc-band").attr("x", -3).attr("width", 6)
                    .attr("y", c.y0).attr("height", Math.max(c.h, 1));
                const acres = d3.sum(c.fires, f => f.acres);
                const filterOn = () => brushes.get(dim.key).moveTo([c.y0 - 1, c.y0 + c.h + 1]);
                // Clickable label, also with the keyboard (Tab + Enter / Space)
                const t = g.append("text").attr("class", "pc-cat halo clickable")
                    .attr("x", 13).attr("y", c.y0 + c.h / 2).attr("dy", "0.35em")
                    .attr("tabindex", 0).attr("role", "button")
                    .attr("aria-label", `Filter ${dim.title}: ${c.name}, ${plural(c.fires.length, "fire")}, ${fmt(acres)} acres`)
                    .on("click", filterOn)
                    .on("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); filterOn(); } });
                t.append("tspan").text(truncate(c.name, 22));
                t.append("tspan").attr("class", "n").text(byAcres ? ` ${fmt(acres)} ac` : ` ${c.fires.length}`);
                t.append("title").text(`${c.name}\n${plural(c.fires.length, "fire")} · ${fmt(acres, 2)} acres (${pctOf(acres, totalAcres)} of the burned area)\nClick to filter`);
            });

            const brush = d3.brushY().extent([[-10, 0], [10, H]])
                .on("start brush end", ({ selection }) => {
                    if (selection) filters.set(dim.key, selection); else filters.delete(dim.key);
                    applyFilters();
                });
            const brushGroup = g.append("g").attr("class", "brush").attr("aria-hidden", true).call(brush);
            brushes.set(dim.key, {
                moveTo: sel => brushGroup.call(brush.move, sel),
                clear: () => brushGroup.call(brush.move, null)
            });
        });

        d3.select("#resetBrush").on("click", () => brushes.forEach(b => b.clear()));

        function active(f) { return [...filters].every(([k, [a, b]]) => f._y[k] >= a && f._y[k] <= b); }

        function applyFilters() {
            // Ribbons: only the selected fires are kept (the ribbon gets thinner), the rest in grey behind
            ghosts.attr("hidden", filters.size ? null : true);
            ribbons.attr("d", g => ribbonPath(g.fires.filter(active)))
                   .attr("hidden", g => g.fires.some(active) ? null : true);
            summarize(sorted.filter(active), filters.size > 0);
            pin([]);
            hideInfo();
        }

        // --- Highlight + details of a clicked ribbon ---
        function pin(list) {
            const ids = new Set(list.map(f => f.id));
            ribbons.classed("pin", g => list.length > 0 && g.fires.every(f => ids.has(f.id)));
        }
        const dot = f => `<span class="dot" style="background:${colorOf(f)}"></span>`;
        function showFire(f) {
            const land = publicLand.get(county);
            showInfo(`${dot(f)}<b>${f.name}</b> — ${fmt(f.acres, 2)} acres (${pctOf(f.acres, totalAcres)} of the month's burned area)` +
                `<br>${f.category} · ${f.owner}` +
                (f.category === PUBLIC && land ? ` (${fmtPct(f.acres / land * 100)} of the county's public land)` : "") +
                `<br>Cause: ${f.origin} › ${f.general} › ${f.specific}`);
        }
        function showGroup(list, title) {
            const acres = d3.sum(list, f => f.acres);
            const biggest = d3.greatest(list, f => f.acres);
            showInfo(`${dot(list[0])}<b>${plural(list.length, "fire")} · ${fmt(acres)} acres</b> (${pctOf(acres, totalAcres)} of the month's burned area)` +
                `<br>${title}` + (list.length > 1 ? `<br>Biggest: ${biggest.name} (${fmt(biggest.acres)} acres)` : ""));
        }

        // --- Summary: public share (by area AND by number) and main causes of the selection ---
        function summarize(sel, filtered) {
            if (!sel.length) { el.summary.text("No fire matches the filters."); return; }
            const total = d3.sum(sel, f => f.acres);
            const pub = d3.sum(sel.filter(f => f.category === PUBLIC), f => f.acres);
            const nPub = sel.filter(f => f.category === PUBLIC).length;
            const land = publicLand.get(county);
            const biggest = d3.greatest(sel, f => f.acres);
            const top = d3.rollups(sel, v => d3.sum(v, f => f.acres), f => f.general).sort((a, b) => b[1] - a[1]).slice(0, 3);
            el.summary.html(
                `<b>${filtered ? "Selection" : "This month"}: ${plural(sel.length, "fire")} · ${fmt(total)} acres</b>` +
                `<br>Public land: <b>${pctOf(pub, total)} of the burned area</b>` +
                (land && pub > 0 ? ` (${fmtPct(pub / land * 100)} of the county's public land)` : "") +
                ` · ${fmt(nPub)} of ${plural(sel.length, "fire")} by number` +
                (sel.length > 1 && biggest.acres / total > 0.5
                    ? ` <span class="muted">— including ${biggest.name}: ${fmt(biggest.acres)} ac (${pctOf(biggest.acres, total)} of the area)</span>` : "") +
                `<br>Main causes (by area): ` + top.map(([c, a]) => `${c} ${pctOf(a, total)}`).join(" · "));
        }

        applyFilters();
    }

    // --- Dialog: closing, and Tab that stays inside while it is open ---
    d3.select("#pcClose").on("click", close);
    el.backdrop.on("click", close);
    d3.select(window).on("keydown.parallel", e => {
        if (!current) return;
        if (e.key === "Escape") { close(); return; }
        if (e.key === "Tab") {
            const focusables = [...el.dialog.node().querySelectorAll("button, select, input, [tabindex='0']")]
                .filter(n => n.getClientRects().length);
            if (!focusables.length) return;
            const first = focusables[0], last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    });
    el.weightBy.on("change", render);

    return { open, render };
}
