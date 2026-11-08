// Marks the page as embedded when it is loaded with ?embed (miniature on the home page).
// Must be loaded in the <head>, before the page is drawn.
if (new URLSearchParams(location.search).has('embed')) {
    document.documentElement.classList.add('embed')

    // FireEmbed.onYear(callback): the home page sends the selected year with postMessage.
    // The last year received is kept, so a callback registered late is called immediately.
    // FireEmbed.onInteractive(callback): the home page switches the page between
    // miniature (false) and interactive main area (true), without reloading it.
    window.FireEmbed = (function () {
        let lastYear = null
        let interactive = false
        const yearListeners = []
        const interactiveListeners = []

        window.addEventListener('message', event => {
            if (event.origin !== location.origin) return
            const data = event.data
            if (!data) return

            if (data.type === 'setYear') {
                lastYear = data.year
                yearListeners.forEach(listener => listener(lastYear))
            }
            else if (data.type === 'setInteractive') {
                interactive = data.value === true
                document.documentElement.classList.toggle('interactive', interactive)
                interactiveListeners.forEach(listener => listener(interactive))
            }
        })

        return {
            onYear(listener) {
                yearListeners.push(listener)
                if (lastYear !== null) listener(lastYear)
            },
            onInteractive(listener) {
                interactiveListeners.push(listener)
                if (interactive) listener(interactive)
            }
        }
    })()
}