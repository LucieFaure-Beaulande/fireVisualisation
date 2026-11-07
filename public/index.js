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

    // interactive main card: real size (no scaling), the iframe fills the cell above the title strip
    if (card.classList.contains('is-interactive')) {
        frame.style.width = card.clientWidth + 'px'
        frame.style.height = Math.max(0, card.clientHeight - title.offsetHeight) + 'px'
        frame.style.transform = 'none'
        if (target) frame.style.visibility = 'visible'
        return
    }

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
    frame.addEventListener('load', () => sendInteractive(frame))

    // the iframe may already be loaded when this script runs
    if (frame.contentDocument && frame.contentDocument.readyState === 'complete'
        && frame.contentWindow.location.href !== 'about:blank') watchChart(card)

    observer.observe(card)
})

// tell the page of the iframe if it is the interactive main area (see js/embed.js)
function sendInteractive(frame) {
    if (frame.contentWindow) {
        frame.contentWindow.postMessage(
            { type: 'setInteractive', value: frame.dataset.interactive === 'true' }, location.origin)
    }
}

// ---------- main area ----------

// ---------- layout memory ----------
// the card in the main area and the order of the side cards are kept between visits
const LAYOUT_KEY = 'fire-home-layout'
const cardId = card => card ? card.querySelector('.viz-link').dataset.href : null

function loadLayout() {
    try {
        const saved = JSON.parse(sessionStorage.getItem(LAYOUT_KEY))
        const byId = new Map(cards.map(card => [cardId(card), card]))
        const main = byId.get(saved?.main)
        // the saved layout must still match the cards of the page, otherwise it is ignored
        const side = Array.isArray(saved?.side) ? saved.side.map(id => byId.get(id) ?? null) : []
        const known = [main, ...side].filter(Boolean)
        if (!main || known.length !== cards.length || new Set(known).size !== cards.length) return null
        return { main, side }
    } catch (_) {
        return null   // storage denied or corrupted value: use the default layout
    }
}

function saveLayout() {
    try {
        sessionStorage.setItem(LAYOUT_KEY, JSON.stringify({
            main: cardId(mainCard),
            side: sideSlots.map(cardId)
        }))
    } catch (_) { /* the layout is simply not remembered */ }
}

const savedLayout = loadLayout()

// the card marked data-main is shown in the main area by default
let mainCard = savedLayout
    ? savedLayout.main
    : cards.find(card => card.hasAttribute('data-main')) || null
// the 3 cells of the right column, from top to bottom (null = empty cell)
let sideSlots = savedLayout
    ? savedLayout.side
    : cards.filter(card => card !== mainCard)

// the empty cell: it replaces the card that moved to the main area
const emptyCell = document.createElement('div')
emptyCell.className = 'viz-empty card'
emptyCell.textContent = 'Empty'
emptyCell.setAttribute('aria-hidden', 'true')
grid.appendChild(emptyCell)

const cardTitle = card => card.querySelector('.viz-title').textContent

// switch a card between miniature and interactive main area
function setInteractive(card, interactive) {
    const frame = card.querySelector('iframe')
    const was = frame.dataset.interactive === 'true'
    if (was === interactive) return

    const hadFocus = document.activeElement === frame
    frame.dataset.interactive = String(interactive)
    frame.tabIndex = interactive ? 0 : -1
    if (interactive) {
        frame.removeAttribute('aria-hidden')
        frame.title = `${cardTitle(card)} (interactive)`
    } else {
        frame.setAttribute('aria-hidden', 'true')
        frame.title = ''
    }
    sendInteractive(frame)
    fitMiniature(card)

    // the keyboard focus must not be lost inside a frame that becomes a miniature
    if (!interactive && hadFocus) card.querySelector('.viz-link').focus()
}

function applyLayout() {
    grid.classList.toggle('has-main', mainCard !== null)

    cards.forEach(card => {
        const isMain = card === mainCard
        const interactive = isMain && card.hasAttribute('data-interactive')
        card.classList.toggle('is-main', isMain)
        card.classList.toggle('is-interactive', interactive)
        card.style.order = isMain ? -1 : sideSlots.indexOf(card)
        card.querySelector('.viz-link').setAttribute('aria-label',
            (isMain ? 'Open the full page: ' : 'Show larger: ') + cardTitle(card))
        setInteractive(card, interactive)
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
    saveLayout()
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

function drawYearRuler() {
    createYearRuler('#yearRuler', {
        years: rulerYears,
        year: selectedYear,   // the selected year is kept when the ruler is redrawn
        onChange: year => {
            selectedYear = year
            syncedFrames.forEach(sendYear)
        }
    })
}

drawYearRuler()

// redraw the ruler when the text size changes: the labels written depend on it
FireAccessibility.onChange((settings, key) => {
    if (key === 'textScale' || key === 'reset') drawYearRuler()
})

// ---------- layout following the text size (accessibility) ----------
// from this text scale, the main area goes on top and the 3 miniatures below it
const stackedFromScale = 1.5

function updateLayout() {
    grid.classList.toggle('is-stacked', FireAccessibility.settings.textScale >= stackedFromScale)
}

FireAccessibility.onChange((settings, key) => {
    if (key === 'textScale' || key === 'reset') updateLayout()
})

updateLayout()