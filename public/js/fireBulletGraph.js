// Extraction and aggregation of the fire occurrence dataset
// data table (array of fire objects, see fireData.js) → data ready to be visualized
// requires d3 and fireData.js (loadFires) to be loaded first

// the categorical column used as "cause", can be replaced by 'CauseBy' (16 values),
// 'SpecificCause' (117 values) or 'HumanOrLightning' (3 values)
let causeColumn = 'GeneralCause'

// 1. raw extraction: keep only the columns needed (FireYear, EstTotalAcres, cause)
function extractFires(fires) {
    return fires.map(fire => ({
        FireYear: fire.FireYear,
        EstTotalAcres: fire.EstTotalAcres,   // null when the cell is empty in the csv
        cause: fire[causeColumn]
    }))
}

// 2. number of fires and burned acres per year
// returns [{ year, fireCount, burnedAcres }, ...] sorted by year
function computeYearlyStats(fires) {
    let byYear = d3.rollups(
        fires,
        group => ({
            fireCount: group.length,
            // fires without a size (null) are ignored in the sum
            burnedAcres: d3.sum(group, fire => fire.EstTotalAcres)
        }),
        fire => fire.FireYear
    )

    return byYear
        .map(([year, stats]) => ({ year, ...stats }))
        .sort((a, b) => d3.ascending(a.year, b.year))
}

// 3. number of fires per cause and per year
// returns a flat array [{ year, cause, fireCount }, ...] sorted by year then cause
// (long format, convenient for stacked bars / multi-line charts)
function computeCausePerYear(fires) {
    let rows = []

    d3.rollups(
        fires,
        group => group.length,
        fire => fire.FireYear,
        fire => fire.cause
    ).forEach(([year, causes]) => {
        causes.forEach(([cause, fireCount]) => rows.push({ year, cause, fireCount }))
    })

    return rows.sort((a, b) => d3.ascending(a.year, b.year) || d3.ascending(a.cause, b.cause))
}

// 4. same as computeCausePerYear but with one row per year and one column per cause
// returns [{ year, Lightning: 120, Arson: 12, ... }, ...] with 0 for the missing causes
// (wide format, directly usable with d3.stack)
function computeCausePerYearWide(fires) {
    let causes = Array.from(new Set(fires.map(fire => fire.cause))).sort(d3.ascending)

    let rows = d3.rollups(
        fires,
        group => {
            let counts = Object.fromEntries(causes.map(cause => [cause, 0]))
            group.forEach(fire => counts[fire.cause]++)
            return counts
        },
        fire => fire.FireYear
    ).map(([year, counts]) => ({ year, ...counts }))

    return { causes, rows: rows.sort((a, b) => d3.ascending(a.year, b.year)) }
}

// load the csv and compute everything at once
function loadFireStats(url) {
    return loadFires(url).then(rawFires => {
        let fires = extractFires(rawFires)

        return {
            fires,                                          // one row per fire
            yearlyStats: computeYearlyStats(fires),         // one row per year
            causePerYear: computeCausePerYear(fires),       // one row per (year, cause)
            causePerYearWide: computeCausePerYearWide(fires) // one row per year, one column per cause
        }
    })
}
