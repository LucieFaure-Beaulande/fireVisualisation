/* global d3, topojson, FireAccessibility, FirePalette, FireTooltip, FireEmbed, loadFires */

// Choropleth of the land cover of Oregon, with the fires of the selected year on top of it

FireAccessibility.init()

// ---------- constants ----------

const width = 960            // size of the map (viewBox), the svg is then scaled to the card
const height = 680

const years = d3.range(2000, 2023)               // years of the fire dataset
const landYears = [2000, 2005, 2010, 2015, 2020]  // years of the land cover files (resources/)

// land cover classes of the files (property DN), in the order of the legend
// `code` is the color used on the hidden canvas to find the land cover under each fire
const landClasses = [
    { dn: 2, key: 'forest', label: 'Forest', code: [0, 255, 0] },
    { dn: 3, key: 'agriculture', label: 'Agriculture', code: [0, 0, 255] },
    { dn: 1, key: 'urban', label: 'Urban', code: [255, 0, 0] }
]
const otherClass = { dn: 0, key: 'other', label: 'Other (shrub, grassland, water…)' }
const allClasses = [...landClasses, otherClass]
const classByKey = Object.fromEntries(allClasses.map(c => [c.key, c]))

const causes = [
    { key: 'Human', label: 'Human', token: '--data-human' },
    { key: 'Lightning', label: 'Lightning', token: '--data-lightning' },
    { key: 'other', label: 'Under investigation', token: '--data-unknown' }
]

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const duration = reducedMotion ? 0 : 400

const formatNumber = d3.format(',')
const formatAcres = acres => acres < 10 ? d3.format(',.2~f')(acres) : d3.format(',.0f')(acres)
const formatPercent = d3.format('.1%')
const formatDate = d3.timeFormat('%B %-d, %Y')

// ---------- state ----------

let currentYear = years[0]
let currentCause = 'all'
let playTimer = null

// ---------- year requests ----------

// year changes requested in the same frame (dragging the ruler, messages of the home page) are merged:
// only the last one is drawn
let pendingYear = null

function requestYear(year) {
    const idle = pendingYear === null
    pendingYear = year
    if (idle) requestAnimationFrame(() => {
        const next = pendingYear
        pendingYear = null
        if (next !== currentYear) update(next)
    })
}

// embedded on the home page: the year comes from the shared ruler (see js/embed.js)
const embedded = document.documentElement.classList.contains('embed')
let embeddedYear = null   // last year received from the home page
let started = false       // true once the first drawing is done

if (embedded) {
    FireEmbed.onYear(year => {
        if (!years.includes(year)) return
        embeddedYear = year
        if (started) requestYear(year)
    })
}

// load the land cover maps one at a time, when the browser is idle
const whenIdle = callback => 'requestIdleCallback' in window
    ? requestIdleCallback(callback, { timeout: 3000 })
    : setTimeout(callback, 300)

function preloadLand(queue) {
    if (!queue.length) return
    whenIdle(async () => {
        try { await loadLand(queue[0]) } catch (_) { /* it is retried when the year is selected */ }
        preloadLand(queue.slice(1))
    })
}

// ---------- the land cover year used for a fire year ----------

// the last land cover map before (or at) the year: 2003 → 2000, 2022 → 2020
function landYearOf(year) {
    return d3.max(landYears.filter(y => y <= year))
}

// ---------- map ----------

const svg = d3.select('#map').append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('role', 'img')
    .attr('aria-label', 'Map of Oregon colored by land cover, with the fires of the selected year')

const defs = svg.append('defs')
const stateLayer = svg.append('g')
const landLayer = svg.append('g')
const hexLayer = svg.append('g').attr('class', 'hexes').attr('clip-path', 'url(#state-clip)')  // cut at the border
const fireLayer = svg.append('g')

let projection, path, boundary

// the land cover files, loaded once: year → { features, classAt, areaShare }
// each feature also holds its svg path (pathData), computed once when the file is loaded
const landCache = new Map()

function loadLand(landYear) {
    if (!landCache.has(landYear)) {
        let promise = d3.json(`resources/oregon_landcover_${landYear}.json`).then(topo => {
            let object = topo.objects[Object.keys(topo.objects)[0]]
            let features = topojson.feature(topo, object).features
                .map(f => ({ feature: f, cls: landClasses.find(c => c.dn === f.properties.DN) }))
                .filter(d => d.cls)

            // the svg path of each class is computed once here, so that drawing a year is only an attribute change
            features.forEach(d => { d.pathData = path(d.feature) })

            return Object.assign({ features }, rasterize(features))
        }).catch(error => {
            landCache.delete(landYear)   // the next call tries again
            throw error
        })
        landCache.set(landYear, promise)
    }
    return landCache.get(landYear)
}

// Draw the land cover on a hidden canvas, with one pure color per class.
// Then the class under a point is found by reading the color of its pixel (much faster than a
// point in polygon test on these big polygons), and the share of each class is the share of its pixels.
function rasterize(features) {
    let canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    let context = canvas.getContext('2d')
    let canvasPath = d3.geoPath(projection, context)

    context.fillStyle = 'rgb(0, 0, 0)'          // the whole state: "other"
    context.beginPath(); canvasPath(boundary); context.fill()
    features.forEach(d => {
        context.fillStyle = `rgb(${d.cls.code.join(',')})`
        context.beginPath(); canvasPath(d.feature); context.fill()
    })

    let pixels = context.getImageData(0, 0, width, height).data

    function classAt(x, y) {
        x = Math.round(x); y = Math.round(y)
        if (x < 0 || y < 0 || x >= width || y >= height) return null
        let i = (y * width + x) * 4
        if (pixels[i + 3] < 128) return null        // outside the state
        let [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]]
        let max = Math.max(r, g, b)
        if (max < 128) return otherClass
        return landClasses.find(c => c.code[[r, g, b].indexOf(max)] === 255)
    }

    // share of the state's area of each class (counted on the pixels of the canvas)
    let counts = new Map(allClasses.map(c => [c.key, 0]))
    let total = 0
    for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
            let cls = classAt(x, y)
            if (cls) { counts.set(cls.key, counts.get(cls.key) + 1); total++ }
        }
    }
    let areaShare = new Map(allClasses.map(c => [c.key, total ? counts.get(c.key) / total : 0]))

    return { classAt, areaShare }
}

function drawState() {
    stateLayer.selectAll('path')
        .data([boundary])
        .join('path')
        .attr('class', 'state')
        .attr('d', path)
        .on('mouseenter mousemove', event => showLandTooltip(event, otherClass))
        .on('mouseleave', () => FireTooltip.hide())
}

function drawLand(land) {
    landLayer.selectAll('path')
        .data(land.features, d => d.cls.key)
        .join('path')
        .attr('class', d => `land land-${d.cls.key}`)
        .style('fill', d => `var(--land-${d.cls.key})`)   // CSS variable: follows the palette chosen
        .attr('d', d => d.pathData)                        // computed once in loadLand
        .on('mouseenter mousemove', (event, d) => showLandTooltip(event, d.cls))
        .on('mouseleave', () => FireTooltip.hide())
}

function showLandTooltip(event, cls) {
    let land = currentLand
    if (!land) return
    FireTooltip.show(event,
        `<div class="tt-head">${cls.label}</div>` +
        `<div class="tt-big">${formatPercent(land.areaShare.get(cls.key))}<span class="tt-unit"> of Oregon</span></div>` +
        `<div class="tt-foot">Land cover ${landYearOf(currentYear)} (NLCD)</div>`)
}

// ---------- hexagonal grid: burned area per cell, shown with hatching ----------

const hexRadius = 16    // radius of a hexagon in pixels of the viewBox (about 11 km)

// burned acres → hatching level (0 to 4), the last level is a cross-hatching
const hatchThresholds = [10, 100, 1000, 10000]
const hatchLevel = d3.scaleThreshold(hatchThresholds, [0, 1, 2, 3, 4])
const hatchLabels = ['< 10 ac', '10 – 100 ac', '100 – 1,000 ac', '1,000 – 10,000 ac', '> 10,000 ac']
// spacing between the lines and their width, from light to dense
const hatchStyles = [
    { spacing: 9, width: 0.8 },
    { spacing: 7, width: 1.1 },
    { spacing: 5.5, width: 1.4 },
    { spacing: 4.5, width: 1.7 },
    { spacing: 4.5, width: 1.7, cross: true }
]

// pointy-top hexagons: center of the cell containing the point (x, y), using axial coordinates
function hexOf(x, y) {
    let q = (Math.sqrt(3) / 3 * x - y / 3) / hexRadius
    let r = (2 / 3 * y) / hexRadius
    // round the fractional cube coordinates to the nearest hexagon
    let s = -q - r
    let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s)
    let dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s)
    if (dq > dr && dq > ds) rq = -rr - rs
    else if (dr > ds) rr = -rq - rs
    return {
        id: `${rq},${rr}`,
        cx: hexRadius * Math.sqrt(3) * (rq + rr / 2),
        cy: hexRadius * 1.5 * rr
    }
}

const hexCorners = d3.range(6).map(i => {
    let angle = Math.PI / 180 * (60 * i - 30)
    return [hexRadius * Math.cos(angle), hexRadius * Math.sin(angle)]
})
const hexPath = 'M' + hexCorners.map(p => p.join(',')).join('L') + 'Z'

// group the fires by hexagon and sum their burned area
function binFires(list) {
    let bins = new Map()
    list.forEach(d => {
        let hex = hexOf(d.x, d.y)
        if (!bins.has(hex.id)) bins.set(hex.id, Object.assign(hex, { fires: [], acres: 0 }))
        let bin = bins.get(hex.id)
        bin.fires.push(d)
        bin.acres += d.fire.EstTotalAcres || 0
    })
    return Array.from(bins.values())
}

// the hatching patterns, redrawn when the palette or the contrast changes
function drawPatterns() {
    let color = FirePalette.token('--data-hatch') || '#000000'
    let factor = FireAccessibility.settings.contrast ? 1.5 : 1

    defs.selectAll('pattern')
        .data(hatchStyles)
        .join(enter => enter.append('pattern')
            .attr('id', (d, i) => `hatch-${i}`)
            .attr('patternUnits', 'userSpaceOnUse')
            .attr('patternTransform', 'rotate(45)'))
        .attr('width', d => d.spacing)
        .attr('height', d => d.spacing)
        .each(function (d) {
            let lines = [{ x1: 0, y1: 0, x2: 0, y2: d.spacing }]
            if (d.cross) lines.push({ x1: 0, y1: 0, x2: d.spacing, y2: 0 })
            d3.select(this).selectAll('line')
                .data(lines)
                .join('line')
                .attr('x1', l => l.x1).attr('y1', l => l.y1)
                .attr('x2', l => l.x2).attr('y2', l => l.y2)
                .attr('stroke', color)
                .attr('stroke-width', d.width * factor)
        })
}

function drawHexes(list, land) {
    let bins = binFires(list)

    hexLayer.selectAll('path')
        .data(bins, d => d.id)
        .join(
            enter => enter.append('path')
                .attr('class', 'hex')
                .attr('d', hexPath)
                .attr('transform', d => `translate(${d.cx},${d.cy})`)
                .style('opacity', 0)
                .call(e => e.transition().duration(duration).style('opacity', 1)),
            update => update,
            exit => exit.transition().duration(duration).style('opacity', 0).remove()
        )
        .attr('fill', d => `url(#hatch-${hatchLevel(d.acres)})`)
        .on('mouseenter mousemove', (event, d) => {
            d3.select(event.currentTarget).classed('hover', true).raise()
            showHexTooltip(event, d, land)
        })
        .on('mouseleave', event => {
            d3.select(event.currentTarget).classed('hover', false)
            FireTooltip.hide()
        })
}

function showHexTooltip(event, bin, land) {
    let largest = bin.fires.slice()
        .sort((a, b) => d3.descending(a.fire.EstTotalAcres, b.fire.EstTotalAcres))
        .slice(0, 3)
    // land cover of the fires of the cell
    let classes = d3.rollups(bin.fires, v => v.length, d => (land.classAt(d.x, d.y) || otherClass).label)
        .sort((a, b) => d3.descending(a[1], b[1]))
    FireTooltip.show(event,
        `<div class="tt-head">${formatNumber(bin.fires.length)} fire${bin.fires.length > 1 ? 's' : ''} in ${currentYear}</div>` +
        `<div class="tt-big">${formatAcres(bin.acres)}<span class="tt-unit"> acres burned</span></div>` +
        largest.map(d => `<div class="tt-line">${d.fire.FireName || 'Unnamed fire'}: ${formatAcres(d.fire.EstTotalAcres || 0)} ac</div>`).join('') +
        `<div class="tt-foot">Land cover of the fires: ${classes.map(([label, n]) => `${label} (${n})`).join(', ')}</div>`)
}

// ---------- fires ----------

let fires = []          // fires with a position, see init()
let showDots = false    // the fires can also be shown as small dots, on top of the hatching

function causeOf(fire) {
    return causes.find(c => c.key === fire.HumanOrLightning) || causes[causes.length - 1]
}

function firesOfYear(year) {
    if (currentCause === 'none') return []
    return fires.filter(f => f.fire.FireYear === year &&
        (currentCause === 'all' || f.fire.HumanOrLightning === currentCause))
}

// optional layer: one small dot per fire (same size for all, the burned area is shown by the hatching)
function drawFires(list, land) {
    let colors = Object.fromEntries(causes.map(c => [c.key, FirePalette.token(c.token)]))

    fireLayer.selectAll('circle')
        .data(showDots ? list : [], d => d.fire.Serial)
        .join(
            enter => enter.append('circle')
                .attr('class', 'fire')
                .attr('cx', d => d.x)
                .attr('cy', d => d.y)
                .attr('r', 0)
                .call(e => e.transition().duration(duration).attr('r', 2.4)),
            update => update,
            exit => exit.transition().duration(duration).attr('r', 0).remove()
        )
        .attr('fill', d => colors[causeOf(d.fire).key])
        .on('mouseenter mousemove', (event, d) => showFireTooltip(event, d, land))
        .on('mouseleave', () => FireTooltip.hide())
}

function showFireTooltip(event, d, land) {
    let fire = d.fire
    let cls = land.classAt(d.x, d.y)
    let date = fire.Ign_DateTime || fire.Discover_DateTime
    FireTooltip.show(event,
        `<div class="tt-head">${fire.FireName || 'Unnamed fire'}</div>` +
        `<div class="tt-big">${formatAcres(fire.EstTotalAcres || 0)}<span class="tt-unit"> acres</span></div>` +
        `<div class="tt-line">Cause: ${fire.HumanOrLightning}${fire.GeneralCause !== fire.HumanOrLightning ? ` — ${fire.GeneralCause}` : ''}</div>` +
        `<div class="tt-line">County: ${fire.County}</div>` +
        `<div class="tt-line">Land cover: ${cls ? cls.label : 'outside the map'}</div>` +
        (date ? `<div class="tt-foot">${formatDate(date)}</div>` : ''))
}

// ---------- side panel: key figures and legends ----------

function drawStats(list) {
    let acres = d3.sum(list, d => d.fire.EstTotalAcres)
    let largest = d3.greatest(list, d => d.fire.EstTotalAcres)
    let stats = [
        { label: 'Fires', value: formatNumber(list.length) },
        { label: 'Burned area (acres)', value: formatAcres(acres) },
        { label: 'Largest fire', value: largest ? (largest.fire.FireName || 'Unnamed') : '—' }
    ]
    d3.select('#stats').selectAll('.stat')
        .data(stats)
        .join(enter => {
            let stat = enter.append('div').attr('class', 'stat')
            stat.append('div').attr('class', 'label')
            stat.append('div').attr('class', 'value')
            return stat
        })
        .call(stat => stat.select('.label').text(d => d.label))
        .call(stat => stat.select('.value').text(d => d.value))
}

function drawLegends(land) {
    let legend = d3.select('#legend')
    legend.selectAll('.legend-title').data([0]).join('div').attr('class', 'legend-title')
        .text(`Land cover ${landYearOf(currentYear)} — share of the state`)

    // hover a class in the legend to highlight it on the map
    legend.selectAll('.legend-line')
        .data(allClasses)
        .join(enter => {
            let line = enter.append('div').attr('class', 'legend-line clickable')
            line.append('span').attr('class', 'legend-swatch')
            line.append('span').attr('class', 'legend-label')
            line.append('span').attr('class', 'legend-value')
            return line
        })
        .on('mouseenter', (event, cls) => highlightClass(cls, land))
        .on('mouseleave', () => highlightClass(null, land))
        .call(line => line.select('.legend-swatch').style('background', d => `var(--land-${d.key})`))
        .call(line => line.select('.legend-label').text(d => d.label))
        .call(line => line.select('.legend-value').text(d => formatPercent(land.areaShare.get(d.key))))

    // burned area: the hatching levels, drawn with the same patterns as the map
    let fireLegend = d3.select('#fireLegend')
    fireLegend.selectAll('.legend-title.hatch-title').data([0]).join('div')
        .attr('class', 'legend-title hatch-title').text('Burned area per cell (~11 km)')
    fireLegend.selectAll('.legend-line.hatch-line')
        .data(hatchLabels)
        .join(enter => {
            let line = enter.append('div').attr('class', 'legend-line hatch-line')
            let swatch = line.append('svg').attr('class', 'hatch-swatch').attr('width', 22).attr('height', 16)
            swatch.append('rect').attr('width', 22).attr('height', 16).attr('rx', 2)
            line.append('span').attr('class', 'legend-label')
            return line
        })
        .call(line => line.select('rect').attr('fill', (d, i) => `url(#hatch-${i})`))
        .call(line => line.select('.legend-label').text(d => d))

    // the causes, only when the fires are shown as dots
    fireLegend.selectAll('.legend-title.cause-title').data(showDots ? [0] : []).join('div')
        .attr('class', 'legend-title cause-title').text('Fires (dots)')
    fireLegend.selectAll('.legend-line.cause-line')
        .data(showDots ? causes : [])
        .join(enter => {
            let line = enter.append('div').attr('class', 'legend-line cause-line')
            line.append('span').attr('class', 'legend-swatch').style('border-radius', '50%')
            line.append('span').attr('class', 'legend-label')
            return line
        })
        .call(line => line.select('.legend-swatch').style('background', d => FirePalette.token(d.token)))
        .call(line => line.select('.legend-label').text(d => d.label))
}

function highlightClass(cls, land) {
    landLayer.selectAll('.land').classed('dimmed', d => cls && d.cls !== cls)
    stateLayer.select('.state').style('fill', cls && cls !== otherClass ? 'var(--color-surface)' : null)
    fireLayer.selectAll('.fire').classed('dimmed', d => cls && land.classAt(d.x, d.y) !== cls)
}

// ---------- year ruler: click or drag anywhere on it to select a year ----------

function drawRuler() {
    let rulerWidth = width, margin = { left: 30, right: 30 }
    let innerWidth = rulerWidth - margin.left - margin.right

    let rulerSvg = d3.select('#ruler').append('svg').attr('viewBox', `0 0 ${rulerWidth} 76`)
    let ruler = rulerSvg.append('g')
        .attr('class', 'ruler-g')
        .attr('transform', `translate(${margin.left}, 40)`)
        .attr('tabindex', 0)                 // focusable: left / right arrows change the year
        .attr('role', 'slider')
        .attr('aria-label', 'Year')
        .attr('aria-valuemin', years[0])
        .attr('aria-valuemax', years[years.length - 1])
        .style('outline', 'none')

    let yearScale = d3.scaleLinear(d3.extent(years), [0, innerWidth])

    // when there are many years, only some labels are written (all ticks are kept)
    let labelStep = Math.ceil(years.length / Math.max(1, Math.floor(innerWidth / 44)))

    ruler.append('g')
        .attr('class', 'axis')
        .call(d3.axisBottom(yearScale)
            .tickValues(years)
            .tickSizeOuter(0)
            .tickFormat((year, i) => i % labelStep === 0 ? year : ''))

    // the years with a land cover map
    ruler.selectAll('.snapshot')
        .data(landYears)
        .join('circle')
        .attr('class', 'snapshot')
        .attr('cx', d => yearScale(d)).attr('cy', 0)
        .attr('r', 4)
        .append('title').text(d => `Land cover map ${d}`)

    // invisible hit area, bigger than the axis to make the selection easy
    ruler.append('rect')
        .attr('x', -10).attr('y', -34)
        .attr('width', innerWidth + 20).attr('height', 70)
        .attr('fill', 'transparent')
        .attr('class', 'clickable')
        .style('cursor', 'pointer')
        .call(d3.drag().on('start drag', event => {
            // event.x is expressed in the coordinates of the ruler group
            let closest = d3.least(years, year => Math.abs(year - yearScale.invert(event.x)))
            stop()
            requestYear(closest)
        }))

    ruler.on('keydown', event => {
        let i = years.indexOf(pendingYear ?? currentYear)
        let next = null
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = years[Math.max(0, i - 1)]
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = years[Math.min(years.length - 1, i + 1)]
        if (event.key === 'Home') next = years[0]
        if (event.key === 'End') next = years[years.length - 1]
        if (next === null) return
        event.preventDefault()
        stop()
        requestYear(next)
    })

    // handle: circle on the axis + selected year above it
    let handleG = ruler.append('g').attr('class', 'handle').style('pointer-events', 'none')
    handleG.append('circle').attr('r', 8)
    handleG.append('text').attr('y', -16).attr('text-anchor', 'middle')

    return {
        move(year) {
            handleG.transition().duration(duration / 2).attr('transform', `translate(${yearScale(year)},0)`)
            handleG.select('text').text(year)
            ruler.attr('aria-valuenow', year)
                .attr('aria-valuetext', `${year}, land cover ${landYearOf(year)}`)
        }
    }
}

// ---------- play / pause ----------

const playButton = d3.select('#playButton')

function play() {
    if (currentYear === years[years.length - 1]) update(years[0])
    playButton.text('❚❚ Pause').attr('aria-pressed', 'true')
    playTimer = d3.interval(() => {
        let i = years.indexOf(currentYear)
        if (i >= years.length - 1) return stop()
        update(years[i + 1])
    }, 1200)
}

function stop() {
    if (playTimer) playTimer.stop()
    playTimer = null
    playButton.text('▶ Play').attr('aria-pressed', 'false')
}

playButton.on('click', () => playTimer ? stop() : play())

d3.select('#dotsToggle').on('change', function () {
    showDots = this.checked
    update(currentYear)
})

d3.selectAll('input[name="cause"]').on('change', function () {
    currentCause = this.value
    update(currentYear)
})

// ---------- update ----------

let rulerControl
let currentLand = null

async function update(year) {
    currentYear = year
    rulerControl.move(year)

    let landYear = landYearOf(year)
    let land = await loadLand(landYear)
    if (currentYear !== year) return   // another year was chosen while loading
    if (land !== currentLand) {
        currentLand = land
        drawLand(land)
    }

    let list = firesOfYear(currentYear)
    drawHexes(list, land)
    drawFires(list, land)
    drawStats(list)
    drawLegends(land)

    d3.select('#srLive').text(`${currentYear}: ${formatNumber(list.length)} fires, ` +
        `${formatAcres(d3.sum(list, d => d.fire.EstTotalAcres))} acres burned. Land cover ${landYear}.`)
}

// ---------- start ----------

async function init() {
    rulerControl = drawRuler()
    rulerControl.move(currentYear)

    let [boundaryData, fireData] = await Promise.all([
        d3.json('resources/oregon_boundary.geojson'),
        loadFires()
    ])
    boundary = boundaryData

    // Lambert conformal conic projection of Oregon (the projection of the state's own maps)
    projection = d3.geoConicConformal()
        .parallels([43, 45.5])
        .rotate([120.5, 0])
        .fitExtent([[10, 10], [width - 10, height - 10]], boundary)
    path = d3.geoPath(projection)

    // the fires with a position, projected once (the fire objects are not modified, see the README)
    fires = fireData
        .filter(fire => fire.Lat_DD !== null && fire.Long_DD !== null)
        .map(fire => {
            let [x, y] = projection([fire.Long_DD, fire.Lat_DD])
            return { fire, x, y }
        })

    // the hexagons are cut at the border of the state
    defs.append('clipPath').attr('id', 'state-clip').append('path').attr('d', path(boundary))
    drawPatterns()

    drawState()

    // embedded: start directly on the year of the home page ruler, instead of loading another year for nothing
    if (embeddedYear !== null) currentYear = embeddedYear
    await update(currentYear)

    // from now on, the year changes of the home page are drawn as they come
    started = true
    if (embeddedYear !== null && embeddedYear !== currentYear) requestYear(embeddedYear)

    // load the other land cover maps one at a time, when the browser is idle, the nearest years first
    const current = landYearOf(currentYear)
    preloadLand(landYears
        .filter(y => y !== current)
        .sort((a, b) => Math.abs(a - current) - Math.abs(b - current)))
}

// redraw when the palette changes (the colors of the fires are read when drawing)
FireAccessibility.onChange((settings, key) => {
    if (!['palette', 'contrast', 'reset'].includes(key)) return
    drawPatterns()
    if (currentLand) update(currentYear)
})

init().catch(error => {
    console.error(error)
    d3.select('#map').append('p').attr('class', 'empty').text('The data could not be loaded.')
})