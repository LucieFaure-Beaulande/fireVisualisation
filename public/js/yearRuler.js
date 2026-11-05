// Year ruler: click, drag or use the arrow keys to select a year
// requires d3 to be loaded first
// createYearRuler('#yearRuler', { years: [2000, ..., 2022], year: 2022, onChange: year => ... })

function createYearRuler(containerSelector, options) {
    const { years, onChange } = options
    const width = 1100, height = 70
    const margin = { left: 30, right: 30 }
    const innerWidth = width - margin.left - margin.right
    let currentYear = options.year ?? d3.max(years)

    const svg = d3.select(containerSelector).html('').append('svg')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('width', '100%')
        .attr('tabindex', 0)
        .attr('role', 'slider')
        .attr('aria-label', 'Year')
        .attr('aria-valuemin', d3.min(years))
        .attr('aria-valuemax', d3.max(years))
        .style('display', 'block')

    const yearScale = d3.scaleLinear(d3.extent(years), [0, innerWidth])
    const ruler = svg.append('g').attr('transform', `translate(${margin.left},40)`)

    ruler.append('g')
        .attr('class', 'axis')
        .call(d3.axisBottom(yearScale).tickValues(years).tickSizeOuter(0).tickFormat(d3.format('d')))

    // invisible hit area, bigger than the axis to make the selection easy
    ruler.append('rect')
        .attr('x', -10).attr('y', -30)
        .attr('width', innerWidth + 20).attr('height', 60)
        .attr('fill', 'transparent')
        .style('cursor', 'pointer')
        .call(d3.drag().on('start drag', event => {
            const closest = d3.least(years, year => Math.abs(year - yearScale.invert(event.x)))
            setYear(closest)
        }))

    // handle: circle on the axis + selected year above it
    const handle = ruler.append('g').style('pointer-events', 'none')
    handle.append('circle')
        .attr('r', 8)
        .attr('fill', 'var(--color-text)')
        .attr('stroke', 'var(--color-surface)')
        .attr('stroke-width', 2)
    handle.append('text')
        .attr('y', -16)
        .attr('text-anchor', 'middle')
        .attr('font-weight', 'bold')
        .style('font-size', '14px')
        .style('fill', 'var(--color-text)')

    svg.on('keydown', event => {
        const i = years.indexOf(currentYear)
        if (event.key === 'ArrowLeft' && i > 0) { event.preventDefault(); setYear(years[i - 1]) }
        if (event.key === 'ArrowRight' && i < years.length - 1) { event.preventDefault(); setYear(years[i + 1]) }
    })

    function draw() {
        handle.attr('transform', `translate(${yearScale(currentYear)},0)`)
        handle.select('text').text(currentYear)
        svg.attr('aria-valuenow', currentYear)
    }

    function setYear(year) {
        if (year === currentYear) return
        currentYear = year
        draw()
        if (onChange) onChange(year)
    }

    draw()
    return { setYear, get year() { return currentYear } }
}