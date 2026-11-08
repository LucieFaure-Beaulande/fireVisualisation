// Miniatures of the visualizations: each iframe shows only the chart of its page (?embed).
// The chart is measured inside the iframe, then scaled down and centered in its cell.
// A click on a miniature moves it to the main area (the previous one takes its place),
// a click on the card of the main area opens the full page.
// A card can hold several iframes (tabs): only the active one is visible and interactive.

const baseWidth = 1200    // width (px) at which the pages are rendered
const baseHeight = 1400   // height (px) of the iframe, large enough to contain any chart
const padding = 8         // free space (px) around the chart in the cell

const grid = document.querySelector('.home-grid')
const cards = Array.from(document.querySelectorAll('.viz-card'))

// ---------- cards, frames and tabs ----------

const cardId = card => card ? card.dataset.id : null
const framesOf = card => Array.from(card.querySelectorAll('iframe'))

// the visible iframe of a card (the first one when the card has no tabs)
const activeFrame = card => framesOf(card).find(frame => frame.dataset.tab === card.dataset.activeTab) || framesOf(card)[0]

// ---------- miniatures ----------

function fitFrame(card, frame) {
    const title = card.querySelector('.viz-title'),
        tabs = card.querySelector('.viz-tabs'),
        topOffset = tabs ? tabs.offsetHeight : 0,
        doc = frame.contentDocument,
        target = doc && doc.querySelector(frame.dataset.target)

    // the tab bar is at the top of the cell: the iframe starts under it
    frame.style.top = topOffset + 'px'

    // interactive main card: real size (no scaling), the iframe fills the cell between the tabs and the title strip
    if (frame.dataset.interactive === 'true') {
        frame.style.width = card.clientWidth + 'px'
        frame.style.height = Math.max(0, card.clientHeight - title.offsetHeight - topOffset) + 'px'
        frame.style.transform = 'none'
        if (target) frame.style.visibility = 'visible'
        return
    }

    // the chart is not drawn yet
    if (!target) return

    // the heatmap, the bullet graph and the maps have a container around their svg
    const chart = target.querySelector('svg') || target,
        box = chart.getBoundingClientRect()
    if (!box.width || !box.height) return

    // the space available for the chart: the cell without the tabs at the top and the title at the bottom
    const availableWidth = card.clientWidth - 2 * padding,
        availableHeight = card.clientHeight - title.offsetHeight - topOffset - 2 * padding,
        scale = Math.min(availableWidth / box.width, availableHeight / box.height)

    // center the chart in the available space
    const x = padding + (availableWidth - box.width * scale) / 2 - box.left * scale,
        y = padding + (availableHeight - box.height * scale) / 2 - box.top * scale

    frame.style.width = baseWidth + 'px'
    frame.style.height = baseHeight + 'px'
    frame.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
    frame.style.visibility = 'visible'
}

// all the frames of a card are kept sized, so that a tab switch is instant
function fitCard(card) {
    framesOf(card).forEach(frame => fitFrame(card, frame))
}

// the chart is drawn after the load of the page (csv files): follow its size inside the iframe
function watchChart(card, frame) {
    if (frame.dataset.watched) return
    frame.dataset.watched = 'true'

    const target = frame.contentDocument.querySelector(frame.dataset.target)
    if (target) new frame.contentWindow.ResizeObserver(() => fitFrame(card, frame)).observe(target)
    fitFrame(card, frame)
}

// the cell changes size with the window, and when the card moves to another cell
const observer = new ResizeObserver(entries => entries.forEach(entry => fitCard(entry.target)))

cards.forEach(card => {
    framesOf(card).forEach(frame => {
        frame.style.width = baseWidth + 'px'
        frame.style.height = baseHeight + 'px'
        frame.addEventListener('load', () => watchChart(card, frame))
        frame.addEventListener('load', () => sendInteractive(frame))

        // the iframe may already be loaded when this script runs
        if (frame.contentDocument && frame.contentDocument.readyState === 'complete'
            && frame.contentWindow.location.href !== 'about:blank') watchChart(card, frame)
    })

    observer.observe(card)
})

// tell the page of the iframe if it is the interactive main area (see js/embed.js)
function sendInteractive(frame) {
    if (frame.contentWindow) {
        frame.contentWindow.postMessage(
            { type: 'setInteractive', value: frame.dataset.interactive === 'true' }, location.origin)
    }
}

// ---------- layout memory ----------
// the card in the main area, the order of the side cards and the active tabs are kept between visits
const LAYOUT_KEY = 'fire-home-layout'
const TABS_KEY = 'fire-home-tabs'

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

function loadTabs() {
    try {
        return JSON.parse(sessionStorage.getItem(TABS_KEY)) || {}
    } catch (_) {
        return {}
    }
}

function saveTabs() {
    try {
        const tabbed = cards.filter(card => card.querySelector('.viz-tab'))
        sessionStorage.setItem(TABS_KEY, JSON.stringify(
            Object.fromEntries(tabbed.map(card => [cardId(card), card.dataset.activeTab]))))
    } catch (_) { /* the tab is simply not remembered */ }
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

// ---------- main area ----------

// switch a frame between miniature and interactive main area
function setFrameInteractive(card, frame, interactive) {
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
    fitFrame(card, frame)

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

        // only the visible frame of the card is interactive
        framesOf(card).forEach(frame =>
            setFrameInteractive(card, frame, interactive && frame === activeFrame(card)))
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

// ---------- tabs ----------

// show the frame of a tab: title, link and visibility follow it (the layout is not redrawn here)
function applyTab(card, tab) {
    card.dataset.activeTab = tab

    card.querySelectorAll('.viz-tab').forEach(button => {
        const selected = button.dataset.tab === tab
        button.setAttribute('aria-selected', String(selected))
        button.tabIndex = selected ? 0 : -1
    })

    framesOf(card).forEach(frame => frame.classList.toggle('is-inactive', frame.dataset.tab !== tab))

    const frame = activeFrame(card)
    card.querySelector('.viz-title').textContent = frame.dataset.title
    card.querySelector('.viz-link').dataset.href = frame.dataset.href
}

function selectTab(card, tab) {
    applyTab(card, tab)
    applyLayout()   // the interactive state and the labels follow the active frame
    saveTabs()
}

cards.forEach(card => {
    const buttons = Array.from(card.querySelectorAll('.viz-tab'))

    buttons.forEach((button, i) => {
        button.addEventListener('click', () => selectTab(card, button.dataset.tab))

        // arrow keys, Home and End move between the tabs
        button.addEventListener('keydown', event => {
            const next = {
                ArrowRight: buttons[(i + 1) % buttons.length],
                ArrowLeft: buttons[(i - 1 + buttons.length) % buttons.length],
                Home: buttons[0],
                End: buttons[buttons.length - 1]
            }[event.key]
            if (!next) return

            event.preventDefault()
            selectTab(card, next.dataset.tab)
            next.focus()
        })
    })
})

// restore the active tab of each card with tabs
const savedTabs = loadTabs()
cards.forEach(card => {
    const names = Array.from(card.querySelectorAll('.viz-tab')).map(button => button.dataset.tab)
    if (!names.length) return
    applyTab(card, names.includes(savedTabs[cardId(card)]) ? savedTabs[cardId(card)] : names[0])
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