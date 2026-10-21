// Tooltip shared by the visualizations (style: .fire-tooltip in /css/theme.css)

(function () {
    let tip = null
    let gap = 14

    function element() {
        if (!tip) {
            tip = document.createElement('div')
            tip.className = 'fire-tooltip'
            tip.setAttribute('role', 'tooltip')
            tip.hidden = true
            document.body.appendChild(tip)
        }
        return tip
    }

    // place the tooltip next to the point, on the other side when there is no room
    function place(event) {
        let el = element()
        let width = el.offsetWidth, height = el.offsetHeight
        let x = event.clientX + gap, y = event.clientY + gap
        if (x + width > window.innerWidth - 8) x = event.clientX - width - gap
        if (y + height > window.innerHeight - 8) y = event.clientY - height - gap
        el.style.left = `${Math.max(4, x)}px`
        el.style.top = `${Math.max(4, y)}px`
    }

    function show(event, html) {
        let el = element()
        // measured at the top left corner, so that its width is not reduced by the edge of the window
        el.style.left = '0px'
        el.style.top = '0px'
        el.innerHTML = html
        el.hidden = false
        place(event)
    }

    function move(event) {
        if (tip && !tip.hidden) place(event)
    }

    function hide() {
        if (tip) tip.hidden = true
    }

    window.FireTooltip = { show, move, hide }
})()
