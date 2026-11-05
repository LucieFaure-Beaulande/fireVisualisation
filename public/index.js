// Miniatures of the visualizations: each iframe shows only the chart of its page (?embed).
// The chart is measured inside the iframe, then scaled down and centered in its cell.
// A click on a miniature moves it to the main area (the previous one takes its place),
// a click on the card of the main area opens the full page.

const baseWidth = 1200    // width (px) at which the pages are rendered
const baseHeight = 1400   // height (px) of the iframe, large enough to contain any chart
const padding = 8         // free space (px) around the chart in the cell

const grid = document.querySelector('.home-grid')
const cards = Array.from(document.querySelectorAll('.viz-card'))

// ---------- miniatures ----------

function fitMiniature(card) {
    const frame = card.querySelector('iframe'),
        title = card.querySelector('.viz-title'),
        doc = frame.contentDocument,
        target = doc && doc.querySelector(frame.dataset.target)

    // the chart is not drawn yet
    if (!target) return

    // the heatmap and the bullet graph have a container around their svg
    const chart = target.querySelector('svg') || target,
        box = chart.getBoundingClientRect()
    if (!box.width || !box.height) return

    // the space available for the chart: the cell without the title at the bottom
    const availableWidth = card.clientWidth - 2 * padding,
        availableHeight = card.clientHeight - title.offsetHeight - 2 * padding,
        scale = Math.min(availableWidth / box.width, availableHeight / box.height)

    // center the chart in the available space
    const x = padding + (availableWidth - box.width * scale) / 2 - box.left * scale,
        y = padding + (availableHeight - box.height * scale) / 2 - box.top * scale

    frame.style.width = baseWidth + 'px'
    frame.style.height = baseHeight + 'px'
    frame.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
    frame.style.visibility = 'visible'
}

// the chart is drawn after the load of the page (csv files): follow its size inside the iframe
function watchChart(card) {
    const frame = card.querySelector('iframe')
    if (frame.dataset.watched) return
    frame.dataset.watched = 'true'

    const target = frame.contentDocument.querySelector(frame.dataset.target)
    if (target) new frame.contentWindow.ResizeObserver(() => fitMiniature(card)).observe(target)
    fitMiniature(card)
}

// the cell changes size with the window, and when the card moves to another cell
const observer = new ResizeObserver(entries => entries.forEach(entry => fitMiniature(entry.target)))

cards.forEach(card => {
    const frame = card.querySelector('iframe')

    frame.style.width = baseWidth + 'px'
    frame.style.height = baseHeight + 'px'
    frame.addEventListener('load', () => watchChart(card))

    // the iframe may already be loaded when this script runs
    if (frame.contentDocument && frame.contentDocument.readyState === 'complete'
        && frame.contentWindow.location.href !== 'about:blank') watchChart(card)

    observer.observe(card)
})

// ---------- main area ----------

let mainCard = null             // the card shown in the main area, null before the first click
let sideSlots = cards.slice()   // the 3 cells of the right column, from top to bottom (null = empty cell)

// the empty cell: it replaces the card that moved to the main area
const emptyCell = document.createElement('div')
emptyCell.className = 'viz-empty card'
emptyCell.textContent = 'Empty'
emptyCell.setAttribute('aria-hidden', 'true')
grid.appendChild(emptyCell)

const cardTitle = card => card.querySelector('.viz-title').textContent

// apply the state to the page: classes, order in the grid and label of the buttons
// the iframes stay in the DOM, so the charts are not loaded again
function applyLayout() {
    grid.classList.toggle('has-main', mainCard !== null)

    cards.forEach(card => {
        const isMain = card === mainCard
        card.classList.toggle('is-main', isMain)
        card.style.order = isMain ? -1 : sideSlots.indexOf(card)
        card.querySelector('.viz-link').setAttribute('aria-label',
            (isMain ? 'Open the full page: ' : 'Show larger: ') + cardTitle(card))
    })

    // the empty cell takes the slot that contains null, it is hidden while every slot has a card
    const emptyIndex = sideSlots.indexOf(null)
    emptyCell.style.display = emptyIndex === -1 ? 'none' : ''
    emptyCell.style.order = emptyIndex
}

// put a card in the main area: the previous main card (or an empty cell
// on the first click) takes the slot of the clicked card
function moveToMain(card) {
    sideSlots[sideSlots.indexOf(card)] = mainCard
    mainCard = card
    applyLayout()
}

cards.forEach(card => {
    const button = card.querySelector('.viz-link')

    button.addEventListener('click', () => {
        if (card === mainCard) location.href = button.dataset.href
        else moveToMain(card)
    })
})

applyLayout()

// ---------- shared year ruler ----------
// the year is sent to the iframes marked with data-sync-year (see js/embed.js)

const rulerYears = d3.range(2000, 2023)
const syncedFrames = Array.from(document.querySelectorAll('iframe[data-sync-year]'))
let selectedYear = 2022

function sendYear(frame) {
    if (frame.contentWindow) frame.contentWindow.postMessage({ type: 'setYear', year: selectedYear }, location.origin)
}

// a page loaded after the ruler is synchronized as soon as it is ready
syncedFrames.forEach(frame => frame.addEventListener('load', () => sendYear(frame)))

createYearRuler('#yearRuler', {
    years: rulerYears,
    year: selectedYear,
    onChange: year => {
        selectedYear = year
        syncedFrames.forEach(sendYear)
    }
})