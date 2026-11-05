// Marks the page as embedded when it is loaded with ?embed (miniature on the home page).
// Must be loaded in the <head>, before the page is drawn.
if (new URLSearchParams(location.search).has('embed')) {
    document.documentElement.classList.add('embed')

    // FireEmbed.onYear(callback): the home page sends the selected year with postMessage.
    // The last year received is kept, so a callback registered late is called immediately.
    window.FireEmbed = (function () {
        let lastYear = null
        const listeners = []

        window.addEventListener('message', event => {
            if (event.origin !== location.origin) return
            if (!event.data || event.data.type !== 'setYear') return
            lastYear = event.data.year
            listeners.forEach(listener => listener(lastYear))
        })

        return {
            onYear(listener) {
                listeners.push(listener)
                if (lastYear !== null) listener(lastYear)
            }
        }
    })()
}