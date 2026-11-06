let shortMonthNames = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

let detailScale = 2, // from this zoom, the individual fires replace the cells
    dotsTransform = d3.zoomIdentity, // the current zoom on the fires
    dotsCause = null, // the specific cause whose fires are drawn
    labelPositions = null, // the positions of the labels of the years and of the months, without zoom
    dotsYears = null // the first and last years of the data, written in the explanation

// the fires are drawn when a specific cause (a leaf of the hierarchy) is selected
let dotsVisible = () => focus !== root && !focus.children

// the zoom of the mouse wheel, active only on the fires
let dotsZoom = d3.zoom()
    .scaleExtent([1, 12])
    .filter(event => dotsVisible() && (event.type === 'wheel' || !event.button))
    .on('zoom', event => placeDots(event.transform))

function drawFireDots(fires) {
    let group = svg.select('#dots .dots-content'),
        selection = dotsVisible() ? firesOfCause(fires, focus.path) : [],
        years = dotsYears = d3.extent(allFires, d => d.FireYear),
        innerRadius = radius * 1.3,
        outerRadius = radius * 4 - 26,
        fill = dotsVisible() ? colorScale(focus.parent.data.name) : FirePalette.token('--data-unknown')

    // a new cause starts without zoom
    if (!dotsVisible() || focus.id !== dotsCause) svg.call(dotsZoom.transform, d3.zoomIdentity)
    dotsCause = dotsVisible() ? focus.id : null

    // each year is a ring, the fires of a year turn once around the center during the year
    let date = d => d.Discover_DateTime || d.ReportDateTime,
        yearPart = d => d3.timeDay.count(d3.timeYear(date(d)), date(d)) / 366, // from 0 (1 January) to 1
        yearScale = d3.scaleLinear().domain([years[0], years[1] + 1]).range([innerRadius, outerRadius]),
        angle = month => month / 12 * 2 * Math.PI,
        sizeScale = d3.scaleSqrt().domain([0, d3.max(selection, d => d.EstTotalAcres) || 1]).range([2.5, 18])

    // the position and the size of each fire, in new objects to keep the shared table of fires unchanged
    let points = selection.map(fire => {
        let distance = yearScale(fire.FireYear + yearPart(fire))
        return {
            fire: fire,
            x: Math.sin(yearPart(fire) * 2 * Math.PI) * distance,
            y: -Math.cos(yearPart(fire) * 2 * Math.PI) * distance,
            size: sizeScale(fire.EstTotalAcres || 0)
        }
    })

    // the cells: the number of fires for each month of each year
    let cells = []
    d3.rollup(selection, values => values.length, d => d.FireYear, fireMonth)
        .forEach((months, year) => months.forEach((count, month) => cells.push({ year: year, month: month, count: count })))

    let cellColor = d3.scaleSequential(d3.interpolateRgb(lighten(fill, 0.85), fill))
        .domain([1, d3.max(cells, d => d.count) || 1])

    group.selectAll('path.cell')
        .data(cells, d => d.year + '-' + d.month)
        .join('path')
        .attr('class', 'cell')
        .attr('d', d => d3.arc()({
            innerRadius: yearScale(d.year),
            outerRadius: yearScale(d.year + 1),
            startAngle: angle(d.month),
            endAngle: angle(d.month + 1)
        }))
        .attr('fill', d => cellColor(d.count))
        .on('mousemove', (event, d) => showInfo(event, `${monthNames[d.month]} ${d.year} : ${formatNumber(d.count)} feu${d.count > 1 ? 'x' : ''}`))
        .on('mouseout', hideTooltip)

    // the guides: one circle every 5 years and one line per month
    let guideYears = dotsVisible() ? d3.range(years[0], years[1] + 1).filter(year => year % 5 === 0) : [],
        guideMonths = dotsVisible() ? d3.range(12) : []

    group.selectAll('circle.year-guide')
        .data(guideYears)
        .join('circle')
        .attr('class', 'year-guide')
        .attr('r', d => yearScale(d))

    group.selectAll('line.month-guide')
        .data(guideMonths)
        .join('line')
        .attr('class', 'month-guide')
        .attr('x1', d => Math.sin(angle(d)) * innerRadius)
        .attr('y1', d => -Math.cos(angle(d)) * innerRadius)
        .attr('x2', d => Math.sin(angle(d)) * outerRadius)
        .attr('y2', d => -Math.cos(angle(d)) * outerRadius)

    // the largest fires are drawn first, to keep the small ones visible above them
    group.selectAll('circle.fire')
        .data(points.sort((a, b) => d3.descending(a.size, b.size)), d => d.fire.Serial)
        .join(enter => enter.append('circle')
            .attr('class', 'fire')
            .on('mousemove', (event, d) => showFireTooltip(event, d.fire))
            .on('mouseout', hideTooltip))
        .attr('fill', fill)
        .attr('stroke', fill)

    // the labels are drawn above the fires
    group.selectAll('text.year-label')
        .data(guideYears)
        .join('text')
        .attr('class', 'year-label')
        .attr('text-anchor', 'middle')
        .text(d => d)
        .raise()

    group.selectAll('text.month-label')
        .data(guideMonths)
        .join('text')
        .attr('class', 'month-label')
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .text(d => shortMonthNames[d])

    labelPositions = {
        year: d => [0, -yearScale(d) - 2],
        month: d => [Math.sin(angle(d + 0.5)) * (outerRadius + 14 * textScale()), -Math.cos(angle(d + 0.5)) * (outerRadius + 14 * textScale())]
    }

    placeDots(dotsTransform)
}

// draw the fires with the zoom: the positions follow the zoom, the sizes stay the same on the screen
// the cells are shown without zoom, the individual fires from the zoom detailScale
function placeDots(transform) {
    dotsTransform = transform

    let group = svg.select('#dots .dots-content'),
        k = transform.k,
        detail = k >= detailScale

    // the center of the sunburst, then the zoom
    let cx = margin.left + width / 2,
        cy = margin.top + height / 2
    group.attr('transform', `${transform} translate(${cx}, ${cy})`)

    // the white circle of the center follows the zoom, like the hole of the spiral it fills,
    // its texts keep the same size on the screen
    let center = chartGroup.select('#center')
    if (dotsVisible()) {
        center.attr('transform', `translate(${k * cx + transform.x - cx}, ${k * cy + transform.y - cy}) scale(${k})`)
        center.selectAll('text').attr('transform', `scale(${1 / k})`)
    }
    else {
        center.attr('transform', null)
        center.selectAll('text').attr('transform', null)
    }

    group.selectAll('path.cell')
        .style('display', detail ? 'none' : null)

    group.selectAll('circle.fire')
        .style('display', detail ? null : 'none')
        .attr('cx', d => d.x)
        .attr('cy', d => d.y)
        .attr('r', d => d.size / k)
        .attr('stroke-width', 1 / k)

    if (labelPositions) {
        group.selectAll('text.year-label')
            .attr('transform', d => `translate(${labelPositions.year(d)}) scale(${1 / k})`)
        group.selectAll('text.month-label')
            .attr('transform', d => `translate(${labelPositions.month(d)}) scale(${1 / k})`)
    }

    // the explanation of what is drawn
    d3.select('#dots-hint')
        .text(!dotsVisible() ? ''
            : detail
                ? 'Chaque point est un feu : autour du cercle, sa date dans l\'année ; du centre vers le bord, son année ; '
                    + 'taille : surface brûlée. Dézoomer avec la molette pour revenir aux cases.'
                : `Chaque case compte les feux d'un mois (autour du cercle) et d'une année (du centre, ${dotsYears[0]}, `
                    + `vers le bord, ${dotsYears[1]}). Zoomer avec la molette pour voir chaque feu, glisser pour se déplacer.`)
}

// the details of one fire
function showFireTooltip(event, d) {
    let date = d.Discover_DateTime || d.ReportDateTime

    d3.select('div.tooltip')
        .style('display', 'block')
        .style('left', (event.pageX + 14) + 'px')
        .style('top', (event.pageY + 14) + 'px')
        .html('<div class="title"></div><div class="date"></div><div class="place"></div><div class="size"></div>'
            + '<div class="secondary comments"></div>')

    let tooltip = d3.select('div.tooltip')
    tooltip.select('.title').text(d.FireName || 'Feu sans nom')
    tooltip.select('.date').text(date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }))
    tooltip.select('.place').text(`Comté de ${d.County} · terrain : ${d.FO_LandOwnType}`)
    tooltip.select('.size').text(d.EstTotalAcres === null ? 'Surface inconnue'
        : `${locale.format(',.1f')(d.EstTotalAcres)} acres brûlés (classe ${d.Size_class})`)
    tooltip.select('.comments').text(d.Cause_Comments || '')
}

// ---------- fisheye on the arcs ----------
// the fisheye function of the course, applied to the angle of the arcs instead of the position of the nodes
// the arcs near the mouse are enlarged, their labels appear when there is enough room

let fisheyeRadius = 0.6, // the size of the lens, in radians
    fisheyeDistortion = 0.35, // the magnification near the focus is (distortion + 1) / distortion
    fisheyeActive = false,
    lastUpdate = 0 // the time of the last drawing, the fisheye waits for the end of the transitions

// the new angle of an angle x when the focus of the lens is at the angle focusAngle
function fisheyeAngle(x, focusAngle) {
    let delta = x - focusAngle

    // the shortest way around the circle
    if (delta > Math.PI) delta -= 2 * Math.PI
    if (delta < -Math.PI) delta += 2 * Math.PI

    let distance = Math.abs(delta)
    if (distance >= fisheyeRadius || distance === 0) return focusAngle + delta

    let k = (fisheyeDistortion + 1) * fisheyeRadius * distance / (fisheyeDistortion * fisheyeRadius + distance)
    return focusAngle + Math.sign(delta) * k
}

// the position of an arc seen through the lens
function distort(t, focusAngle) {
    let x0 = fisheyeAngle(t.x0, focusAngle),
        x1 = fisheyeAngle(t.x1, focusAngle)
    if (x1 < x0 || (x1 === x0 && t.x1 - t.x0 > Math.PI)) x1 += 2 * Math.PI
    return { x0: x0, x1: x1, y0: t.y0, y1: t.y1 }
}

// draw the arcs and the labels at the position given by the function, without transition
function placeArcs(positionOf) {
    chartGroup.selectAll('path.arc')
        .attr('d', d => arcGenerator(positionOf(d)))

    chartGroup.selectAll('text.arc-label')
        .each(function(d) {
            let t = positionOf(d)
            d3.select(this)
                .attr('transform', labelTransform(t))
                .attr('fill-opacity', labelVisible(t) ? 1 : 0)
                .text(shorten(d.data.name, labelLength(t)))
        })
}

function moveFisheye(event) {
    // no lens over the individual fires, and not before the end of the transitions
    if (dotsVisible() || Date.now() - lastUpdate < duration + 50) return

    let [x, y] = d3.pointer(event, chartGroup.node()),
        distance = Math.hypot(x, y)

    // no lens over the center or outside the sunburst
    if (distance < radius || distance > radius * 4) return resetFisheye()

    let focusAngle = (Math.atan2(x, -y) + 2 * Math.PI) % (2 * Math.PI)
    fisheyeActive = true
    placeArcs(d => distort(d.target, focusAngle))
}

function resetFisheye() {
    if (!fisheyeActive) return
    fisheyeActive = false
    placeArcs(d => d.target)
}
