// Data colors shared by the visualizations

(function () {
    // the sequential palettes that can be named in --data-sequential
    let sequentials = {
        Oranges: d3.interpolateOranges,
        Reds: d3.interpolateReds,
        Blues: d3.interpolateBlues,
        YlOrRd: d3.interpolateYlOrRd,
        Viridis: d3.interpolateViridis,
        Cividis: d3.interpolateCividis
    }

    function token(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    }

    function sequential() {
        return sequentials[token('--data-sequential')] || d3.interpolateOranges
    }

    window.FirePalette = { token, sequential }
})()
