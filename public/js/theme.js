// The colors of the sunburst, and the functions to use them with d3
// They match the colors of the common style sheet /css/theme.css

let theme = {
    // categorical colors, one per category, to use in this order (the order keeps neighbours distinguishable)
    // beyond 8 categories, the other categories have the neutral color
    categorical: ['#6c9ce8', '#f2896b', '#3fbf9f', '#dfa93a', '#e58cb8', '#6fb85a', '#9b85e6', '#e0636f'],

    // neutral colors, for "other", "unknown" and the elements that are not the subject
    neutral: '#a9afc0',
    neutralLight: '#d9dce6',

    surface: '#ffffff', // the background of the chart
    text: '#1f2333',

    duration: 600 // the duration of the transitions in milliseconds
}

// a scale giving one color per category, the categories that are not in the domain are neutral
// e.g. let color = categoricalScale(['Human', 'Lightning']); color('Human')
function categoricalScale(domain) {
    return d3.scaleOrdinal()
        .domain(domain.slice(0, theme.categorical.length))
        .range(theme.categorical)
        .unknown(theme.neutral)
}

// a lighter shade of a color, amount from 0 (same color) to 1 (color of the surface)
function lighten(color, amount) {
    return d3.interpolateRgb(color, theme.surface)(amount)
}

// the color of a text written on a colored shape: dark on a light color, white on a dark color
function textOn(color) {
    return d3.lab(color).l > 55 ? theme.text : '#ffffff'
}
