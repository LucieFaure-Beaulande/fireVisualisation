// The admin console: one card per dataset (list given by the server, see admin/datasets.js)
// For each dataset: its current state, its files, the addition of a file or the replacement of the original file
// with a check before, the restoration of the original data, and the result of the commands run after a change

let formatNumber = d3.format(','),
    formatDate = date => new Date(date).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
    formatYears = years => years ? (years[0] === years[1] ? `${years[0]}` : `${years[0]}–${years[1]}`) : '–',
    keyName = key => [].concat(key).join(' + ')

// the files chosen in the page and not added yet, one per dataset: { file, text, check }
let pending = {}

// what a chosen file does, one per dataset: 'add' (add its rows to the data) or 'replace' (replace the original file)
let modes = {}
let modeOf = d => modes[d.id] || 'add'

// the original data can be restored when a file was added or when the original file was replaced
let canRestore = summary => summary.additions.length > 0 || !!summary.original.replacement

FireAccessibility.init()

// ---------- icons (lines drawn with the color of the text) ----------

let icons = {
    upload: '<path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
    file: '<path d="M14 3H6.5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V7.5z"/><path d="M14 3v4.5h4.5"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16 9.5"/>',
    warning: '<path d="M10.3 4.2L2.6 17.6A2 2 0 0 0 4.3 20.6h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4m0 3.2v.1"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6m0-6l6 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5m0-9v.1"/>',
    trash: '<path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    restore: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.7"/><path d="M4 4v4.7h4.7"/>'
}

let icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`

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
        .catch(error => {
            d3.select('#loading').remove()
            d3.select('#datasets').append('p').attr('class', 'message error')
                .html(icon('error')).append('span')
                .text(`The datasets cannot be loaded: ${error.message}`)
        })
}

// ---------- drawing ----------

function draw(datasets) {
    d3.select('#loading').remove()

    d3.select('#datasets')
        .selectAll('section.dataset')
        .data(datasets, d => d.id)
        .join(enter => enter.append('section')
            .attr('class', 'card dataset')
            .attr('aria-labelledby', d => `title-${d.id}`)
            .call(createCard))
        .each(function(d) { updateCard(d3.select(this), d) })
}

// the parts of a card that do not depend on the state of the dataset
function createCard(card) {
    let header = card.append('header').attr('class', 'dataset-header')
    header.append('h2').attr('id', d => `title-${d.id}`)
    header.append('p').attr('class', 'built')

    // the result of the last action, read by the screen readers
    card.append('div').attr('class', 'message').attr('role', 'status')

    card.append('dl').attr('class', 'facts')

    let body = card.append('div').attr('class', 'dataset-body')

    // left: the files of the dataset
    let files = body.append('div').attr('class', 'panel files-panel')
    files.append('h3').html('Files <span class="count"></span>')
    files.append('div')
        .attr('class', 'table-wrap')
        .append('table')
        .attr('class', 'files')
        .html('<thead><tr><th>File</th><th class="number">Rows</th><th>Years</th>'
            + '<th><span class="sr-only">Actions</span></th></tr></thead><tbody></tbody>')
    files.append('div')
        .attr('class', 'panel-footer')
        .append('button')
        .attr('type', 'button')
        .attr('class', 'danger reset')
        .html(`${icon('restore')}<span>Restore the original data</span>`)
        .on('click', function() { restore(d3.select(this.closest('section')).datum()) })

    // right: the addition of a file, or the replacement of the original file
    let addition = body.append('div').attr('class', 'panel addition')
    addition.append('h3').text('Change the data')

    addition.append('span')
        .attr('class', 'segmented mode')
        .attr('role', 'radiogroup')
        .attr('aria-label', 'What the file does')
        .selectAll('label')
        .data(d => [{ id: d.id, value: 'add', text: 'Add data' }, { id: d.id, value: 'replace', text: 'Replace the original data' }])
        .join('label')
        .call(label => {
            label.append('input')
                .attr('type', 'radio')
                .attr('name', option => `mode-${option.id}`)
                .attr('value', option => option.value)
                .property('checked', option => option.value === 'add')
                .on('change', function(event, option) {
                    let d = d3.select(this.closest('section')).datum()
                    modes[d.id] = option.value
                    cancel(d) // a file chosen for the other mode is checked again
                    drawFormat(cardOf(d), d)
                })
            label.append('span').text(option => option.text)
        })

    // the file input is inside a large zone: click (or keyboard) to choose a file, or drop a file on it
    let zone = addition.append('label').attr('class', 'dropzone')
    zone.append('input')
        .attr('type', 'file')
        .attr('class', 'sr-only')
        .attr('accept', '.csv,text/csv')
        .on('change', function() {
            let d = d3.select(this.closest('section')).datum()
            if (this.files.length) checkFile(d, this.files[0])
        })
    zone.append('span').attr('class', 'dropzone-icon').html(icon('upload'))
    zone.append('span').attr('class', 'dropzone-title').html('<strong>Choose a CSV file</strong> or drop it here')
    zone.append('span').attr('class', 'dropzone-hint').text('It is checked before anything is changed')
    zone.on('dragover', function(event) {
            event.preventDefault()
            d3.select(this).classed('dragging', true)
        })
        .on('dragleave', function() { d3.select(this).classed('dragging', false) })
        .on('drop', function(event) {
            event.preventDefault()
            d3.select(this).classed('dragging', false)
            let file = event.dataTransfer.files[0]
            if (file) checkFile(d3.select(this.closest('section')).datum(), file)
        })

    addition.append('div').attr('class', 'format')
    addition.append('div').attr('class', 'preview').attr('hidden', true)

    card.append('div').attr('class', 'after-change')
}

function updateCard(card, d) {
    let summary = d.summary

    card.select('h2').text(d.label)
    card.select('.built').text(`Updated ${formatDate(summary.builtAt)}`)

    // key figures of the current data, in one line: "23,490 rows | 2000–2022 | 0 added files | 0 rows replaced"
    let facts = [
        { label: 'rows', value: formatNumber(summary.current.rows) },
        { label: 'years', value: formatYears(summary.current.years), hidden: true }, // "2000–2022" is clear alone
        { label: summary.additions.length === 1 ? 'added file' : 'added files', value: formatNumber(summary.additions.length) },
        { label: 'rows replaced', value: formatNumber(summary.replaced || 0), title: 'Rows replaced by a newer version' }
    ]
    card.select('.facts')
        .selectAll('.fact')
        .data(facts)
        .join(enter => enter.append('div').attr('class', 'fact')
            .call(fact => {
                fact.append('dt')
                fact.append('dd')
            }))
        .attr('title', fact => fact.title || null)
        .call(fact => {
            fact.select('dd').text(f => f.value)
            fact.select('dt').text(f => f.label).classed('sr-only', f => f.hidden)
        })

    // the base file first (the original file or its replacement), then the added files, from the oldest
    let files = [Object.assign({ original: true }, summary.original)].concat(summary.additions)

    card.select('.files-panel .count').text(files.length)

    card.select('table.files tbody')
        .selectAll('tr')
        .data(files, file => file.file || 'original')
        .join('tr')
        .classed('original', file => file.original)
        .html('<td class="name"></td><td class="number"></td><td class="years"></td><td class="action"></td>')
        .each(function(file) {
            let row = d3.select(this)
            // the name of the file, with "Original" or "Replaces the original" and the date of the addition below it
            let name = row.select('.name').append('div').attr('class', 'name-cell').html(icon('file'))
            let text = name.append('div')
            text.append('div').attr('class', 'file-name').text(file.name)
            if (file.original) text.append('span').attr('class', 'badge')
                .text(file.replacement ? `Replaces ${summary.originalName}` : 'Original')
            if (file.addedAt) text.append('div').attr('class', 'added').text(`Added ${formatDate(file.addedAt)}`)
            row.select('.number').text(formatNumber(file.rows))
            row.select('.years').text(formatYears(file.years))
            if (!file.original) row.select('.action')
                .append('button')
                .attr('type', 'button')
                .attr('class', 'ghost danger small remove')
                .attr('aria-label', `Remove ${file.name}`)
                .html(`${icon('trash')}<span>Remove</span>`)
                .on('click', () => removeFile(d, file))
        })

    card.select('.reset').property('disabled', !canRestore(summary))

    drawFormat(card, d)
    drawAfterChange(card, d)
    drawPreview(card, d)
}

// what a file must contain, and what it does in the chosen mode
function drawFormat(card, d) {
    let format = card.select('.format').html('')
    format.append('p').attr('class', 'format-title').text('Required columns')
    format.append('ul')
        .attr('class', 'columns')
        .selectAll('li')
        .data(d.required)
        .join('li')
        .append('code')
        .text(column => column)
    format.append('p').attr('class', 'hint')
        .text(modeOf(d) === 'add'
            ? `The other columns of the original file are optional. A row whose ${keyName(d.key)} is already `
                + 'in the data replaces it when its version is newer.'
            : `The file replaces ${d.summary.originalName}.`)
}

// the commands run after a change, with the result of their last run
function drawAfterChange(card, d) {
    let box = card.select('.after-change')
    box.html('')
    if (!d.afterChangeSteps.length) return

    box.append('h3').text('After each change')
    let runs = new Map(d.summary.afterChange.map(run => [run.label, run]))
    let status = label => !runs.has(label) ? 'waiting' : runs.get(label).ok ? 'ok' : 'error'

    let items = box.append('ul')
        .attr('class', 'steps')
        .selectAll('li')
        .data(d.afterChangeSteps)
        .join('li')
        .attr('class', label => 'step ' + status(label))

    let line = items.append('div').attr('class', 'step-line')
    line.append('span').attr('class', 'step-label').text(label => label)
    line.append('span')
        .attr('class', label => 'badge ' + status(label))
        .text(label => ({ waiting: 'Not run yet', ok: 'Done', error: 'Failed' })[status(label)])
    line.filter(label => runs.has(label))
        .append('span')
        .attr('class', 'step-date')
        .text(label => formatDate(runs.get(label).at))

    items.filter(label => runs.has(label) && runs.get(label).output)
        .append('details')
        .call(details => {
            details.append('summary').text('Show the output')
            details.append('pre').text(label => runs.get(label).output)
        })
}

// the check of the chosen file, before it is added
function drawPreview(card, d) {
    let box = card.select('.preview'),
        chosen = pending[d.id]

    // while a file is checked, the preview takes the place of the file zone
    box.attr('hidden', chosen ? null : true).html('')
    card.select('.dropzone').attr('hidden', chosen ? true : null)
    card.select('.format').attr('hidden', chosen ? true : null)
    if (!chosen) return

    let check = chosen.check,
        replace = check.mode === 'replace'
    box.classed('ok', check.ok).classed('error', !check.ok)

    let head = box.append('div').attr('class', 'preview-head')
    head.append('span').attr('class', 'preview-file').html(icon('file')).append('span').text(chosen.file.name)
    head.append('span')
        .attr('class', 'badge ' + (check.ok ? 'ok' : 'error'))
        .text(check.ok ? (replace ? 'Ready to replace' : 'Ready to add') : (replace ? 'Cannot replace' : 'Cannot be added'))

    if (check.ok) box.append('div')
        .attr('class', 'stats preview-stats')
        .selectAll('.stat')
        .data(replace
            ? [
                { label: 'Rows in the file', value: formatNumber(check.rows) },
                { label: 'Years', value: formatYears(check.years) },
                { label: 'Added files removed', value: formatNumber(check.removedFiles) }
            ]
            : [
                { label: 'Rows in the file', value: formatNumber(check.rows) },
                { label: 'New rows', value: formatNumber(check.newRows) },
                { label: 'Already in the data', value: formatNumber(check.alreadyPresent) },
                { label: 'New years', value: check.newYears.length ? check.newYears.join(', ') : 'None' }
            ])
        .join('div')
        .attr('class', 'stat')
        .html(stat => `<div class="label"></div><div class="value"></div>`)
        .call(stat => {
            stat.select('.label').text(s => s.label)
            stat.select('.value').text(s => s.value)
        })

    if (check.ok && !replace) box.append('p').attr('class', 'hint').text(`Years in the file: ${formatYears(check.years)}`)

    let lines = check.errors.map(text => ({ type: 'error', text: text }))
        .concat(check.warnings.map(text => ({ type: 'warning', text: text })))

    if (lines.length) box.append('ul')
        .attr('class', 'issues')
        .selectAll('li')
        .data(lines)
        .join('li')
        .attr('class', line => line.type)
        .html(line => icon(line.type))
        .append('span')
        .text(line => line.text)

    let buttons = box.append('div').attr('class', 'buttons')
    if (check.ok) buttons.append('button')
        .attr('type', 'button')
        .attr('class', 'primary add')
        .html(`${icon('upload')}<span>${replace ? 'Replace the original data' : 'Add to the dataset'}</span>`)
        .on('click', () => replace ? replaceBase(d) : addFile(d))
    buttons.append('button')
        .attr('type', 'button')
        .attr('class', check.ok ? 'ghost' : null)
        .text(check.ok ? 'Cancel' : 'Choose another file')
        .on('click', () => cancel(d))

    // the keyboard focus goes to the next action
    buttons.select('button').node().focus()
}

// ---------- actions ----------

let cardOf = d => d3.selectAll('section.dataset').filter(other => other.id === d.id)

// the result of an action, at the top of the card
function showMessage(d, text, type) {
    let box = cardOf(d).select('.message')
        .attr('class', 'message ' + (type || ''))
        .html('')
    if (!text) return
    if (type === 'loading') box.append('span').attr('class', 'spinner').attr('aria-hidden', true)
    else box.html(icon(type === 'error' ? 'error' : type === 'success' ? 'check' : 'info'))
    box.append('span').text(text)
}

// a card waiting for the server: its buttons are disabled until the answer
function setBusy(d, busy) {
    let card = cardOf(d)
    card.classed('busy', busy).attr('aria-busy', busy ? 'true' : null)
    card.selectAll('button, input').property('disabled', busy)
    if (!busy) card.select('.reset').property('disabled', !canRestore(card.datum().summary))
}

// a confirmation window, resolved with true when the action is confirmed
function confirmAction(title, text, action) {
    return new Promise(resolve => {
        let dialog = d3.select('body').append('dialog')
            .attr('class', 'confirm')
            .attr('aria-labelledby', 'confirm-title')
        dialog.append('h2').attr('id', 'confirm-title').text(title)
        dialog.append('p').text(text)
        let buttons = dialog.append('div').attr('class', 'buttons')
        // the safe choice first: it has the focus when the window opens
        buttons.append('button').attr('type', 'button').attr('class', 'ghost').text('Cancel')
            .on('click', () => dialog.node().close('cancel'))
        buttons.append('button').attr('type', 'button').attr('class', 'danger solid').text(action)
            .on('click', () => dialog.node().close('confirm'))
        // a click outside the window cancels
        dialog.on('click', event => { if (event.target === dialog.node()) dialog.node().close('cancel') })
            .on('close', () => {
                resolve(dialog.node().returnValue === 'confirm')
                dialog.remove()
            })
        dialog.node().showModal()
    })
}

// read the chosen file and ask the server to check it
function checkFile(d, file) {
    showMessage(d, `Checking ${file.name}…`, 'loading')
    setBusy(d, true)
    file.text()
        .then(text => request('POST', `datasets/${d.id}/preview?mode=${modeOf(d)}`, text)
            .then(check => {
                pending[d.id] = { file: file, text: text, check: check }
                setBusy(d, false)
                showMessage(d, check.ok
                    ? `Check the summary of the file, then ${check.mode === 'replace' ? 'replace the original data' : 'add it to the dataset'}.`
                    : 'This file cannot be used.', check.ok ? '' : 'error')
                drawPreview(cardOf(d), d)
            }))
        .catch(error => {
            setBusy(d, false)
            showMessage(d, `The file cannot be checked: ${error.message}`, 'error')
        })
}

function addFile(d) {
    let chosen = pending[d.id]
    showMessage(d, `Adding ${chosen.file.name}…`, 'loading')
    setBusy(d, true)
    request('POST', `datasets/${d.id}/additions?name=${encodeURIComponent(chosen.file.name)}`, chosen.text)
        .then(result => {
            setBusy(d, false)
            if (result.errors) return showMessage(d, result.errors.join(' '), 'error')
            delete pending[d.id]
            cardOf(d).select('input[type="file"]').property('value', '')
            showMessage(d, `${chosen.file.name} added: the data now has ${formatNumber(result.summary.current.rows)} rows, `
                + `${formatYears(result.summary.current.years)}. Reload the visualizations to see the new data.`, 'success')
            return loadDatasets()
        })
        .catch(error => {
            setBusy(d, false)
            showMessage(d, `The file cannot be added: ${error.message}`, 'error')
        })
}

// replace the original file with the chosen file, after a confirmation (the added files are removed)
function replaceBase(d) {
    let chosen = pending[d.id],
        count = chosen.check.removedFiles
    confirmAction('Replace the original data?',
        `${chosen.file.name} will be used instead of ${d.summary.originalName}`
            + (count ? ` and the ${count} added file${count > 1 ? 's' : ''} will be removed` : '')
            + '. The original file is kept: "Restore the original data" brings it back.',
        'Replace')
        .then(confirmed => {
            if (!confirmed) return
            showMessage(d, `Replacing the original data with ${chosen.file.name}…`, 'loading')
            setBusy(d, true)
            return request('POST', `datasets/${d.id}/base?name=${encodeURIComponent(chosen.file.name)}`, chosen.text)
                .then(result => {
                    setBusy(d, false)
                    if (result.errors) return showMessage(d, result.errors.join(' '), 'error')
                    delete pending[d.id]
                    cardOf(d).select('input[type="file"]').property('value', '')
                    showMessage(d, `${chosen.file.name} now replaces the original data: ${formatNumber(result.summary.current.rows)} rows, `
                        + `${formatYears(result.summary.current.years)}. Reload the visualizations to see the new data.`, 'success')
                    return loadDatasets()
                })
        })
        .catch(error => {
            setBusy(d, false)
            showMessage(d, `The original data cannot be replaced: ${error.message}`, 'error')
        })
}

function cancel(d) {
    delete pending[d.id]
    cardOf(d).select('input[type="file"]').property('value', '')
    showMessage(d, '')
    drawPreview(cardOf(d), d)
}

function removeFile(d, file) {
    confirmAction('Remove this file?',
        `${file.name} will be removed from the data and its rows will no longer be shown. This cannot be undone.`,
        'Remove the file')
        .then(confirmed => {
            if (!confirmed) return
            showMessage(d, `Removing ${file.name}…`, 'loading')
            setBusy(d, true)
            return request('DELETE', `datasets/${d.id}/additions/${encodeURIComponent(file.file)}`)
                .then(result => {
                    setBusy(d, false)
                    showMessage(d, `${file.name} removed: the data now has ${formatNumber(result.summary.current.rows)} rows.`, 'success')
                    return loadDatasets()
                })
        })
        .catch(error => {
            setBusy(d, false)
            showMessage(d, `The file cannot be removed: ${error.message}`, 'error')
        })
}

function restore(d) {
    let count = d.summary.additions.length,
        removed = []
    if (d.summary.original.replacement) removed.push(`the replacement file ${d.summary.original.name}`)
    if (count) removed.push(`the ${count} added file${count > 1 ? 's' : ''}`)
    confirmAction('Restore the original data?',
        `${removed.join(' and ').replace(/^t/, 'T')} will be removed. The original file is not modified. This cannot be undone.`,
        'Restore')
        .then(confirmed => {
            if (!confirmed) return
            showMessage(d, 'Restoring the original data…', 'loading')
            setBusy(d, true)
            return request('POST', `datasets/${d.id}/reset`)
                .then(result => {
                    setBusy(d, false)
                    showMessage(d, `Original data restored: ${formatNumber(result.summary.current.rows)} rows.`, 'success')
                    return loadDatasets()
                })
        })
        .catch(error => {
            setBusy(d, false)
            showMessage(d, `The data cannot be restored: ${error.message}`, 'error')
        })
}

loadDatasets()
