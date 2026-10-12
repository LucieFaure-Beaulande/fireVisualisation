
const express = require('express')
const path = require('path')
const app = express()
const port = Number(process.env.PORT) || 3000

// Cette ligne indique le répertoire qui contient
// les fichiers statiques: html, css, js, images etc.
app.use(express.static(path.join(__dirname, 'public')))

// La librairie d3 installée par npm est servie sous /lib (ex: /lib/d3.min.js)
app.use('/lib', express.static(path.join(__dirname, 'node_modules', 'd3', 'dist')))

// Le GeoJSON est fourni au navigateur sans rendre le tableur des casernes public.
app.get('/data/districts.geojson', (req, res) => {
  res.sendFile(path.join(__dirname, 'data', 'Congressional_Districts.geojson'))
})

const server = app.listen(port, () => {
  console.log(`app listening at http://localhost:${port}`)
})

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Le port ${port} est déjà utilisé. Fermez le serveur existant ou choisissez un autre port, par exemple : $env:PORT=3001; npm start`)
  } else {
    console.error(error)
  }

  process.exitCode = 1
})
