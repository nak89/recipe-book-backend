import 'dotenv/config'
import express from 'express'
import type { Request, Response } from 'express'
import cors from 'cors'
import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const app = express()
const PORT = 3000

app.use(cors())
app.use(express.json())

interface IngredientInput {
  name: string
  quantity: number
  unit: string
}

interface StepInput {
  stepNumber: number
  instruction: string
}

interface RecipeInput {
  title: string
  description?: string
  photoUrl?: string
  difficulty: string
  totalMinutes: number
  servings: number
  tools: string[]
  ingredients: IngredientInput[]
  steps: StepInput[]
}

app.get('/', (req: Request, res: Response) => {
  res.send('Recipe Book API is running')
})

app.get('/recipes', async (req: Request, res: Response) => {
  const recipes = await prisma.recipe.findMany({
    include: { ingredients: true, steps: true },
  })
  res.json(recipes)
})

app.get('/recipes/:id', async (req: Request<{ id: string }>, res: Response) => {
  const recipe = await prisma.recipe.findUnique({
    where: { id: req.params.id },
    include: { ingredients: true, steps: true },
  })
  if (!recipe) {
    return res.status(404).json({ error: 'Recipe not found' })
  }
  res.json(recipe)
})

app.post('/recipes', async (req: Request<{}, {}, RecipeInput>, res: Response) => {
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

app.put('/recipes/:id', async (req: Request<{ id: string }, {}, RecipeInput>, res: Response) => {
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
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return res.status(404).json({ error: 'Recipe not found' })
    }
    console.error(err)
    res.status(500).json({ error: 'Failed to update recipe' })
  }
})

app.delete('/recipes/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    await prisma.recipe.delete({ where: { id: req.params.id } })
    res.status(204).send()
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return res.status(404).json({ error: 'Recipe not found' })
    }
    console.error(err)
    res.status(500).json({ error: 'Failed to delete recipe' })
  }
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})