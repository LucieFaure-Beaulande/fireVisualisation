// Miniatures of the visualizations: each iframe is rendered at a desktop width,
// then scaled down to fill its cell

let baseWidth = 1200   // width (px) at which the pages are rendered

function fitMiniature(card) {
    let frame = card.querySelector('iframe'),
        scale = card.clientWidth / baseWidth

    // the iframe is as tall as needed to fill the cell once scaled
    frame.style.width = baseWidth + 'px'
    frame.style.height = (card.clientHeight / scale) + 'px'
    frame.style.transform = `scale(${scale})`
}

let observer = new ResizeObserver(entries => entries.forEach(entry => fitMiniature(entry.target)))

document.querySelectorAll('.viz-card').forEach(card => observer.observe(card))