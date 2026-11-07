// Data transformation for the sunburst diagram of the causes of fires
// data table (array of fire objects) → hierarchy of causes

// the levels of the hierarchy, from the center to the outside of the sunburst
let causeLevels = ['HumanOrLightning', 'GeneralCause', 'SpecificCause']

// the number of fires and the burned surface of a group of fires
function summarize(name, fires) {
    return {
        name: name,
        count: fires.length,
        acres: d3.sum(fires, d => d.EstTotalAcres)
    }
}

// group the fires by cause, one level of the hierarchy after the other
// each node has the format { name, count, acres, children }, the leaves have no children
function buildCauseHierarchy(fires) {
    let nest = (group, depth) => Array.from(d3.group(group, d => d[causeLevels[depth]]), ([name, values]) => {
        let node = summarize(name, values)
        if (depth < causeLevels.length - 1) node.children = nest(values, depth + 1)
        return node
    })

    let root = summarize('All fires', fires)
    root.children = nest(fires, 0)
    return root
}

// the rank of each cause in the complete dataset (0 = the cause with the most fires), one map per level
// used to always draw the causes in the same order, whatever the filters
function rankCauses(fires) {
    return causeLevels.map(level => {
        let counts = d3.rollups(fires, values => values.length, d => d[level])
            .sort((a, b) => d3.descending(a[1], b[1]))
        return new Map(counts.map((d, i) => [d[0], i]))
    })
}

// the month when a fire was discovered (0 = January), or reported when the discovery date is missing
function fireMonth(d) {
    return (d.Discover_DateTime || d.ReportDateTime).getMonth()
}

// keep only the fires matching the filters, a filter set to null keeps all the fires
// e.g. { county: 'Jackson', years: [2010, 2022], month: 7, owner: 'State' }
function filterFires(fires, filters) {
    return fires
        .filter(d => !filters.county || d.County === filters.county)
        .filter(d => !filters.years || (d.FireYear >= filters.years[0] && d.FireYear <= filters.years[1]))
        .filter(d => filters.month === null || fireMonth(d) === filters.month)
        .filter(d => !filters.owner || d.FO_LandOwnType === filters.owner)
}

// keep only the fires of a cause, described by its path in the hierarchy, e.g. ['Human', 'Arson']
function firesOfCause(fires, path) {
    return fires.filter(d => path.every((name, depth) => d[causeLevels[depth]] === name))
}
