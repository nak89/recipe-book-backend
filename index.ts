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
import {
  createRecipeSchema,
  updateRecipeSchema,
  favouriteSchema,
  importSchema,
  planRangeSchema,
  planSlotParamsSchema,
  planSlotSchema,
  formatZodError,
} from './validation.js'
import { packSummaries, recipesForPacks } from './data/starterPacks.js'
import { foldForCompare } from './lib/text.js'

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
app.use('/starter-packs', apiLimiter)
app.use('/meal-plan', apiLimiter)

// Metadata for onboarding's pack picker. Deliberately does not include the
// recipe bodies: the client only ever sends ids back, so shipping fifteen full
// recipes to a screen shown once would be dead weight.
app.get('/starter-packs', requireAuth, (req: Request, res: Response) => {
  res.json(packSummaries())
})

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
    // Prisma's `mode: 'insensitive'` compares inside the database, so a JS fold
    // can't be pushed into it — and case-insensitivity alone doesn't see through
    // the invisible zero-width spaces Khmer keyboards emit at word boundaries,
    // which let two identical-looking titles both save. Fetch this user's titles
    // and compare folded, in JS; that's the same shape /recipes/import already
    // uses. Costs a narrow scan per save instead of one indexed lookup, which is
    // fine at personal-recipe-book scale and is the only way the check can see
    // past an invisible character.
    const wanted = foldForCompare(recipe.title)
    const titles = await prisma.recipe.findMany({
      where: { userId: req.userId },
      select: { id: true, title: true },
    })
    const existing = titles.find((r) => foldForCompare(r.title) === wanted)
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
    // Same per-user title rule as POST — including the fold, see the note there —
    // minus this recipe itself, or saving an edit without touching the title
    // would collide with its own row.
    const wanted = foldForCompare(recipe.title)
    const titles = await prisma.recipe.findMany({
      where: { userId: req.userId, NOT: { id: req.params.id } },
      select: { id: true, title: true },
    })
    const duplicate = titles.find((r) => foldForCompare(r.title) === wanted)
    if (duplicate) {
      return res.status(409).json({ error: `You already have a recipe titled "${duplicate.title}"` })
    }

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

/**
 * Bulk-creates the recipes in the chosen starter packs. Onboarding only.
 *
 * A title the user already has is **skipped, not rejected**. The onboarding gate
 * re-runs whenever `onboardedAt` is unset, so someone who imports and then
 * force-quits before finishing comes back to the picker with every one of those
 * titles already in their library — 409ing there would strand them on a screen
 * naming recipes they never saw. Re-importing is a no-op instead.
 *
 * One transaction, not N creates: a half-finished import would leave a library
 * the user didn't choose and no clean way to retry.
 */
app.post('/recipes/import', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const parsed = importSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json(formatZodError(parsed.error))
  }

  try {
    const candidates = recipesForPacks(parsed.data.packIds)
    const existing = await prisma.recipe.findMany({
      where: { userId: req.userId },
      select: { title: true },
    })
    // Folded, matching the uniqueness rule POST /recipes enforces — otherwise
    // "carbonara" would slip past here and then be rejected the next time the
    // user edited it. Same helper on both sides, so the two rules can't drift.
    const taken = new Set(existing.map((r) => foldForCompare(r.title)))
    const fresh = candidates.filter((r) => !taken.has(foldForCompare(r.title)))

    if (fresh.length > 0) {
      // Three statements, not three per recipe. The obvious shape here is a
      // nested `create` per recipe, but fifteen of those is ~45 round-trips and
      // reliably overran Prisma's 5s transaction timeout against a hosted
      // database. Raising the timeout would only hold the transaction open
      // longer; batching removes the work instead.
      await prisma.$transaction(async (tx) => {
        const created = await tx.recipe.createManyAndReturn({
          data: fresh.map(({ ingredients, steps, ...recipe }) => ({
            ...recipe,
            userId: req.userId as string,
          })),
          select: { id: true, title: true },
        })
        // Titles are unique per user and we just filtered out every collision,
        // so they're a safe key back to the generated ids.
        const idByTitle = new Map(created.map((r) => [r.title, r.id]))

        await tx.ingredient.createMany({
          data: fresh.flatMap((recipe) =>
            recipe.ingredients.map(([name, quantity, unit]) => ({
              recipeId: idByTitle.get(recipe.title) as string,
              name,
              quantity,
              unit,
            }))
          ),
        })

        await tx.step.createMany({
          data: fresh.flatMap((recipe) =>
            recipe.steps.map((instruction, index) => ({
              recipeId: idByTitle.get(recipe.title) as string,
              stepNumber: index + 1,
              instruction,
            }))
          ),
        })
      })
    }

    // Zero imported is a success, not an error — see the re-import case above.
    res.json({ imported: fresh.length, skipped: candidates.length - fresh.length })
  } catch (err) {
    next(err)
  }
})

/**
 * The meal planner. Three routes over one table, and the table is a set of
 * slots: (date, mealtime) addresses exactly one recipe for one account.
 *
 * That shape is why there is no POST. A slot always exists conceptually —
 * Tuesday has a dinner whether or not you've chosen it — so filling one is an
 * idempotent PUT to a known address, not the creation of a new resource. Two
 * taps on the same slot leave one row, which is what the `@@unique` enforces
 * and what makes the app's optimistic writes safe to retry.
 *
 * `date` is handled as a plain `YYYY-MM-DD` string end to end and only becomes
 * a `Date` at the Prisma boundary, pinned to UTC midnight. The column is a
 * postgres DATE with no time or zone, so any other instant would be re-read as
 * a different day somewhere in the world.
 */

/** The `YYYY-MM-DD` a DATE column round-trips to, without a timezone in sight. */
function toDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`)
}

function fromDateOnly(value: Date) {
  return value.toISOString().slice(0, 10)
}

// The planner renders a row per slot: a photo, a title and the two meta values.
// It deliberately doesn't `include` the whole recipe — ingredients and steps are
// dead weight on a screen that shows neither, and a full week of them would be
// the largest response the API sends.
const plannerRecipeSelect = {
  id: true,
  title: true,
  photoUrl: true,
  totalMinutes: true,
  servings: true,
  mealtime: true,
} as const

app.get('/meal-plan', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const parsed = planRangeSchema.safeParse(req.query)
  if (!parsed.success) {
    return res.status(400).json(formatZodError(parsed.error))
  }
  try {
    const slots = await prisma.mealPlan.findMany({
      where: {
        userId: req.userId,
        date: { gte: toDateOnly(parsed.data.from), lte: toDateOnly(parsed.data.to) },
      },
      select: {
        id: true,
        date: true,
        mealtime: true,
        recipeId: true,
        recipe: { select: plannerRecipeSelect },
      },
      orderBy: [{ date: 'asc' }, { mealtime: 'asc' }],
    })
    res.json(slots.map((slot) => ({ ...slot, date: fromDateOnly(slot.date) })))
  } catch (err) {
    next(err)
  }
})

app.put(
  '/meal-plan/:date/:mealtime',
  requireAuth,
  async (req: Request<{ date: string; mealtime: string }>, res: Response, next: NextFunction) => {
    const slot = planSlotParamsSchema.safeParse(req.params)
    if (!slot.success) {
      return res.status(400).json(formatZodError(slot.error))
    }
    const body = planSlotSchema.safeParse(req.body)
    if (!body.success) {
      return res.status(400).json(formatZodError(body.error))
    }
    try {
      // Check the recipe is *this user's* before writing. The FK only proves the
      // recipe exists; without this an account could plan a stranger's recipe by
      // id and then read its title and photo straight back out of GET.
      const recipe = await prisma.recipe.findFirst({
        where: { id: body.data.recipeId, userId: req.userId },
        select: { id: true },
      })
      if (!recipe) {
        return res.status(404).json({ error: 'Recipe not found' })
      }
      const date = toDateOnly(slot.data.date)
      const saved = await prisma.mealPlan.upsert({
        where: {
          userId_date_mealtime: { userId: req.userId!, date, mealtime: slot.data.mealtime },
        },
        create: {
          userId: req.userId!,
          date,
          mealtime: slot.data.mealtime,
          recipeId: body.data.recipeId,
        },
        update: { recipeId: body.data.recipeId },
        select: {
          id: true,
          date: true,
          mealtime: true,
          recipeId: true,
          recipe: { select: plannerRecipeSelect },
        },
      })
      res.json({ ...saved, date: fromDateOnly(saved.date) })
    } catch (err) {
      next(err)
    }
  }
)

app.delete(
  '/meal-plan/:date/:mealtime',
  requireAuth,
  async (req: Request<{ date: string; mealtime: string }>, res: Response, next: NextFunction) => {
    const slot = planSlotParamsSchema.safeParse(req.params)
    if (!slot.success) {
      return res.status(400).json(formatZodError(slot.error))
    }
    try {
      await prisma.mealPlan.delete({
        where: {
          userId_date_mealtime: {
            userId: req.userId!,
            date: toDateOnly(slot.data.date),
            mealtime: slot.data.mealtime,
          },
        },
      })
      res.status(204).send()
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return res.status(404).json({ error: 'Nothing planned in that slot' })
      }
      next(err)
    }
  }
)

app.use('/upload', uploadLimiter, uploadRoutes)

app.use(notFoundHandler)
app.use(errorHandler)

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
