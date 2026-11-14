//Main backend file handles all the REST API logic

import 'dotenv/config'
import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { Prisma } from '@prisma/client'
import { prisma } from './lib/database.js'
import authRoutes from './routes/auth.js'
import { requireAuth } from './middleware/auth.js'
import uploadRoutes from './routes/upload.js'
import photoRoutes from './routes/photos.js'
import recipeDraftRoutes from './routes/recipeDrafts.js'
import { HttpError } from './httpError.js'
import { ownedPhotoPath } from './lib/photoPaths.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { apiLimiter, authLimiter, uploadLimiter } from './rateLimits.js'
import {
  createRecipeSchema,
  updateRecipeSchema,
  favouriteSchema,
  importSchema,
  planRangeSchema,
  planResetSchema,
  planSlotParamsSchema,
  planSlotSchema,
  dinnerWeekSchema,
  mealWeekSchema,
  groceryRangeSchema,
  groceryLineSchema,
  groceryItemSchema,
  groceryItemPatchSchema,
  MAX_GROCERY_ITEMS_PER_WEEK,
  formatZodError,
} from './validation.js'
import { packSummaries, recipesForPacks } from './data/starterPacks.js'
import { LIBRARY, librarySummaries, libraryRecipe, libraryDetail, type LibraryRecipe } from './data/library.js'
import { explorePublicOrigin, localRecipePreviews, recipeImageDirectory, storeLibraryPhoto } from './data/localRecipePreviews.js'
import { dailyExplore } from './data/exploreRotation.js'
import localExploreSchedule from './data/exploreSchedule.json'
import { foldForCompare } from './lib/text.js'
import { aggregateIngredients, roundAmount } from './lib/grocery.js'

const app = express()
const PORT = Number(process.env.PORT ?? 3000)
const exploreRecipes = [...LIBRARY, ...localRecipePreviews]

async function readExploreCatalogue() {
  if (!explorePublicOrigin) return { recipes: exploreRecipes, schedule: localExploreSchedule }
  const catalogue = await prisma.exploreCatalogue.findUnique({ where: { id: 'active' } })
  if (!catalogue) throw new HttpError(503, 'Explore catalogue has not been published')
  return {
    recipes: catalogue.recipes as unknown as LibraryRecipe[],
    schedule: catalogue.schedule as string[][],
  }
}

// Behind a proxy/load balancer, req.ip is the proxy unless we say how many hops
// to trust — and every client then shares one rate-limit bucket. Set
// TRUST_PROXY to the hop count when deploying. Left off by default: trusting
// X-Forwarded-For unconditionally lets a client spoof its own IP and walk
// straight past the limiters.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY))
}

app.use(helmet())

if (recipeImageDirectory) {
  app.use('/local-recipe-images', express.static(recipeImageDirectory, {
    setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
  }))
}

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

app.use(express.json({ limit: '100kb', inflate: false }))
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
app.use('/library', apiLimiter)
app.use('/meal-plan', apiLimiter)
app.use('/grocery', apiLimiter)
app.use('/photos', apiLimiter, requireAuth, photoRoutes)
app.use('/recipe-drafts', apiLimiter, requireAuth, recipeDraftRoutes)

// Metadata for onboarding's pack picker. Deliberately does not include the
// recipe bodies: the client only ever sends ids back, so shipping fifteen full
// recipes to a screen shown once would be dead weight.
app.get('/starter-packs', requireAuth, (req: Request, res: Response) => {
  res.json(packSummaries())
})

// The public catalogue exposes shared recipes only. The signed-in feed below
// adds the caller's saved state, and copying remains a signed-in action.
app.get('/library/catalogue', async (_req, res, next) => {
  try {
    const { recipes, schedule } = await readExploreCatalogue()
    res.json({ recipes: librarySummaries(recipes), ...dailyExplore(recipes, schedule) })
  } catch (err) {
    next(err)
  }
})

app.get('/library/catalogue/:id', async (req, res, next) => {
  try {
    const { recipes } = await readExploreCatalogue()
    const recipe = libraryDetail(req.params.id, recipes)
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' })
    res.json(recipe)
  } catch (err) {
    next(err)
  }
})

app.get('/library', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Keep saved dishes in the daily selection and search results.
    const [{ recipes, schedule }, copied] = await Promise.all([readExploreCatalogue(), prisma.recipe.findMany({
      where: { userId: req.userId, libraryId: { not: null } },
      select: { libraryId: true },
    })])
    res.setHeader('Cache-Control', 'private, no-store')
    res.json({
      recipes: librarySummaries(recipes),
      ...dailyExplore(recipes, schedule),
      savedIds: copied.map((r) => r.libraryId as string),
    })
  } catch (err) {
    next(err)
  }
})

/**
 * Copies the original starter set in one request — onboarding's "Begin with eight
 * classics" (SCREENS.md § 5).
 *
 * Batched into three statements like `/recipes/import`, and for the same reason:
 * the obvious nested-`create`-per-recipe shape is ~24 round-trips here and the
 * starter-pack version of it reliably overran Prisma's 5s transaction timeout
 * against a hosted database.
 *
 * Skips what the account already holds — by `libraryId` for anything copied
 * before, and by folded title for anything the user wrote themselves under the
 * same name. Returning `{ imported, skipped }` rather than 409-ing on the first
 * collision is deliberate: re-running this is an ordinary path (quit halfway
 * through onboarding, come back), not an edge case.
 *
 * It is mounted above `/library/:id` because Express matches in order and
 * `import` would otherwise be read as an id.
 */
app.post('/library/import', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const owned = await prisma.recipe.findMany({
      where: { userId: req.userId },
      select: { title: true, libraryId: true },
    })
    const takenIds = new Set(owned.map((r) => r.libraryId).filter(Boolean))
    const takenTitles = new Set(owned.map((r) => foldForCompare(r.title)))

    const fresh = LIBRARY.filter((recipe) => {
      if (takenIds.has(recipe.id)) return false
      return !takenTitles.has(foldForCompare(recipe.title))
    })

    if (fresh.length > 0) {
      await prisma.$transaction(async (tx) => {
        const created = await tx.recipe.createManyAndReturn({
          data: fresh.map((recipe) => ({
            title: recipe.title,
            description: recipe.description,
            photoUrl: recipe.photoUrl,
            difficulty: recipe.difficulty,
            totalMinutes: recipe.totalMinutes,
            servings: recipe.servings,
            cuisine: recipe.cuisine,
            mealtime: recipe.mealtime,
            tools: recipe.tools,
            libraryId: recipe.id,
            userId: req.userId as string,
          })),
          select: { id: true, libraryId: true },
        })
        // Keyed back by libraryId rather than by title. The titles are no
        // longer language-dependent, but they are still the user's to rename
        // the moment the copy lands, and an id is the only handle that survives
        // that — which is the same reason the column exists at all.
        const idByLibraryId = new Map(created.map((r) => [r.libraryId as string, r.id]))

        await tx.ingredient.createMany({
          data: fresh.flatMap((recipe) =>
            recipe.ingredients.map(([name, quantity, unit], position) => ({
              recipeId: idByLibraryId.get(recipe.id) as string,
              name,
              quantity,
              unit,
              position,
            }))
          ),
        })

        await tx.step.createMany({
          data: fresh.flatMap((recipe) =>
            recipe.steps.map((instruction, index) => ({
              recipeId: idByLibraryId.get(recipe.id) as string,
              stepNumber: index + 1,
              instruction,
            }))
          ),
        })
      })
    }

    res.json({ imported: fresh.length, skipped: LIBRARY.length - fresh.length })
  } catch (err) {
    next(err)
  }
})

app.get(
  '/library/:id',
  requireAuth,
  async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
    // `libraryDetail`, not `libraryRecipe` — the stored ingredient tuples have
    // to be named before they go over the wire. See the note on that function.
    try {
      const { recipes } = await readExploreCatalogue()
      const recipe = libraryDetail(req.params.id, recipes)
      if (!recipe) return res.status(404).json({ error: 'Recipe not found' })
      // Same question as the list route, for one id. The detail screen's button
      // reads "Copy to my book" or "In your book" off this.
      const existing = await prisma.recipe.findFirst({
        where: { userId: req.userId, libraryId: recipe.id },
        select: { id: true },
      })
      res.json({ ...recipe, savedRecipeId: existing?.id ?? null })
    } catch (err) {
      next(err)
    }
  }
)

/**
 * Copy one library recipe into the caller's own book.
 *
 * **Idempotent on `libraryId`, not on title.** A copy becomes the user's own
 * content the moment it lands, and the first thing they may do is rename it —
 * so a title check would see the renamed row as a different recipe and hand out
 * a second copy. `Recipe.libraryId` plus its `@@unique([userId, libraryId])` is
 * what makes the second tap a no-op. (It was introduced for a sharper version
 * of the same problem: the library used to ship in two languages and a copy
 * stored whichever one you were reading, so the title moved under the check.)
 *
 * Copying an already-copied recipe returns 200 with the existing row rather
 * than 409. Tapping it twice is an ordinary thing to do from a list that shows
 * you what you already have, and the honest answer to "put this in my book" is
 * that it is in your book. Same reading as the import route's skip.
 */
app.post(
  '/library/:id/copy',
  requireAuth,
  async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
    let previewPhoto: Awaited<ReturnType<typeof storeLibraryPhoto>> | undefined

    try {
      const { recipes } = await readExploreCatalogue()
      const recipe = libraryRecipe(req.params.id, recipes)
      if (!recipe) return res.status(404).json({ error: 'Recipe not found' })
      const { title, description } = recipe
      const existing = await prisma.recipe.findFirst({
        where: { userId: req.userId, libraryId: recipe.id },
        include: { ingredients: { orderBy: { position: 'asc' } }, steps: { orderBy: { stepNumber: 'asc' } } },
      })
      if (existing) return res.json(existing)

      // A user who wrote their own "Kroeung" before ever opening Explore still
      // owns that title, and the per-user title rule is what the editor enforces
      // on their next save. Refusing here with the same 409 POST /recipes uses
      // keeps one rule rather than two, and names the row they already have.
      const wanted = foldForCompare(title)
      const titles = await prisma.recipe.findMany({
        where: { userId: req.userId },
        select: { id: true, title: true },
      })
      const clash = titles.find((r) => foldForCompare(r.title) === wanted)
      if (clash) {
        return res.status(409).json({ error: `You already have a recipe titled "${clash.title}"` })
      }

      if (recipe.illustrated) previewPhoto = await storeLibraryPhoto(recipe, req.userId!)
      const created = await prisma.recipe.create({
        data: {
          title,
          description,
          photoUrl: previewPhoto?.url ?? recipe.photoUrl,
          difficulty: recipe.difficulty,
          totalMinutes: recipe.totalMinutes,
          servings: recipe.servings,
          cuisine: recipe.cuisine,
          mealtime: recipe.mealtime,
          tools: recipe.tools,
          libraryId: recipe.id,
          userId: req.userId as string,
          ingredients: {
            create: recipe.ingredients.map(([name, quantity, unit], position) => ({
              name,
              quantity,
              unit,
              position,
            })),
          },
          steps: {
            create: recipe.steps.map((instruction, index) => ({
              stepNumber: index + 1,
              instruction,
            })),
          },
        },
        include: { ingredients: { orderBy: { position: 'asc' } }, steps: { orderBy: { stepNumber: 'asc' } } },
      })
      previewPhoto = undefined
      res.status(201).json(created)
    } catch (err) {
      if (previewPhoto) await previewPhoto.remove().catch(() => undefined)
      next(err)
    }
  }
)

app.get('/recipes', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const recipes = await prisma.recipe.findMany({
      where: { userId: req.userId },
      include: {
        // Postgres gives no row order without ORDER BY, and PUT deletes and
        // recreates both of these on every save — so ordering can't be left to
        // whatever the heap happens to return. Ingredients carried exactly that
        // bug until `position` existed.
        ingredients: { orderBy: { position: 'asc' } },
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
      include: { ingredients: { orderBy: { position: 'asc' } }, steps: { orderBy: { stepNumber: 'asc' } } },
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
    ownedPhotoPath(recipe.photoUrl, req.userId!, process.env.SUPABASE_URL!, process.env.SUPABASE_STORAGE_BUCKET ?? 'recipe-photos')
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
        // `position` comes from the array index, never from the request: the
        // client's job is to send its list in the order it shows it, and
        // anything more than that is a number a client could get wrong.
        ingredients: { create: ingredients.map((i, position) => ({ ...i, position })) },
        steps: { create: steps },
      },
      include: { ingredients: { orderBy: { position: 'asc' } }, steps: { orderBy: { stepNumber: 'asc' } } },
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
    ownedPhotoPath(recipe.photoUrl, req.userId!, process.env.SUPABASE_URL!, process.env.SUPABASE_STORAGE_BUCKET ?? 'recipe-photos')
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
        // Reindexed from the array, like POST — a reordered list arrives as a
        // whole list in its new order, so the positions are simply rewritten
        // along with the rows.
        ingredients: {
          deleteMany: {},
          create: ingredients.map((i, position) => ({ ...i, position })),
        },
        steps: { deleteMany: {}, create: steps },
      },
      include: { ingredients: { orderBy: { position: 'asc' } }, steps: { orderBy: { stepNumber: 'asc' } } },
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
      include: { ingredients: { orderBy: { position: 'asc' } }, steps: { orderBy: { stepNumber: 'asc' } } },
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
            recipe.ingredients.map(([name, quantity, unit], position) => ({
              recipeId: idByTitle.get(recipe.title) as string,
              name,
              quantity,
              unit,
              position,
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

app.delete('/meal-plan', requireAuth, async (req, res, next) => {
  const parsed = planResetSchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error))
  const { from, to } = parsed.data
  try {
    await prisma.mealPlan.deleteMany({
      where: { userId: req.userId!, date: { gte: toDateOnly(from), lte: toDateOnly(to) } },
    })
    res.sendStatus(204)
  } catch (error) {
    next(error)
  }
})

// Must precede the generic date/mealtime route. Repeated identical drafts
// are no-ops; conflicting slots roll back every change in the draft.
app.put(['/meal-plan/week/dinners', '/meal-plan/week/meals'], requireAuth, async (req, res, next) => {
  const parsed = (/\/dinners\/?$/i.test(req.path) ? dinnerWeekSchema : mealWeekSchema).safeParse(req.body)
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error))
  const { weekStart, entries } = parsed.data
  const from = toDateOnly(weekStart)
  const end = new Date(from)
  end.setUTCDate(end.getUTCDate() + 6)
  try {
    const saved = await prisma.$transaction(async tx => {
      const ids = [...new Set(entries.flatMap(entry => entry.recipeId ? [entry.recipeId] : []))]
      const owned = await tx.recipe.count({ where: { userId: req.userId, id: { in: ids } } })
      if (owned !== ids.length) throw new HttpError(404, 'Recipe not found')
      // Compare-and-set existing meals; deterministic lock order prevents
      // opposing swaps from locking the same dates in reverse order.
      const ordered = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.mealtime.localeCompare(b.mealtime))
      for (const entry of ordered) {
        if (!entry.expectedRecipeId) continue
        const address = { userId: req.userId!, date: toDateOnly(entry.date), mealtime: entry.mealtime }
        const where = { ...address, recipeId: entry.expectedRecipeId }
        const changed = entry.recipeId === null
          ? await tx.mealPlan.deleteMany({ where })
          : await tx.mealPlan.updateMany({ where, data: { recipeId: entry.recipeId } })
        if (changed.count === 0) {
          const current = await tx.mealPlan.findFirst({ where: address })
          if ((current?.recipeId ?? null) !== entry.recipeId) throw new HttpError(409, 'The week changed. Refresh the preview before applying it.')
        }
      }
      await tx.mealPlan.createMany({
        data: ordered.flatMap(entry => !entry.expectedRecipeId && entry.recipeId ? [{
          userId: req.userId!, date: toDateOnly(entry.date), mealtime: entry.mealtime, recipeId: entry.recipeId,
        }] : []),
        skipDuplicates: true,
      })
      const week = await tx.mealPlan.findMany({
        where: { userId: req.userId, date: { gte: from, lte: end } },
        select: { id: true, date: true, mealtime: true, recipeId: true, recipe: { select: plannerRecipeSelect } },
        orderBy: [{ date: 'asc' }, { mealtime: 'asc' }],
      })
      if (entries.some(entry => (week.find(slot => slot.mealtime === entry.mealtime && fromDateOnly(slot.date) === entry.date)?.recipeId ?? null) !== entry.recipeId)) {
        throw new HttpError(409, 'The week changed. Refresh the preview before applying it.')
      }
      return week
    })
    res.json(saved.map(slot => ({ ...slot, date: fromDateOnly(slot.date) })))
  } catch (err) { next(err) }
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

// ─── Grocery ───────────────────────────────────────────────────────────────
//
// The list is derived from the week's plan on every read and never stored, so
// there is no POST for a line and no "rebuild": change a dinner and the next
// GET reflects it. The two tables behind these routes hold only what derivation
// cannot know — the ticks, the hand-typed amount corrections, and the manual
// additions.
//
// `from` is the week start. The client always asks for a Monday-to-Sunday week
// and narrows to "Today" or "Missing only" on its own side, so the whole screen
// is one request and every line's state row can be addressed by that one date.
// Accepting an arbitrary range here instead would leave the server unable to
// say which week a tick belonged to.

app.get('/grocery', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const parsed = groceryRangeSchema.safeParse(req.query)
  if (!parsed.success) {
    return res.status(400).json(formatZodError(parsed.error))
  }
  const { from, to } = parsed.data
  const weekStart = toDateOnly(from)

  try {
    // One row per planned meal, each carrying its recipe's ingredients. This
    // deliberately does NOT de-duplicate recipes: the same dinner planned twice
    // in a week has to be bought for twice.
    const [slots, lines, manual] = await Promise.all([
      prisma.mealPlan.findMany({
        where: { userId: req.userId, date: { gte: weekStart, lte: toDateOnly(to) } },
        // Ordered so `dishes` below comes out in the order the week is cooked
        // in rather than in whatever order Postgres felt like returning.
        orderBy: { date: 'asc' },
        select: {
          // The date and the recipe both travel with the ingredients so a line
          // can be split back into the meals that made it — see `LinePart`,
          // which is what the app's "Today" scope and its dish filter narrow by.
          date: true,
          recipe: {
            select: {
              id: true,
              title: true,
              photoUrl: true,
              // Ordered for the same reason the recipe reads are, even though
              // the sum doesn't care: two identical requests should produce
              // identical payloads, and `byDate` is assembled by walking these.
              ingredients: {
                select: { name: true, quantity: true, unit: true },
                orderBy: { position: 'asc' },
              },
            },
          },
        },
      }),
      prisma.groceryLine.findMany({
        where: { userId: req.userId, weekStart },
        select: { key: true, ticked: true, amountOverride: true },
      }),
      prisma.groceryItem.findMany({
        where: { userId: req.userId, weekStart },
        select: { id: true, name: true, amount: true, unit: true, ticked: true },
        orderBy: { createdAt: 'asc' },
      }),
    ])

    const state = new Map(lines.map((line) => [line.key, line]))
    const derived = aggregateIngredients(
      slots.flatMap((slot) =>
        slot.recipe.ingredients.map((ingredient) => ({
          ...ingredient,
          date: fromDateOnly(slot.date),
          recipeId: slot.recipe.id,
        }))
      )
    )

    /**
     * The distinct dishes this list was derived from, so the app can offer them
     * as filters without a second request and without holding the week's plan
     * itself.
     *
     * **De-duplicated here and only here.** The aggregation above walks slots —
     * the same dinner planned twice has to be bought for twice — but a dish
     * planned twice is still one chip to press.
     *
     * First-planned order, which is the order the week reads in. Deliberately
     * not alphabetical and not by how many lines each contributes: the row is a
     * picture of the week, and a chip that moved when you ticked something off
     * would be the worst kind of surprise in a shop.
     */
    const dishes: { id: string; title: string; photoUrl: string | null }[] = []
    const seenDish = new Set<string>()
    for (const slot of slots) {
      if (seenDish.has(slot.recipe.id)) continue
      seenDish.add(slot.recipe.id)
      dishes.push({ id: slot.recipe.id, title: slot.recipe.title, photoUrl: slot.recipe.photoUrl })
    }

    res.json({
      from,
      to,
      // Two arrays rather than one tagged list: the client groups the derived
      // lines by aisle and pins the manual ones to their own "Added by you"
      // section, so it never has to filter one list back into two.
      lines: derived.map((line) => {
        const stored = state.get(line.key)
        return {
          key: line.key,
          name: line.name,
          unit: line.unit,
          planAmount: roundAmount(line.planAmount),
          // What to render. An override is a correction the user typed and it
          // wins; `planAmount` travels beside it so the client can offer to
          // reset, and so the two can be told apart at all.
          amount: roundAmount(stored?.amountOverride ?? line.planAmount),
          amountOverride: stored?.amountOverride ?? null,
          ticked: stored?.ticked ?? false,
          // Rounded the same way `amount` is: these are sums of the same
          // floats, so they drift the same way, and one of them is displayed
          // whenever the app is narrowed to a day or to a dish.
          parts: line.parts.map((part) => ({ ...part, amount: roundAmount(part.amount) })),
        }
      }),
      items: manual,
      dishes,
    })
  } catch (err) {
    next(err)
  }
})

// An idempotent upsert to a known address, exactly as a meal-plan slot is —
// which is why this is a PUT with no POST beside it. A line exists conceptually
// whether or not you have ever ticked it.
app.put('/grocery/line', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const parsed = groceryLineSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json(formatZodError(parsed.error))
  }
  const { weekStart, key, ticked, amountOverride } = parsed.data

  try {
    const line = await prisma.groceryLine.upsert({
      where: {
        userId_weekStart_key: { userId: req.userId!, weekStart: toDateOnly(weekStart), key },
      },
      // `undefined` tells Prisma to leave a column alone and `null` clears it,
      // which is exactly the distinction `.nullable().optional()` preserves in
      // the schema — sending only `ticked` must not wipe a correction the user
      // typed a moment earlier.
      update: { ticked, amountOverride },
      create: {
        userId: req.userId!,
        weekStart: toDateOnly(weekStart),
        key,
        ticked: ticked ?? false,
        amountOverride: amountOverride ?? null,
      },
      select: { key: true, ticked: true, amountOverride: true },
    })
    res.json(line)
  } catch (err) {
    next(err)
  }
})

app.post('/grocery/items', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const parsed = groceryItemSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json(formatZodError(parsed.error))
  }
  const { weekStart, name, amount, unit } = parsed.data

  try {
    const existing = await prisma.groceryItem.count({
      where: { userId: req.userId, weekStart: toDateOnly(weekStart) },
    })
    if (existing >= MAX_GROCERY_ITEMS_PER_WEEK) {
      return res
        .status(400)
        .json({ error: `A week can hold ${MAX_GROCERY_ITEMS_PER_WEEK} added items` })
    }
    const item = await prisma.groceryItem.create({
      data: { userId: req.userId!, weekStart: toDateOnly(weekStart), name, amount, unit },
      select: { id: true, name: true, amount: true, unit: true, ticked: true },
    })
    res.status(201).json(item)
  } catch (err) {
    next(err)
  }
})

app.patch(
  '/grocery/items/:id',
  requireAuth,
  async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
    const parsed = groceryItemPatchSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json(formatZodError(parsed.error))
    }
    try {
      // Scoped by userId in the WHERE rather than checked after the fact. There
      // is no foreign key from this table to anything, so nothing in the
      // database would stop a stranger's id being written — and a `updateMany`
      // matching nothing gives the same 404 an unknown id does, where a
      // distinct 403 would confirm the id was real.
      const { count } = await prisma.groceryItem.updateMany({
        where: { id: req.params.id, userId: req.userId },
        data: parsed.data,
      })
      if (count === 0) {
        return res.status(404).json({ error: 'Item not found' })
      }
      const item = await prisma.groceryItem.findUnique({
        where: { id: req.params.id },
        select: { id: true, name: true, amount: true, unit: true, ticked: true },
      })
      res.json(item)
    } catch (err) {
      next(err)
    }
  }
)

app.delete(
  '/grocery/items/:id',
  requireAuth,
  async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
    try {
      const { count } = await prisma.groceryItem.deleteMany({
        where: { id: req.params.id, userId: req.userId },
      })
      if (count === 0) {
        return res.status(404).json({ error: 'Item not found' })
      }
      res.status(204).send()
    } catch (err) {
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
