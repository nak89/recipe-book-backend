import express from 'express'
import { recipes } from './data.js'

const app = express()
const PORT = 3000

app.get('/', (req, res) => {
    res.send('Recipe Book API is running')
})

app.get('/recipes', (req, res) => {
    res.json(recipes)
})

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
})