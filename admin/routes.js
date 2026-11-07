// The admin console: its page and the requests it sends to the server
//
//   GET    <adminPath>/                                  the page of the console (folder admin/page)
//   GET    <adminPath>/api/datasets                      the state of every dataset
//   POST   <adminPath>/api/datasets/:id/preview          check a csv file (body: the text of the file)
//   POST   <adminPath>/api/datasets/:id/additions?name=  add a csv file (body: the text of the file)
//   DELETE <adminPath>/api/datasets/:id/additions/:file  remove an added file
//   POST   <adminPath>/api/datasets/:id/reset            remove all the added files

const express = require('express')
const path = require('path')
const datasets = require('./datasets')
const store = require('./store')

// what the page needs to know about a dataset, with its current state
const view = (dataset, summary) => ({
    id: dataset.id,
    label: dataset.label,
    key: dataset.key,
    required: dataset.required,
    usedBy: dataset.usedBy || [],
    afterChangeSteps: (dataset.afterChange || []).map(step => step.label),
    summary
})

module.exports = function (app, adminPath) {
    // the page of the console: it is not linked from the other pages
    app.use(adminPath, express.static(path.join(__dirname, 'page')))

    let api = express.Router()

    // the csv files are sent as text
    api.use(express.text({ type: () => true, limit: '50mb' }))

    // the dataset named in the address, or an error
    api.param('id', (req, res, next, id) => {
        req.dataset = datasets.find(dataset => dataset.id === id)
        if (!req.dataset) return res.status(404).json({ error: `Unknown dataset: ${id}` })
        next()
    })

    // an error of the server is sent to the page instead of stopping the server
    let handle = action => (req, res) => action(req, res)
        .catch(error => res.status(500).json({ error: error.message }))

    api.get('/datasets', handle(async (req, res) => {
        let list = []
        for (let dataset of datasets) list.push(view(dataset, await store.state(dataset)))
        res.json(list)
    }))

    api.post('/datasets/:id/preview', handle(async (req, res) => {
        res.json(await store.check(req.dataset, req.body || ''))
    }))

    api.post('/datasets/:id/additions', handle(async (req, res) => {
        let { result, summary } = await store.add(req.dataset, req.query.name, req.body || '')
        if (!result.ok) return res.status(400).json(result)
        res.json(view(req.dataset, summary))
    }))

    api.delete('/datasets/:id/additions/:file', handle(async (req, res) => {
        let summary = await store.remove(req.dataset, req.params.file)
        if (!summary) return res.status(404).json({ error: 'Unknown file.' })
        res.json(view(req.dataset, summary))
    }))

    api.post('/datasets/:id/reset', handle(async (req, res) => {
        res.json(view(req.dataset, await store.reset(req.dataset)))
    }))

    app.use(adminPath + '/api', api)

    // the current file of every dataset is built when the server starts, if it does not exist yet
    datasets.forEach(dataset => store.state(dataset)
        .catch(error => console.error(`Dataset ${dataset.id}: ${error.message}`)))
}
