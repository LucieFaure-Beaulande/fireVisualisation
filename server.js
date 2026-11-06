
const express = require('express')
const path = require('path')
const app = express()
const port = Number(process.env.PORT) || 3000 // another port with: PORT=3001 npm start

// Cette ligne indique le répertoire qui contient
// les fichiers statiques: html, css, js, images etc.
app.use(express.static(path.join(__dirname, 'public')))

// La librairie d3 installée par npm est servie sous /lib (ex: /lib/d3.min.js)
app.use('/lib', express.static(path.join(__dirname, 'node_modules', 'd3', 'dist')))

// La console d'administration des données (dossier admin/), à une adresse qui n'est affichée dans aucune page
const adminPath = process.env.ADMIN_PATH || '/admin'
require('./admin/routes')(app, adminPath)

app.listen(port, () => {
  console.log(`app listening at http://localhost:${port}`)
  console.log(`admin console at http://localhost:${port}${adminPath}/`)
})
