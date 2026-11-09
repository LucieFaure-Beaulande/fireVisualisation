// Reading, checking and merging the files of a dataset (see datasets.js)
//
// sources (never modified)         current file (built here)
// base file                  ─┐
// added file 1               ─┼──► one row per key, the newest version when a key appears several times
// added file 2               ─┘
//
// the base file is the original file, or a file that replaces it (e.g. the same data for another region)
// the original file is never modified: restoring the original data removes the replacement and the added files

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

// the file that replaces the original file is kept in a sub-folder of the added files, at most one file
const baseFolder = dataset => path.join(dataset.additions, 'base')

function replacementFile(dataset) {
    let folder = absolute(baseFolder(dataset))
    if (!fs.existsSync(folder)) return null
    let files = fs.readdirSync(folder).filter(file => file.endsWith('.csv')).sort()
    return files.length ? files[files.length - 1] : null
}

function removeReplacement(dataset) {
    let folder = absolute(baseFolder(dataset))
    if (fs.existsSync(folder)) fs.readdirSync(folder).forEach(file => fs.unlinkSync(path.join(folder, file)))
}

// the name of a stored file, and the time when it was stored
const storedName = file => file.split(separator).slice(1).join(separator)
const storedAt = file => new Date(+file.split(separator)[0]).toISOString()

// keep a file sent from the console in a folder: "<time>--<name>", without the characters unsafe in a file name
function storeFile(folder, name, text) {
    let safeName = path.basename(name || 'data.csv').replace(/[^\w.\-]+/g, '_')
    if (!safeName.endsWith('.csv')) safeName += '.csv'
    fs.mkdirSync(absolute(folder), { recursive: true })
    fs.writeFileSync(absolute(path.join(folder, Date.now() + separator + safeName)), text)
}

// the columns of the original file: the columns expected by the visualizations
async function originalColumns(dataset) {
    const d3 = await loadD3
    let firstLine = fs.readFileSync(absolute(dataset.original), 'utf8').replace(/^﻿/, '').split(/\r?\n/)[0]
    return d3.csvParseRows(firstLine)[0]
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

// build the current file from the base file (original or replacement) and the added files
async function build(dataset) {
    const d3 = await loadD3
    let parseDate = dataset.newest ? d3.timeParse(dataset.dateFormat) : null,
        replacement = replacementFile(dataset),
        base = await readCsv(replacement ? path.join(baseFolder(dataset), replacement) : dataset.original),
        columns = await originalColumns(dataset),
        sources = [{ rows: base }]

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

    // the current file keeps the columns of the original file, the columns read by the visualizations
    // (a column missing in the base file or in an added file is left empty)
    let rows = Array.from(byKey.values())
    fs.writeFileSync(absolute(dataset.current), d3.csvFormat(rows, columns))

    let previous = readSummary(dataset) || {}
    let summary = {
        builtAt: new Date().toISOString(),
        originalName: path.basename(dataset.original),
        // the base file: the original file, or the file that replaces it
        original: Object.assign(replacement
            ? { replacement: true, file: replacement, name: storedName(replacement), addedAt: storedAt(replacement) }
            : { name: path.basename(dataset.original) }, describe(dataset, base)),
        additions: sources.slice(1).map(source => Object.assign({
            file: source.file,
            name: storedName(source.file),
            addedAt: storedAt(source.file)
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
    // a summary written by an older version of the console has no originalName: it is built again
    if (!summary || !summary.originalName || !fs.existsSync(absolute(dataset.current))) summary = await build(dataset)
    return summary
}

// check a csv file before it is added (mode 'add') or before it replaces the original file (mode 'replace')
// errors refuse the file, warnings are only shown
async function check(dataset, text, mode) {
    let replace = mode === 'replace'
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

    let expected = await originalColumns(dataset),
        unknown = columns.filter(column => !expected.includes(column)),
        absent = expected.filter(column => !columns.includes(column))
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

    // a replacement is compared with nothing: all its rows are new
    let currentKeys = new Set(replace ? [] : current.map(row => keyOf(dataset, row))),
        alreadyPresent = Array.from(uniqueKeys).filter(key => currentKeys.has(key)).length,
        currentYears = new Set(current.map(row => +row[dataset.year])),
        fileYears = Array.from(new Set(rows.map(row => +row[dataset.year]).filter(year => year > 0))).sort((a, b) => a - b)

    return {
        ok: true,
        mode: replace ? 'replace' : 'add',
        errors,
        warnings,
        rows: rows.length,
        removedFiles: replace ? listAdditions(dataset).length : 0, // the added files removed by a replacement
        newRows: uniqueKeys.size - alreadyPresent,
        alreadyPresent, // rows already in the dataset: replaced when their version is newer
        years: describe(dataset, rows).years,
        newYears: replace ? [] : fileYears.filter(year => !currentYears.has(year))
    }
}

// keep a checked file in the folder of the added files, then rebuild the current file
async function add(dataset, name, text) {
    let result = await check(dataset, text, 'add')
    if (!result.ok) return { result }
    storeFile(dataset.additions, name, text)
    return { result, summary: await changed(dataset) }
}

// replace the base file with a checked file, then rebuild the current file
// the added files are removed: they completed the previous data (e.g. another region)
async function replaceBase(dataset, name, text) {
    let result = await check(dataset, text, 'replace')
    if (!result.ok) return { result }
    removeReplacement(dataset)
    listAdditions(dataset).forEach(file => fs.unlinkSync(absolute(path.join(dataset.additions, file))))
    storeFile(baseFolder(dataset), name, text)
    return { result, summary: await changed(dataset) }
}

// remove an added file, then rebuild the current file
async function remove(dataset, file) {
    if (!listAdditions(dataset).includes(file)) return null
    fs.unlinkSync(absolute(path.join(dataset.additions, file)))
    return changed(dataset)
}

// remove the replacement and all the added files: the current file becomes the original file again
async function reset(dataset) {
    removeReplacement(dataset)
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

module.exports = { state, check, add, replaceBase, remove, reset }
