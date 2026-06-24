import express from 'express'
import { recipes } from './data.js'

const app = express()
const PORT = 3000

app.use(express.json())

app.post('/recipes', (req,res) => {
    const newRecipe = {
        id: crypto.randomUUID(),
        ...req.body,
    }
    recipes.push(newRecipe)
    res.status(201).json(newRecipe)
})

app.put('/recipes/:id', (req, res) => {
    const index = recipes.findIndex((r) => r.id === req.params.id)
    if (index === -1) {
        return res.status(404).json({ error: 'Recipe not found '})
    }
    recipes[index] = {...recipes[index], ...req.body, id: req.params.id}
    res.json(recipes[index])
})

app.delete('/recipes/:id', (req,res) => {
    const index = recipes.findIndex((r) => r.id === req.params.id)
    if (index === -1) {
        return res.status(404).json({ error: 'Recipe not found' })
    }
    recipes.splice(index, 1)
    res.status(204).send()
})

app.get('/', (req, res) => {
    res.send('Recipe Book API is running')
})

app.get('/recipes', (req, res) => {
    res.json(recipes)
})

app.get('/recipes/:id', (req,res) => {
    const recipe = recipes.find((r) => r.id === req.params.id)
    if (!recipe) {
        return res.status(404).json({ error: 'Recipe not found'})
    }
    res.json(recipe)
})

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
})