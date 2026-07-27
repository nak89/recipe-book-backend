//Main backend file handles all the REST API logic 

import 'dotenv/config'
import express from 'express'
import type { Request, Response } from 'express'
import cors from 'cors'
import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import authRoutes from './routes/auth.js'
import { requireAuth } from './middleware/auth.js'
import uploadRoutes from './routes/upload.js'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const app = express()
const PORT = 3000

app.use(cors())
app.use(express.json())
app.use('/auth', authRoutes) //using the auth routes before allowing user to hit endpoint

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
  cuisine?: string 
  mealtime?: string 
  isFavourite?: boolean 
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  tools: string[]
  ingredients: IngredientInput[]
  steps: StepInput[]
}
// Every recipe must carry a photo — the mobile app's card and carousel layouts
// are photo-first and have no designed state for a missing image. The form
// blocks first; this is the backstop for anything that bypasses it.
function missingPhotoUrl(body: RecipeInput) {
  return typeof body.photoUrl !== 'string' || body.photoUrl.trim() === ''
}

//home endpoint
app.get('/', (req: Request, res: Response) => {
  res.send('Recipe Book API is running')
})


app.get('/recipes', requireAuth, async (req: Request, res: Response) => {
  const recipes = await prisma.recipe.findMany({
    where: { userId: req.userId },
    include: { ingredients: true, steps: true },
  })
  res.json(recipes)
})

app.get('/recipes/:id', requireAuth, async (req: Request<{ id: string }>, res: Response) => {
  const recipe = await prisma.recipe.findUnique({
    where: { id: req.params.id },
    include: { ingredients: true, steps: true },
  })
  if (!recipe || recipe.userId !== req.userId) {
    return res.status(404).json({ error: 'Recipe not found' })
  }
  res.json(recipe)
})

app.post('/recipes', requireAuth, async (req: Request<{}, {}, RecipeInput>, res: Response) => {
  //destructuring the body
  const {
  title, description, photoUrl, difficulty, totalMinutes, servings,
  cuisine, mealtime, isFavourite, calories, protein, carbs, fat,
  ingredients, tools, steps
  } = req.body
  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' })
  }
  if (missingPhotoUrl(req.body)) {
    return res.status(400).json({ error: 'A photo is required' })
  }
  const existing = await prisma.recipe.findFirst({
    where: {
      userId: req.userId, 
      title: {
        equals: title.trim(),
        mode: 'insensitive',
      },
    },
  })
  if (existing) return res.status(409).json({error: `You already have a recipe titled "${existing.title}"`})

  try {
    //create new recipe
    const newRecipe = await prisma.recipe.create({
      data: {
        title,
        description,
        photoUrl,
        difficulty,
        totalMinutes,
        servings,
        cuisine,
        mealtime,
        isFavourite,
        calories,
        protein,
        carbs,
        fat,
        tools,
        userId: req.userId as string,
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

app.put('/recipes/:id', requireAuth, async (req: Request<{ id: string }, {}, RecipeInput>, res: Response) => {
  const {
    title, description, photoUrl, difficulty, totalMinutes, servings,
    cuisine, mealtime, isFavourite, calories, protein, carbs, fat,
    ingredients, tools, steps
  } = req.body

  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' })
  }
  if (missingPhotoUrl(req.body)) {
    return res.status(400).json({ error: 'A photo is required' })
  }

  try {
    const updatedRecipe = await prisma.$transaction(async (tx) => {
      // Step 1: delete existing ingredients and steps
      await tx.ingredient.deleteMany({ where: { recipeId: req.params.id } })
      await tx.step.deleteMany({ where: { recipeId: req.params.id } })

      // Step 2: update the recipe fields and create fresh ingredients/steps
      return tx.recipe.update({
        where: { id: req.params.id, userId: req.userId },
        data: {
          title,
          description,
          photoUrl,
          difficulty,
          totalMinutes,
          servings,
          cuisine,
          mealtime,
          isFavourite,
          calories,
          protein,
          carbs,
          fat,
          tools,
          ingredients: { create: ingredients },
          steps: { create: steps },
        },
        include: { ingredients: true, steps: true },
      })
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

app.delete('/recipes/:id', requireAuth, async (req: Request<{ id: string }>, res: Response) => {
  try {
    await prisma.recipe.delete({ where: { id: req.params.id, userId: req.userId } })
    res.status(204).send()
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return res.status(404).json({ error: 'Recipe not found' })
    }
    console.error(err)
    res.status(500).json({ error: 'Failed to delete recipe' })
  }
})

app.patch('/recipes/:id/favourite', requireAuth, async (req: Request<{ id: string }>, res: Response) => {
  const { isFavourite } = req.body
  try {
    const updatedRecipe = await prisma.recipe.update({
      where: { id: req.params.id, userId: req.userId },
      data: { isFavourite },
      include: { ingredients: true, steps: true },
    })
    res.json(updatedRecipe)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return res.status(404).json({ error: 'Recipe not found' })
    }
    console.error(err)
    res.status(500).json({ error: 'Failed to update favourite' })
  }
})

app.use('/upload', uploadRoutes)

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})