// The admin console: one card per dataset (list given by the server, see admin/datasets.js)
// For each dataset: its current state, its files, the addition of a file with a check before, the restoration
// of the original data, and the result of the commands run after a change

let formatNumber = d3.format(','),
    formatDate = date => new Date(date).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
    formatYears = years => years ? (years[0] === years[1] ? `${years[0]}` : `${years[0]}–${years[1]}`) : '–'

// the files chosen in the page and not added yet, one per dataset: { file, text, check }
let pending = {}

FireAccessibility.init()

// ---------- requests to the server ----------

// send a request to the api of the console, returns the json answer, or throws its error message
function request(method, address, body) {
    return fetch('api/' + address, {
        method: method,
        headers: body === undefined ? {} : { 'Content-Type': 'text/csv' },
        body: body
    }).then(response => response.json().then(json => {
        if (!response.ok && !json.errors) throw new Error(json.error || response.statusText)
        return json
    }))
}

function loadDatasets() {
    return request('GET', 'datasets')
        .then(datasets => draw(datasets))
        .catch(error => d3.select('#datasets').append('p').attr('class', 'message error')
            .text(`The datasets cannot be loaded: ${error.message}`))
}

// ---------- drawing ----------

function draw(datasets) {
    d3.select('#loading').remove()

    d3.select('#datasets')
        .selectAll('section.dataset')
        .data(datasets, d => d.id)
        .join(enter => enter.append('section')
            .attr('class', 'card dataset')
            .call(createCard))
        .each(function(d) { updateCard(d3.select(this), d) })
}

// the parts of a card that do not depend on the state of the dataset
function createCard(card) {
    card.append('h2')
    card.append('p').attr('class', 'current')
    card.append('p').attr('class', 'used-by')

    card.append('h3').text('Files')
    card.append('table')
        .attr('class', 'files')
        .html('<thead><tr><th>File</th><th>Added</th><th class="number">Rows</th><th>Years</th><th></th></tr></thead><tbody></tbody>')

    let addition = card.append('div').attr('class', 'addition')
    addition.append('h3').text('Add a file')
    addition.append('p').attr('class', 'hint required')
    addition.append('label')
        .attr('class', 'file-field')
        .call(label => {
            label.append('span').text('CSV file')
            label.append('input')
                .attr('type', 'file')
                .attr('accept', '.csv,text/csv')
                .on('change', function(event) {
                    let d = d3.select(this.closest('section')).datum()
                    if (this.files.length) checkFile(d, this.files[0])
                })
        })
    addition.append('div').attr('class', 'preview').attr('hidden', true)

    card.append('div').attr('class', 'after-change')

    card.append('div')
        .attr('class', 'card-footer')
        .append('button')
        .attr('type', 'button')
        .attr('class', 'reset')
        .text('Restore the original data')
        .on('click', function() { restore(d3.select(this.closest('section')).datum()) })

    // the result of the last action, read by the screen readers
    card.append('p').attr('class', 'message').attr('role', 'status')
}

function updateCard(card, d) {
    let summary = d.summary

    card.select('h2').text(d.label)

    card.select('.current')
        .text(`Current data: ${formatNumber(summary.current.rows)} rows, ${formatYears(summary.current.years)}`
            + (summary.replaced ? ` · ${formatNumber(summary.replaced)} rows replaced by a newer version` : '')
            + ` · built on ${formatDate(summary.builtAt)}`)

    card.select('.used-by')
        .html(d.usedBy.length ? 'Used by: ' : '')
        .selectAll('a')
        .data(d.usedBy)
        .join('a')
        .attr('href', link => link.url)
        .attr('target', '_blank')
        .text(link => link.label)

    // the original file first, then the added files, from the oldest
    let files = [Object.assign({ original: true }, summary.original)].concat(summary.additions)

    card.select('table.files tbody')
        .selectAll('tr')
        .data(files, file => file.file || 'original')
        .join('tr')
        .classed('original', file => file.original)
        .html('<td class="name"></td><td class="added"></td><td class="number"></td><td class="years"></td><td class="action"></td>')
        .each(function(file) {
            let row = d3.select(this)
            row.select('.name').text(file.name)
            row.select('.added').text(file.original ? 'original file' : formatDate(file.addedAt))
            row.select('.number').text(formatNumber(file.rows))
            row.select('.years').text(formatYears(file.years))
            if (!file.original) row.select('.action')
                .append('button')
                .attr('type', 'button')
                .attr('class', 'remove')
                .attr('aria-label', `Remove ${file.name}`)
                .text('Remove')
                .on('click', () => removeFile(d, file))
        })

    card.select('.required')
        .text(`A CSV file with the columns of the original file. Required columns: ${d.required.join(', ')}. `
            + `A row whose ${d.key} is already in the data replaces it when its version is newer.`)

    card.select('.reset').attr('disabled', summary.additions.length ? null : true)

    drawAfterChange(card, d)
    drawPreview(card, d)
}

// the commands run after a change, with the result of their last run
function drawAfterChange(card, d) {
    let box = card.select('.after-change')
    box.html('')
    if (!d.afterChangeSteps.length) return

    box.append('h3').text('After a change')
    let runs = new Map(d.summary.afterChange.map(run => [run.label, run]))
    let items = box.append('ul')
        .selectAll('li')
        .data(d.afterChangeSteps)
        .join('li')

    items.append('span')
        .attr('class', label => 'step ' + (!runs.has(label) ? 'waiting' : runs.get(label).ok ? 'ok' : 'error'))
        .text(label => !runs.has(label) ? `${label}: not run yet`
            : `${label}: ${runs.get(label).ok ? 'done' : 'failed'} on ${formatDate(runs.get(label).at)}`)

    items.filter(label => runs.has(label) && runs.get(label).output)
        .append('details')
        .call(details => {
            details.append('summary').text('Output')
            details.append('pre').text(label => runs.get(label).output)
        })
}

// the check of the chosen file, before it is added
function drawPreview(card, d) {
    let box = card.select('.preview'),
        chosen = pending[d.id]

    box.attr('hidden', chosen ? null : true).html('')
    if (!chosen) return

    let check = chosen.check
    box.append('p').attr('class', 'preview-title').text(chosen.file.name)

    let lines = check.errors.map(text => ({ type: 'error', text: text }))
    if (check.ok) lines.push(
        { type: 'info', text: `${formatNumber(check.rows)} rows, ${formatYears(check.years)}` },
        { type: 'info', text: `${formatNumber(check.newRows)} new rows, ${formatNumber(check.alreadyPresent)} already in the data` },
        { type: 'info', text: check.newYears.length ? `New years: ${check.newYears.join(', ')}` : 'No new year' })
    lines = lines.concat(check.warnings.map(text => ({ type: 'warning', text: text })))

    box.append('ul')
        .selectAll('li')
        .data(lines)
        .join('li')
        .attr('class', line => line.type)
        .text(line => line.text)

    let buttons = box.append('div').attr('class', 'buttons')
    if (check.ok) buttons.append('button')
        .attr('type', 'button')
        .attr('class', 'primary')
        .text('Add to the dataset')
        .on('click', () => addFile(d))
    buttons.append('button')
        .attr('type', 'button')
        .text('Cancel')
        .on('click', () => cancel(d))
}

// ---------- actions ----------

let cardOf = d => d3.selectAll('section.dataset').filter(other => other.id === d.id)

function showMessage(d, text, type) {
    cardOf(d).select('.message')
        .attr('class', 'message ' + (type || ''))
        .text(text)
}

// read the chosen file and ask the server to check it
function checkFile(d, file) {
    showMessage(d, `Checking ${file.name}…`)
    file.text()
        .then(text => request('POST', `datasets/${d.id}/preview`, text)
            .then(check => {
                pending[d.id] = { file: file, text: text, check: check }
                showMessage(d, check.ok ? 'Check the summary of the file, then add it to the dataset.'
                    : 'This file cannot be added.', check.ok ? '' : 'error')
                drawPreview(cardOf(d), d)
            }))
        .catch(error => showMessage(d, `The file cannot be checked: ${error.message}`, 'error'))
}

function addFile(d) {
    let chosen = pending[d.id]
    showMessage(d, `Adding ${chosen.file.name}…`)
    request('POST', `datasets/${d.id}/additions?name=${encodeURIComponent(chosen.file.name)}`, chosen.text)
        .then(result => {
            if (result.errors) return showMessage(d, result.errors.join(' '), 'error')
            delete pending[d.id]
            cardOf(d).select('input[type="file"]').property('value', '')
            showMessage(d, `${chosen.file.name} added: the data now has ${formatNumber(result.summary.current.rows)} rows, `
                + `${formatYears(result.summary.current.years)}. Reload the visualizations to see the new data.`, 'success')
            return loadDatasets()
        })
        .catch(error => showMessage(d, `The file cannot be added: ${error.message}`, 'error'))
}

function cancel(d) {
    delete pending[d.id]
    cardOf(d).select('input[type="file"]').property('value', '')
    showMessage(d, '')
    drawPreview(cardOf(d), d)
}

function removeFile(d, file) {
    if (!confirm(`Remove ${file.name} from the data?`)) return
    request('DELETE', `datasets/${d.id}/additions/${encodeURIComponent(file.file)}`)
        .then(result => {
            showMessage(d, `${file.name} removed: the data now has ${formatNumber(result.summary.current.rows)} rows.`, 'success')
            return loadDatasets()
        })
        .catch(error => showMessage(d, `The file cannot be removed: ${error.message}`, 'error'))
}

function restore(d) {
    if (!confirm('Remove all the added files and restore the original data?')) return
    request('POST', `datasets/${d.id}/reset`)
        .then(result => {
            showMessage(d, `Original data restored: ${formatNumber(result.summary.current.rows)} rows.`, 'success')
            return loadDatasets()
        })
        .catch(error => showMessage(d, `The data cannot be restored: ${error.message}`, 'error'))
}

loadDatasets()
