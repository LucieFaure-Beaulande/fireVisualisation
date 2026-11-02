// Marks the page as embedded when it is loaded with ?embed (miniature on the home page).
// Must be loaded in the <head>, before the page is drawn.
if (new URLSearchParams(location.search).has('embed')) {
    document.documentElement.classList.add('embed')
}