// Accessibility panel shared by all the visualizations

(function () {
    let storageKey = 'fire-accessibility'

    let defaults = {
        textScale: 1,          // 1 → 2 (100% → 200%)
        palette: 'standard',
        contrast: false,       // high contrast
        bigCursor: false       // big mouse cursor
    }

    let textScales = [1, 1.25, 1.5, 1.75, 2]

    let classes = {
        contrast: 'accessibility-contrast',
        bigCursor: 'accessibility-big-cursor'
    }

    let settings = load()
    let listeners = []
    let panel, toggle

    function load() {
        try {
            // only the known settings: the ones removed from the panel are ignored
            let saved = JSON.parse(localStorage.getItem(storageKey) || '{}')
            Object.keys(saved).forEach(key => { if (!(key in defaults)) delete saved[key] })
            return Object.assign({}, defaults, saved)
        } catch (e) {
            return Object.assign({}, defaults)
        }
    }

    function save() {
        try { localStorage.setItem(storageKey, JSON.stringify(settings)) } catch (e) { /* storage not available */ }
    }

    // apply the settings to the page (CSS variable and classes on <html>)
    function apply() {
        let root = document.documentElement
        root.style.setProperty('--text-scale', settings.textScale)
        root.dataset.palette = settings.palette
        Object.entries(classes).forEach(([key, className]) => root.classList.toggle(className, settings[key]))
        if (panel) syncControls()
    }

    function set(key, value) {
        settings[key] = value
        save()
        apply()
        listeners.forEach(listener => listener(settings, key))
    }

    function reset() {
        settings = Object.assign({}, defaults)
        save()
        apply()
        listeners.forEach(listener => listener(settings, 'reset'))
    }

    // ---------- panel ----------

    function checkbox(key, label, hint) {
        return `<label class="accessibility-option"><input type="checkbox" data-key="${key}">` +
            `<span>${label}${hint ? `<span class="accessibility-hint">${hint}</span>` : ''}</span></label>`
    }

    function radio(name, value, label, hint) {
        return `<label class="accessibility-option"><input type="radio" name="${name}" value="${value}">` +
            `<span>${label}${hint ? `<span class="accessibility-hint">${hint}</span>` : ''}</span></label>`
    }

    function panelHtml() {
        return '<div class="accessibility-header"><h2 id="accessibility-title">Accessibility</h2>' +
            '<button type="button" class="accessibility-close" aria-label="Close">✕</button></div>' +
            '<div class="accessibility-body">' +

            // text size: native radio buttons displayed as a segmented control
            '<fieldset><legend>Text size</legend><div class="accessibility-segmented">' +
            textScales.map(scale => `<label><input type="radio" name="accessibility-text-scale" value="${scale}">` +
                `<span>${Math.round(scale * 100)}%</span></label>`).join('') +
            '</div></fieldset>' +

            '<fieldset><legend>Colors</legend>' +
            radio('accessibility-palette', 'standard', 'Standard') +
            radio('accessibility-palette', 'cvd', 'Colour-blind friendly',
                'Changes the colors of the categories; the single-hue gradients stay the same.') +
            checkbox('contrast', 'High contrast') +
            '</fieldset>' +

            '<fieldset><legend>Mouse</legend>' +
            checkbox('bigCursor', 'Big cursor') +
            '</fieldset>' +

            '</div>' +
            '<div class="accessibility-footer"><button type="button" class="accessibility-reset">Reset</button></div>'
    }

    // show the current settings in the controls of the panel
    function syncControls() {
        panel.querySelectorAll('[name="accessibility-text-scale"]').forEach(input => input.checked = +input.value === settings.textScale)
        panel.querySelectorAll('[name="accessibility-palette"]').forEach(input => input.checked = input.value === settings.palette)
        panel.querySelectorAll('[data-key]').forEach(input => input.checked = !!settings[input.dataset.key])
    }

    function open() {
        panel.hidden = false
        toggle.setAttribute('aria-expanded', 'true')
        panel.querySelector('.accessibility-close').focus()
    }

    function close() {
        panel.hidden = true
        toggle.setAttribute('aria-expanded', 'false')
        toggle.focus()
    }

    function init() {
        if (panel) return

        toggle = document.createElement('button')
        toggle.type = 'button'
        toggle.className = 'accessibility-toggle'
        toggle.textContent = 'Accessibility'
        toggle.setAttribute('aria-expanded', 'false')
        toggle.setAttribute('aria-controls', 'accessibility-panel')

        panel = document.createElement('div')
        panel.id = 'accessibility-panel'
        panel.className = 'accessibility-panel'
        panel.hidden = true
        panel.setAttribute('role', 'dialog')
        panel.setAttribute('aria-labelledby', 'accessibility-title')
        panel.innerHTML = panelHtml()

        document.body.append(toggle, panel)

        toggle.addEventListener('click', () => panel.hidden ? open() : close())
        panel.querySelector('.accessibility-close').addEventListener('click', close)
        panel.querySelector('.accessibility-reset').addEventListener('click', reset)
        panel.querySelectorAll('[name="accessibility-text-scale"]').forEach(input =>
            input.addEventListener('change', () => set('textScale', +input.value)))
        panel.querySelectorAll('[name="accessibility-palette"]').forEach(input =>
            input.addEventListener('change', () => set('palette', input.value)))
        panel.querySelectorAll('[data-key]').forEach(input =>
            input.addEventListener('change', () => set(input.dataset.key, input.checked)))

        // pop-up: a click outside closes it
        document.addEventListener('click', event => {
            if (!panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) close()
        })

        document.addEventListener('keydown', event => {
            if (event.altKey && event.code === 'KeyA') {
                event.preventDefault()
                panel.hidden ? open() : close()
            } else if (event.key === 'Escape' && !panel.hidden) {
                event.stopPropagation()   // only close the panel, not a dialog of the page behind it
                close()
            }
        })

        apply()
    }

    // apply the saved settings as soon as the script is loaded, before the page is drawn
    apply()

    window.FireAccessibility = {
        init,
        reset,
        set,
        get settings() { return Object.assign({}, settings) },
        onChange(listener) { listeners.push(listener) }
    }
})()
