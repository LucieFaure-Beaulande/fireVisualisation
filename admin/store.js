// Reading, checking and merging the files of a dataset (see datasets.js)
//
// sources (never modified)         current file (built here)
// original file              ─┐
// added file 1               ─┼──► one row per key, the newest version when a key appears several times
// added file 2               ─┘

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

// d3 is an ES module: it is loaded with import(), which works with every version of node
const loadD3 = import('d3')

const root = path.join(__dirname, '..')
const absolute = file => path.join(root, file)

// a stored file is named "<time of the addition>--<name of the file sent>"
const separator = '--'

async function readCsv(file) {
    const d3 = await loadD3
    return d3.csvParse(fs.readFileSync(absolute(file), 'utf8').replace(/^﻿/, ''))
}

// the files added to a dataset, from the oldest to the newest
function listAdditions(dataset) {
    let folder = absolute(dataset.additions)
    if (!fs.existsSync(folder)) return []
    return fs.readdirSync(folder).filter(file => file.endsWith('.csv')).sort()
}

// the number of rows and the first and last years of a table
function describe(dataset, rows) {
    let years = rows.map(row => +row[dataset.year]).filter(year => year > 0)
    return {
        rows: rows.length,
        years: years.length ? [Math.min(...years), Math.max(...years)] : null
    }
}

// the key of a row: the value of the key column, or the values of the key columns joined
// (key: 'Serial', or key: ['year', 'month', 'county'] when a row is identified by several columns)
const keyOf = (dataset, row) => [].concat(dataset.key).map(column => (row[column] || '').trim()).join('|')
const hasKey = (dataset, row) => [].concat(dataset.key).every(column => (row[column] || '').trim())
const keyName = dataset => [].concat(dataset.key).join(' + ')

// "1 row", "2 rows"
const count = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`

// the summary of the last build, kept next to the added files
const summaryFile = dataset => path.join(dataset.additions, 'summary.json')

function readSummary(dataset) {
    try { return JSON.parse(fs.readFileSync(absolute(summaryFile(dataset)), 'utf8')) } catch (e) { return null }
}

function writeSummary(dataset, summary) {
    fs.mkdirSync(absolute(dataset.additions), { recursive: true })
    fs.writeFileSync(absolute(summaryFile(dataset)), JSON.stringify(summary, null, 2))
}

// build the current file from the original file and the added files
async function build(dataset) {
    const d3 = await loadD3
    let parseDate = dataset.newest ? d3.timeParse(dataset.dateFormat) : null,
        original = await readCsv(dataset.original),
        sources = [{ name: path.basename(dataset.original), rows: original }]

    for (let file of listAdditions(dataset))
        sources.push({ file: file, rows: await readCsv(path.join(dataset.additions, file)) })

    // a row replaces the previous row with the same key, unless it is older (newest column, when there is one)
    let isOlder = (row, previous) => {
        if (!parseDate) return false
        let date = parseDate(row[dataset.newest] || ''),
            previousDate = parseDate(previous[dataset.newest] || '')
        return date && previousDate && date < previousDate
    }

    let byKey = new Map(),
        read = 0
    sources.forEach(source => source.rows.forEach(row => {
        if (!hasKey(dataset, row)) return
        let key = keyOf(dataset, row)
        read++
        let previous = byKey.get(key)
        if (!previous || !isOlder(row, previous)) byKey.set(key, row)
    }))

    // the current file keeps the columns of the original file
    let rows = Array.from(byKey.values())
    fs.writeFileSync(absolute(dataset.current), d3.csvFormat(rows, original.columns))

    let previous = readSummary(dataset) || {}
    let summary = {
        builtAt: new Date().toISOString(),
        original: Object.assign({ name: path.basename(dataset.original) }, describe(dataset, original)),
        additions: sources.slice(1).map(source => Object.assign({
            file: source.file,
            name: source.file.split(separator).slice(1).join(separator),
            addedAt: new Date(+source.file.split(separator)[0]).toISOString()
        }, describe(dataset, source.rows))),
        current: describe(dataset, rows),
        replaced: read - rows.length, // rows replaced by a newer version of the same key
        afterChange: previous.afterChange || []
    }
    writeSummary(dataset, summary)
    return summary
}

// the state of a dataset, built when the current file does not exist yet
async function state(dataset) {
    let summary = readSummary(dataset)
    if (!summary || !fs.existsSync(absolute(dataset.current))) summary = await build(dataset)
    return summary
}

// check a csv file before it is added: errors refuse the file, warnings are only shown
async function check(dataset, text) {
    const d3 = await loadD3
    let errors = [],
        warnings = [],
        rows

    try { rows = d3.csvParse(text.replace(/^﻿/, '')) }
    catch (e) { return { ok: false, errors: ['The file cannot be read as a CSV file.'], warnings } }

    await state(dataset) // the current file must exist to compare the file with it
    let current = await readCsv(dataset.current),
        columns = rows.columns || []

    if (!rows.length) errors.push('The file has no data row.')
    let missing = dataset.required.filter(column => !columns.includes(column))
    if (missing.length) errors.push(`Missing required columns: ${missing.join(', ')}.`)
    if (errors.length) return { ok: false, errors, warnings }

    let unknown = columns.filter(column => !current.columns.includes(column)),
        absent = current.columns.filter(column => !columns.includes(column))
    if (unknown.length) warnings.push(`Unknown columns, ignored: ${unknown.join(', ')}.`)
    if (absent.length) warnings.push(`Columns not in the file, left empty: ${absent.join(', ')}.`)

    let keys = rows.map(row => hasKey(dataset, row) ? keyOf(dataset, row) : ''),
        withoutKey = keys.filter(key => !key).length,
        uniqueKeys = new Set(keys.filter(Boolean)),
        invalidYears = dataset.year ? rows.filter(row => !(+row[dataset.year] > 0)).length : 0
    if (withoutKey) warnings.push(`${count(withoutKey, 'row')} without ${keyName(dataset)}: ignored.`)
    if (invalidYears) warnings.push(`${count(invalidYears, 'row')} with an invalid ${dataset.year}.`)

    // empty cells in the required columns: the rows are kept, the visualizations show these values as unknown
    dataset.required.forEach(column => {
        let empty = rows.filter(row => !(row[column] || '').trim()).length
        if (empty && ![].concat(dataset.key).includes(column))
            warnings.push(`${count(empty, 'row')} with an empty ${column}: shown as "Unspecified" or unknown.`)
    })
    if (keys.length - withoutKey > uniqueKeys.size)
        warnings.push(`${count(keys.length - withoutKey - uniqueKeys.size, 'row')} twice in the file: the newest version is kept.`)

    let currentKeys = new Set(current.map(row => keyOf(dataset, row))),
        alreadyPresent = Array.from(uniqueKeys).filter(key => currentKeys.has(key)).length,
        currentYears = new Set(current.map(row => +row[dataset.year])),
        fileYears = Array.from(new Set(rows.map(row => +row[dataset.year]).filter(year => year > 0))).sort((a, b) => a - b)

    return {
        ok: true,
        errors,
        warnings,
        rows: rows.length,
        newRows: uniqueKeys.size - alreadyPresent,
        alreadyPresent, // rows already in the dataset: replaced when their version is newer
        years: describe(dataset, rows).years,
        newYears: fileYears.filter(year => !currentYears.has(year))
    }
}

// keep a checked file in the folder of the added files, then rebuild the current file
async function add(dataset, name, text) {
    let result = await check(dataset, text)
    if (!result.ok) return { result }

    let safeName = path.basename(name || 'data.csv').replace(/[^\w.\-]+/g, '_')
    if (!safeName.endsWith('.csv')) safeName += '.csv'
    fs.mkdirSync(absolute(dataset.additions), { recursive: true })
    fs.writeFileSync(absolute(path.join(dataset.additions, Date.now() + separator + safeName)), text)

    return { result, summary: await changed(dataset) }
}

// remove an added file, then rebuild the current file
async function remove(dataset, file) {
    if (!listAdditions(dataset).includes(file)) return null
    fs.unlinkSync(absolute(path.join(dataset.additions, file)))
    return changed(dataset)
}

// remove all the added files: the current file becomes the original file again
async function reset(dataset) {
    listAdditions(dataset).forEach(file => fs.unlinkSync(absolute(path.join(dataset.additions, file))))
    return changed(dataset)
}

// after a change: rebuild the current file, then run the commands of afterChange
async function changed(dataset) {
    let summary = await build(dataset)
    summary.afterChange = []
    for (let step of dataset.afterChange || []) summary.afterChange.push(await run(step))
    writeSummary(dataset, summary)
    return summary
}

// run a command of afterChange and keep what it printed
function run(step) {
    return new Promise(resolve => {
        // the command is a program (node, python...) and its arguments, without a shell
        execFile(step.command, step.args || [], { cwd: absolute(step.folder || '.'), maxBuffer: 10 * 1024 * 1024 },
            (error, stdout, stderr) => resolve({
                label: step.label,
                ok: !error,
                at: new Date().toISOString(),
                output: (stdout + stderr + (error ? '\n' + error.message : '')).trim().slice(-5000)
            }))
    })
}

module.exports = { state, check, add, remove, reset }
