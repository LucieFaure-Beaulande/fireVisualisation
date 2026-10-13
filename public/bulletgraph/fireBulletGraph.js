// Bullet graph: one year of fires compared to all the other years
// requires d3, theme.js and fireDataBulletGraph.js (loadFireStats) to be loaded first
//
// 2 rows: number of fires | burned acres
// - black bar       : value of the selected year
// - hatched part    : (burned acres row) acres of the largest fire of the year, only visible with the black bar
// - hover on a bar  : the bar is split by cause (colors + percentages), legend on the side
// - click on a bar  : pin / unpin the cause view of this bar (black bar <-> causes)
// - black marker    : median (or mean) of all years, only visible with the black bar
// - grey background : quartile ranges of all years (0-Q1, Q1-Q2, Q2-Q3, Q3-max)
// - ruler below     : click / drag / arrow keys to change the year
// - legend (side)   : reading guide + quartile explanation, a tooltip (hover) on every entry

const bulletDefaults = {
    referenceStat: 'median',   // 'median' (robust to extreme years) or 'mean'
    year: null,                // initial year, null = most recent year
    width: 1100,
    margin: { top: 30, right: 270, bottom: 20, left: 150 },   // right margin holds the legend
    rowHeight: 60,
    rowGap: 60,
    barColor: theme.text       // fill of the bars when the causes are not displayed (see theme.js)
}

// one row per metric: key in the yearly stats, label, value format, axis format
// hatch: true = the acres of the largest fire are hatched at the start of the bar
const bulletMetrics = [
    { key: 'fireCount', label: 'Number of fires', format: d3.format(','), axisFormat: d3.format('~s') },
    { key: 'burnedAcres', label: 'Burned acres', format: d3.format(',.0f'), axisFormat: d3.format('~s'), hatch: true }
]

// quartile bands (grey background): colors, short labels and explanations
// used both by the chart (bands + tooltips) and by the legend
const bulletQuartiles = [
    { short: '0–Q1', name: 'Lowest quarter', color: '#c9cddb',
      text: 'The 25 % of years with the smallest values fall in this band.' },
    { short: 'Q1–Q2', name: 'Lower-middle quarter', color: theme.neutralLight,
      text: 'Years between Q1 (25 % of the years are below) and the median Q2.' },
    { short: 'Q2–Q3', name: 'Upper-middle quarter', color: '#e6e8f0',
      text: 'Years between the median Q2 and Q3 (75 % of the years are below).' },
    { short: 'Q3–max', name: 'Highest quarter', color: '#f1f3f9',
      text: 'The 25 % of years with the largest values fall in this band, up to the maximum.' }
]

// fires = [{ FireYear, EstTotalAcres, cause }, ...] (see extractFires)
// returns [{ year, fireCount, burnedAcres, largestFire, largestFireCause, byCause }, ...] sorted by year
// byCause = Map(cause -> { fireCount, burnedAcres })
function computeBulletYearStats(fires) {
    return d3.rollups(
        fires,
        group => {
            // fires without a size (null) are ignored for acres-based metrics
            const sized = group.filter(fire => Number.isFinite(fire.EstTotalAcres))
            const biggest = d3.greatest(sized, fire => fire.EstTotalAcres)

            return {
                fireCount: group.length,
                burnedAcres: d3.sum(sized, fire => fire.EstTotalAcres),
                largestFire: biggest ? biggest.EstTotalAcres : 0,
                largestFireCause: biggest ? biggest.cause : undefined,
                byCause: d3.rollup(
                    group,
                    g => ({
                        fireCount: g.length,
                        burnedAcres: d3.sum(g, fire => Number.isFinite(fire.EstTotalAcres) ? fire.EstTotalAcres : 0)
                    }),
                    fire => fire.cause
                )
            }
        },
        fire => fire.FireYear
    )
        .map(([year, stats]) => ({ year, ...stats }))
        .sort((a, b) => d3.ascending(a.year, b.year))
}

// data = { fires, causePerYearWide (optional) } as returned by loadFireStats
function createFireBulletGraph(containerSelector, data, userOptions = {}) {
    const options = { ...bulletDefaults, ...userOptions }
    const { margin, width, rowHeight, rowGap } = options
    const innerWidth = width - margin.left - margin.right

    const yearStats = computeBulletYearStats(data.fires)
    const years = yearStats.map(d => d.year)
    const yearStatsByYear = new Map(yearStats.map(d => [d.year, d]))

    const causes = data.causePerYearWide
        ? data.causePerYearWide.causes
        : Array.from(new Set(data.fires.map(fire => fire.cause)))
    const color = categoricalScale(causes)   // theme palette, neutral beyond 8 causes
    const causeName = cause => cause ?? 'Unknown'

    // statistics of all years, computed once per metric
    const referenceFn = options.referenceStat === 'mean' ? d3.mean : d3.median
    const rows = bulletMetrics.map(metric => {
        const values = yearStats.map(d => d[metric.key]).sort(d3.ascending)
        return {
            ...metric,
            max: d3.max(values),
            reference: referenceFn(values),
            ranges: [0, d3.quantile(values, 0.25), d3.quantile(values, 0.5), d3.quantile(values, 0.75), d3.max(values)]
        }
    })

    // layout
    const chartHeight = rows.length * rowHeight + (rows.length - 1) * rowGap
    const rulerY = margin.top + chartHeight + 60
    const legendCausesY = 140                                   // top of the causes block in the legend
    const legendHeight = legendCausesY + 20 + causes.length * 20
    const totalHeight = Math.max(rulerY + 50, margin.top + legendHeight) + margin.bottom

    // interaction state
    const pinned = new Set()   // keys of the rows displaying the causes permanently (click)
    let hovered = null         // key of the row under the mouse
    let views = []             // [{ key, layer }] cause layers of the rows currently drawn
    let currentYear = null

    // DOM: svg only (the year is chosen with the ruler below the bars)
    const container = d3.select(containerSelector)
    container.selectAll('*').remove()

    const svg = container.append('svg')
        .attr('viewBox', `0 0 ${width} ${totalHeight}`)
        .attr('width', '100%')
        .style('font-size', '12px')
        .style('fill', 'var(--text)')   // font-family is inherited from theme.css

    // hatch pattern (diagonal white lines) used for the largest fire
    const hatchId = 'hatch-' + Math.random().toString(36).slice(2, 8)
    svg.append('defs').append('pattern')
        .attr('id', hatchId)
        .attr('width', 6).attr('height', 6)
        .attr('patternUnits', 'userSpaceOnUse')
        .attr('patternTransform', 'rotate(45)')
        .append('line')
        .attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 6)
        .attr('stroke', 'white')
        .attr('stroke-width', 2)

    const chart = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)
    const legend = svg.append('g')
        .attr('transform', `translate(${margin.left + innerWidth + 110},${margin.top})`)
    const ruler = svg.append('g')
        .attr('transform', `translate(${margin.left},${rulerY})`)
        .attr('tabindex', 0)                 // focusable: left / right arrows change the year
        .style('outline', 'none')

    const {
        blackEntry: legendBlack,
        hatchEntry: legendHatch,
        markerEntry: legendMarker,
        causesG: legendCauses
    } = drawLegend()
    const handle = drawRuler()

    // legend on the side, every entry has a tooltip (hover) explaining what it means
    // - selected year / largest fire / median: visible while a matching bar is displayed in black
    // - quartiles: always visible
    // - causes: visible while a bar shows them
    function drawLegend() {
        const referenceName = options.referenceStat === 'mean' ? 'Mean' : 'Median'

        // one legend line: a group at height y with its label and its tooltip
        const addEntry = (y, label, tooltip) => {
            const entry = legend.append('g').attr('transform', `translate(0,${y})`)
            entry.append('text').attr('x', 20).attr('y', 11).text(label)
            entry.append('title').text(tooltip)
            return entry
        }

        // selected year (black bar)
        const blackEntry = addEntry(0, 'Selected year',
            'Value of the selected year (black bar).\nHover a bar to split it by cause, click it to keep that view.')
        blackEntry.append('rect').attr('width', 14).attr('height', 14).attr('fill', options.barColor)

        // largest fire (hatch)
        const hatchEntry = addEntry(20, 'Largest fire',
            'Hatched part of the burned acres bar: acres burned by the single largest fire of the year.\nIf it covers almost the whole bar, one fire caused most of the damage.')
        hatchEntry.append('rect').attr('width', 14).attr('height', 14).attr('fill', options.barColor)
        hatchEntry.append('rect').attr('width', 14).attr('height', 14).attr('fill', `url(#${hatchId})`)

        // median / mean marker
        const markerEntry = addEntry(40, `${referenceName} of all years`,
            options.referenceStat === 'mean'
                ? 'Black marker: average value over all years. Extreme years pull it up.'
                : 'Black marker: the middle value of all years (half of the years are below, half above).\nUnlike the mean, extreme years barely move it.')
        markerEntry.append('line')
            .attr('x1', 7).attr('x2', 7).attr('y1', 0).attr('y2', 14)
            .attr('stroke', theme.text)
            .attr('stroke-width', 3)

        // quartiles: a small strip with the 4 grey bands, same colors as the chart background
        const quartilesG = legend.append('g').attr('transform', 'translate(0,70)')
        quartilesG.append('text')
            .attr('y', 10)
            .attr('font-weight', 'bold')
            .text('Quartiles of all years')
            .append('title')
            .text('All years are sorted by value and split into 4 groups of about the same size.\nQ1, Q2 (the median) and Q3 are the cut points between the groups.\nThe bands are computed separately for each bar.')

        const band = quartilesG.selectAll('.legend-band').data(bulletQuartiles).join('g')
            .attr('class', 'legend-band')
            .attr('transform', (d, i) => `translate(${i * 35},18)`)
        band.append('rect')
            .attr('width', 35).attr('height', 14)
            .attr('fill', d => d.color)
            .attr('stroke', theme.neutral)
            .attr('stroke-width', 0.5)
        band.append('text')
            .attr('x', 17.5).attr('y', 28)
            .attr('text-anchor', 'middle')
            .style('font-size', '10px')
            .text(d => d.short)
        band.append('title').text(d => `${d.name}\n${d.text}`)

        quartilesG.append('text')
            .attr('y', 62)
            .style('fill', 'var(--text-secondary)')
            .style('font-size', '10px')
            .text('Each band ≈ 25 % of the years')

        // causes (hidden until a bar shows them)
        const causesG = legend.append('g')
            .attr('transform', `translate(0,${legendCausesY})`)
            .style('opacity', 0)
            .style('pointer-events', 'none')
        causesG.append('text')
            .attr('y', 10)
            .attr('font-weight', 'bold')
            .text('Causes')
            .append('title')
            .text('Fires are grouped by cause.\nThe width of a segment is the share of that cause in the total of the year.\nHover a segment to see the exact value.')
        const item = causesG.append('g').attr('transform', 'translate(0,20)')
            .selectAll('g').data(causes).join('g')
            .attr('transform', (d, i) => `translate(0,${i * 20})`)
        item.append('rect').attr('width', 14).attr('height', 14).attr('fill', d => color(d))
        item.append('text').attr('x', 20).attr('y', 11).text(d => causeName(d))

        return { blackEntry, hatchEntry, markerEntry, causesG }
    }

    // year ruler: click or drag anywhere on it to select a year
    function drawRuler() {
        const yearScale = d3.scaleLinear(d3.extent(years), [0, innerWidth])

        // when there are many years, only some labels are written (all ticks are kept)
        const labelStep = Math.ceil(years.length / Math.max(1, Math.floor(innerWidth / 36)))

        ruler.append('g')
            .attr('class', 'axis')
            .call(d3.axisBottom(yearScale)
                .tickValues(years)
                .tickSizeOuter(0)
                .tickFormat((year, i) => i % labelStep === 0 ? year : ''))

        // invisible hit area, bigger than the axis to make the selection easy
        ruler.append('rect')
            .attr('x', -10).attr('y', -30)
            .attr('width', innerWidth + 20).attr('height', 70)
            .attr('fill', 'transparent')
            .style('cursor', 'pointer')
            .call(d3.drag().on('start drag', event => {
                // event.x is expressed in the coordinates of the ruler group
                let closest = d3.least(years, year => Math.abs(year - yearScale.invert(event.x)))
                if (closest !== currentYear) update(closest)
            }))

        ruler.on('keydown', event => {
            let i = years.indexOf(currentYear)
            if (event.key === 'ArrowLeft' && i > 0) update(years[i - 1])
            if (event.key === 'ArrowRight' && i < years.length - 1) update(years[i + 1])
        })

        // handle: circle on the axis + selected year above it
        let handleG = ruler.append('g').style('pointer-events', 'none')
        handleG.append('circle')
            .attr('r', 8)
            .attr('fill', theme.text)
            .attr('stroke', theme.surface)
            .attr('stroke-width', 2)
        handleG.append('text')
            .attr('y', -16)
            .attr('text-anchor', 'middle')
            .attr('font-weight', 'bold')
            .style('font-size', '14px')

        return {
            move(year) {
                handleG.attr('transform', `translate(${yearScale(year)},0)`)
                handleG.select('text').text(year)
            }
        }
    }

    const showsCauses = key => pinned.has(key) || hovered === key

    // fade a legend part in / out; a hidden part must not show its tooltip either
    function setVisible(selection, visible) {
        selection.style('pointer-events', visible ? 'all' : 'none')
            .transition().duration(150)
            .style('opacity', visible ? 1 : 0)
    }

    // show / hide the cause layers and the legend according to hover and click state
    function refresh() {
        views.forEach(view => {
            const causesShown = showsCauses(view.key)
            view.layer.transition().duration(150).style('opacity', causesShown ? 1 : 0)
            view.marker.transition().duration(150).style('opacity', causesShown ? 0 : 1)
            if (view.hatch) {
                view.hatch.transition().duration(150)
                    .style('opacity', causesShown ? 0 : 1)
                    .style('pointer-events', causesShown ? 'none' : 'all')
            }
        })

        // legend: causes while a bar shows them, black bar / marker / hatch entries while a matching bar is black
        const anyCauses = rows.some(row => showsCauses(row.key))
        const anyBlackBar = rows.some(row => !showsCauses(row.key))
        const anyHatchVisible = rows.some(row => row.hatch && !showsCauses(row.key))
        setVisible(legendCauses, anyCauses)
        setVisible(legendBlack, anyBlackBar)
        setVisible(legendMarker, anyBlackBar)
        setVisible(legendHatch, anyHatchVisible)
    }

    function draw(year) {
        chart.selectAll('*').remove()
        views = []
        hovered = null
        const stats = yearStatsByYear.get(year)

        rows.forEach((row, i) => {
            const x = d3.scaleLinear([0, row.max], [0, innerWidth])
            const value = stats[row.key]
            const rowG = chart.append('g')
                .attr('transform', `translate(0,${i * (rowHeight + rowGap)})`)

            // 1. qualitative ranges (quartiles of all years)
            rowG.selectAll('.band').data(d3.pairs(row.ranges)).join('rect')
                .attr('class', 'band')
                .attr('x', d => x(d[0]))
                .attr('width', d => x(d[1]) - x(d[0]))
                .attr('height', rowHeight)
                .attr('fill', (d, j) => bulletQuartiles[j].color)
                .append('title')
                .text((d, j) => `${bulletQuartiles[j].name}: ${row.format(d[0])} – ${row.format(d[1])}\n${bulletQuartiles[j].text}`)

            // 2. value of the year: black bar, cause layer on top (hidden by default), hatch on top of both
            const barHeight = rowHeight / 3
            const barY = (rowHeight - barHeight) / 2
            const barG = rowG.append('g').style('cursor', 'pointer')

            barG.append('rect')
                .attr('y', barY)
                .attr('width', x(value))
                .attr('height', barHeight)
                .attr('fill', options.barColor)

            // cause layer: one segment per cause, width proportional to its share
            let start = 0
            const segments = causes
                .map(cause => {
                    const causeValue = stats.byCause.get(cause)?.[row.key] ?? 0
                    const segment = { cause, value: causeValue, start }
                    start += causeValue
                    return segment
                })
                .filter(segment => segment.value > 0)
            const total = start

            const causeLayer = barG.append('g').style('opacity', showsCauses(row.key) ? 1 : 0)

            causeLayer.selectAll('.segment').data(segments).join('rect')
                .attr('class', 'segment')
                .attr('x', d => x(d.start))
                .attr('y', barY)
                .attr('width', d => x(d.value))
                .attr('height', barHeight)
                .attr('fill', d => color(d.cause))
                .attr('stroke', theme.surface)
                .attr('stroke-width', 1)
                .append('title')
                .text(d => `${causeName(d.cause)}: ${row.format(d.value)} (${d3.format('.1%')(d.value / total)})`)

            // percentage label inside the segments wide enough to hold it
            causeLayer.selectAll('.segment-label').data(segments.filter(d => x(d.value) > 40)).join('text')
                .attr('class', 'segment-label')
                .attr('x', d => x(d.start) + x(d.value) / 2)
                .attr('y', barY + barHeight / 2)
                .attr('dy', '0.35em')
                .attr('text-anchor', 'middle')
                .attr('fill', 'white')
                .attr('stroke', 'rgba(0,0,0,0.6)')       // thin dark halo to stay readable on the hatch
                .attr('stroke-width', 3)
                .style('paint-order', 'stroke')
                .style('font-size', '11px')
                .style('pointer-events', 'none')
                .text(d => d3.format('.0%')(d.value / total))

            // hatched part: acres of the largest fire, at the start of the bar
            // only visible with the black bar, hidden (and not hoverable) while the causes are displayed
            let hatchRect = null
            if (row.hatch && stats.largestFire > 0) {
                hatchRect = barG.append('rect')
                    .attr('y', barY)
                    .attr('width', x(stats.largestFire))
                    .attr('height', barHeight)
                    .attr('fill', `url(#${hatchId})`)
                    .style('opacity', showsCauses(row.key) ? 0 : 1)
                    .style('pointer-events', showsCauses(row.key) ? 'none' : 'all')
                hatchRect.append('title')
                    .text(`Largest fire: ${row.format(stats.largestFire)} acres (${causeName(stats.largestFireCause)})`)
            }

            // hover = show the causes, click = pin / unpin them
            barG.on('mouseenter', () => { hovered = row.key; refresh() })
                .on('mouseleave', () => { hovered = null; refresh() })
                .on('click', () => {
                    if (pinned.has(row.key)) pinned.delete(row.key)
                    else pinned.add(row.key)
                    refresh()
                })

            // value at the end of the bar
            rowG.append('text')
                .attr('x', x(value) + 8)
                .attr('y', rowHeight / 2)
                .attr('dy', '0.35em')
                .attr('font-weight', 'bold')
                .style('pointer-events', 'none')
                .text(row.format(value))

            // 3. marker: median / mean of all years
            // only visible with the black bar, hidden while the causes are displayed
            const markerHeight = rowHeight * 0.7
            const markerG = rowG.append('g')
                .style('opacity', showsCauses(row.key) ? 0 : 1)
                .style('pointer-events', 'none')
            markerG.append('line')
                .attr('x1', x(row.reference)).attr('x2', x(row.reference))
                .attr('y1', (rowHeight - markerHeight) / 2)
                .attr('y2', (rowHeight + markerHeight) / 2)
                .attr('stroke', theme.text)
                .attr('stroke-width', 3)
            markerG.append('text')
                .attr('x', x(row.reference))
                .attr('y', -6)
                .attr('text-anchor', 'middle')
                .text(`${options.referenceStat} of all years: ${row.format(row.reference)}`)

            views.push({ key: row.key, layer: causeLayer, marker: markerG, hatch: hatchRect })

            // axis + row label
            rowG.append('g')
                .attr('class', 'axis')
                .attr('transform', `translate(0,${rowHeight})`)
                .call(d3.axisBottom(x).ticks(6).tickFormat(row.axisFormat))
            rowG.append('text')
                .attr('x', -10)
                .attr('y', rowHeight / 2)
                .attr('dy', '0.35em')
                .attr('text-anchor', 'end')
                .attr('font-weight', 'bold')
                .text(row.label)
        })

        refresh()
    }

    function update(year) {
        currentYear = year
        handle.move(year)
        draw(year)
    }

    update(options.year ?? d3.max(years))
    return { update }
}