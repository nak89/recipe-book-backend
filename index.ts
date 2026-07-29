//Main backend file handles all the REST API logic

import 'dotenv/config'
import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import authRoutes from './routes/auth.js'
import { requireAuth } from './middleware/auth.js'
import uploadRoutes from './routes/upload.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { apiLimiter, authLimiter, uploadLimiter } from './rateLimits.js'
import { createRecipeSchema, updateRecipeSchema, favouriteSchema, formatZodError } from './validation.js'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const app = express()
const PORT = Number(process.env.PORT ?? 3000)

// Behind a proxy/load balancer, req.ip is the proxy unless we say how many hops
// to trust — and every client then shares one rate-limit bucket. Set
// TRUST_PROXY to the hop count when deploying. Left off by default: trusting
// X-Forwarded-For unconditionally lets a client spoof its own IP and walk
// straight past the limiters.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY))
}

app.use(helmet())

// An explicit allowlist rather than the wide-open default. Requests with no
// Origin (the native app, curl, server-to-server) are passed through — CORS is
// a browser mechanism and there's no browser to protect there. A disallowed
// browser origin simply doesn't get the header back, so the browser blocks it.
const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:8081,http://localhost:19006')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true)
      callback(null, allowedOrigins.includes(origin))
    },
  })
)

app.use(express.json({ limit: '100kb' }))
app.use('/auth', authLimiter, authRoutes) //using the auth routes before allowing user to hit endpoint

//home endpoint
app.get('/', (req: Request, res: Response) => {
  res.send('Recipe Book API is running')
})

// Rate limit before requireAuth, not after: requireAuth makes a live
// supabase.auth.getUser() call, so an unauthenticated flood would otherwise
// turn into one outbound Supabase request per junk token.
app.use('/recipes', apiLimiter)

app.get('/recipes', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const recipes = await prisma.recipe.findMany({
      where: { userId: req.userId },
      include: {
        ingredients: true,
        // Postgres gives no row order without ORDER BY, and PUT deletes and
        // recreates these rows on every save — so ordering can't be left to
        // whatever the heap happens to return.
        steps: { orderBy: { stepNumber: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    })
    res.json(recipes)
  } catch (err) {
    next(err)
  }
})

app.get('/recipes/:id', requireAuth, async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    const recipe = await prisma.recipe.findUnique({
      where: { id: req.params.id },
      include: { ingredients: true, steps: { orderBy: { stepNumber: 'asc' } } },
    })
    // Same 404 whether it doesn't exist or isn't yours — a distinct 403 would
    // confirm the id is real.
    if (!recipe || recipe.userId !== req.userId) {
      return res.status(404).json({ error: 'Recipe not found' })
    }
    res.json(recipe)
  } catch (err) {
    next(err)
  }
})

app.post('/recipes', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const parsed = createRecipeSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json(formatZodError(parsed.error))
  }
  // Use the parsed value, never req.body — zod has stripped unknown keys, so
  // nothing extra can reach Prisma.
  const { ingredients, steps, ...recipe } = parsed.data

  try {
    const existing = await prisma.recipe.findFirst({
      where: {
        userId: req.userId,
        title: { equals: recipe.title, mode: 'insensitive' },
      },
    })
    if (existing) {
      return res.status(409).json({ error: `You already have a recipe titled "${existing.title}"` })
    }

    //create new recipe
    const newRecipe = await prisma.recipe.create({
      data: {
        ...recipe,
        userId: req.userId as string,
        ingredients: { create: ingredients },
        steps: { create: steps },
      },
      include: { ingredients: true, steps: { orderBy: { stepNumber: 'asc' } } },
    })
    res.status(201).json(newRecipe)
  } catch (err) {
    next(err)
  }
})

app.put('/recipes/:id', requireAuth, async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  const parsed = updateRecipeSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json(formatZodError(parsed.error))
  }
  const { ingredients, steps, ...recipe } = parsed.data

  try {
    // One nested write instead of a manual $transaction. Prisma runs it
    // atomically, `deleteMany: {}` is scoped to this recipe's own children, and
    // the where — including userId — is evaluated *before* anything is deleted.
    // The previous version deleted by recipeId with no ownership filter and was
    // safe only because the later update threw and rolled the transaction back.
    const updatedRecipe = await prisma.recipe.update({
      where: { id: req.params.id, userId: req.userId },
      data: {
        ...recipe,
        ingredients: { deleteMany: {}, create: ingredients },
        steps: { deleteMany: {}, create: steps },
      },
      include: { ingredients: true, steps: { orderBy: { stepNumber: 'asc' } } },
    })

    res.json(updatedRecipe)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return res.status(404).json({ error: 'Recipe not found' })
    }
    next(err)
  }
})

app.delete('/recipes/:id', requireAuth, async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    await prisma.recipe.delete({ where: { id: req.params.id, userId: req.userId } })
    res.status(204).send()
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return res.status(404).json({ error: 'Recipe not found' })
    }
    next(err)
  }
})

app.patch('/recipes/:id/favourite', requireAuth, async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  const parsed = favouriteSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json(formatZodError(parsed.error))
  }
  try {
    const updatedRecipe = await prisma.recipe.update({
      where: { id: req.params.id, userId: req.userId },
      data: { isFavourite: parsed.data.isFavourite },
      include: { ingredients: true, steps: { orderBy: { stepNumber: 'asc' } } },
    })
    res.json(updatedRecipe)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return res.status(404).json({ error: 'Recipe not found' })
    }
    next(err)
  }
})

app.use('/upload', uploadLimiter, uploadRoutes)

app.use(notFoundHandler)
app.use(errorHandler)

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
