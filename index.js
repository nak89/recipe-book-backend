import 'dotenv/config'
import express from 'express'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import cors from 'cors'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const app = express()
const PORT = 3000

app.use(cors())
app.use(express.json())

app.get('/', (req, res) => {
  res.send('Recipe Book API is running')
})

app.get('/recipes', async (req, res) => {
  const recipes = await prisma.recipe.findMany({
    include: { ingredients: true, steps: true },
  })
  res.json(recipes)
})

app.get('/recipes/:id', async (req, res) => {
  const recipe = await prisma.recipe.findUnique({
    where: { id: req.params.id },
    include: { ingredients: true, steps: true },
  })
  if (!recipe) {
    return res.status(404).json({ error: 'Recipe not found' })
  }
  res.json(recipe)
})

app.post('/recipes', async (req, res) => {
  const { title, description, photoUrl, difficulty, totalMinutes, servings, ingredients, tools, steps } = req.body
  try {
    const newRecipe = await prisma.recipe.create({
      data: {
        title,
        description,
        photoUrl,
        difficulty,
        totalMinutes,
        servings,
        tools,
        ingredients: { create: ingredients },
        steps: { create: steps },
      },
      include: { ingredients: true, steps: true },
    })
    res.status(201).json(newRecipe)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to create recipe' })
  }
})

app.put('/recipes/:id', async (req, res) => {
  const { title, description, photoUrl, difficulty, totalMinutes, servings, ingredients, tools, steps } = req.body
  try {
    const updatedRecipe = await prisma.recipe.update({
      where: { id: req.params.id },
      data: {
        title,
        description,
        photoUrl,
        difficulty,
        totalMinutes,
        servings,
        tools,
        ingredients: {
          deleteMany: {},
          create: ingredients,
        },
        steps: {
          deleteMany: {},
          create: steps,
        },
      },
      include: { ingredients: true, steps: true },
    })
    res.json(updatedRecipe)
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Recipe not found' })
    }
    console.error(err)
    res.status(500).json({ error: 'Failed to update recipe' })
  }
})

app.delete('/recipes/:id', async (req, res) => {
  try {
    await prisma.recipe.delete({ where: { id: req.params.id } })
    res.status(204).send()
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Recipe not found' })
    }
    console.error(err)
    res.status(500).json({ error: 'Failed to delete recipe' })
  }
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
