// Request-body schemas. Every write route parses through one of these and uses
// the *parsed* result, never req.body directly — zod strips unknown keys, so a
// client can't smuggle extra columns (or a row `id`) into a Prisma create.
//
// These bounds exist for two reasons: turn "wrong type reaches Prisma" 500s into
// honest 400s, and cap how much a single authenticated request can write. Without
// the caps a body is bounded only by express.json()'s 100kb default, which is a
// lot of rows.

import { z } from 'zod'
import { STARTER_PACK_IDS } from './data/starterPacks.js'

// A photoUrl is stored and later fetched by every device that views the recipe.
// Left unconstrained it's an arbitrary outbound request to a host of the
// submitter's choosing, so restrict it to hosts we actually serve images from.
// Unsplash is here because prisma/seed.ts uses it — drop it if you drop the seed.
//
// Squarespace is here because `data/library.ts` uses it: the shared library's
// photography lives on chefnak.com. It has to be on this list rather than only
// trusted at copy time, because a copied recipe keeps the library's photoUrl and
// `PUT /recipes` re-validates it on the user's first edit — without the host
// here, copying a recipe would produce one that could never be saved again.
function storageHosts(): string[] {
  const hosts = ['images.unsplash.com', 'images.squarespace-cdn.com']
  try {
    if (process.env.SUPABASE_URL) hosts.push(new URL(process.env.SUPABASE_URL).host)
  } catch {
    // Malformed SUPABASE_URL is a startup problem, not a per-request one.
  }
  return hosts
}

const photoUrlSchema = z
  .string()
  .trim()
  .min(1, 'A photo is required')
  .max(2048)
  .refine((value) => {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      return false
    }
    return url.protocol === 'https:' && storageHosts().includes(url.host)
  }, 'photoUrl must be an https URL on an allowed image host')

const ingredientSchema = z.object({
  name: z.string().trim().min(1, 'Ingredient name is required').max(200),
  quantity: z.number().finite().min(0).max(100_000),
  // The form sends '' when the user leaves the unit blank — that's valid.
  unit: z.string().trim().max(50),
})

/**
 * Twelve hours. Not a product rule — a stock or a cure genuinely runs that long
 * — but a bound, so a slipped keystroke can't store a countdown nothing will
 * ever finish. One second is the floor for the same reason zero would be wrong:
 * a zero-second timer is an unset timer, and `null` already means that.
 */
export const MAX_STEP_SECONDS = 12 * 60 * 60

const stepSchema = z.object({
  stepNumber: z.number().int().min(1).max(1000),
  instruction: z.string().trim().min(1, 'Step instruction is required').max(2000),
  // `.nullable().optional()` for the same reason the nutrition columns are:
  // Prisma reads an omitted field in an update as "leave this column alone", so
  // clearing a timer has to send an explicit null to actually clear it. `PUT`
  // deletes and recreates every step row, so the distinction is less load-
  // bearing here than on the recipe's own columns — but the shape should not
  // depend on that implementation detail staying true.
  durationSeconds: z.number().int().min(1).max(MAX_STEP_SECONDS).nullable().optional(),
})

// Nutrition is *per serving*, so these bounds are what one plate can plausibly
// hold — not what a whole tray could total. 100_000 was the old bound and it
// would never have caught a realistic slip.
export const MAX_CALORIES = 10_000
export const MAX_MACRO_GRAMS = 1_000

// Nullable as well as optional, and the distinction matters: Prisma reads an
// `undefined` field in an update as "leave this column alone", so omitting a
// value the user has just cleared silently puts the old number back. Only an
// explicit null empties the column, and the app sends one.
const caloriesSchema = z.number().finite().min(0).max(MAX_CALORIES).nullable().optional()
const macroSchema = z.number().finite().min(0).max(MAX_MACRO_GRAMS).nullable().optional()

export const MAX_DESCRIPTION_WORDS = 1000
/** Hard ceiling on one recipe's JSON body. See the note on `withSizeLimit`. */
export const MAX_RECIPE_BYTES = 60 * 1024

function countWords(value: string): number {
  const trimmed = value.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

// Two caps, deliberately. Words is the rule a person understands and the one
// the app reports; characters is the backstop, because 1000 "words" can still
// be 1000 × 8000 characters if none of them contain a space.
const descriptionSchema = z
  .string()
  .trim()
  .max(8000)
  .refine((v) => countWords(v) <= MAX_DESCRIPTION_WORDS, `Description must be ${MAX_DESCRIPTION_WORDS} words or fewer`)

const recipeBaseSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: descriptionSchema.optional(),
  photoUrl: photoUrlSchema,
  difficulty: z.enum(['Beginner', 'Intermediate', 'Advanced']),
  totalMinutes: z.number().int().min(1).max(100_000),
  servings: z.number().int().min(1).max(1000),
  cuisine: z.string().trim().max(100).optional(),
  mealtime: z.enum(['Breakfast', 'Lunch', 'Dinner', 'Snack']).optional(),
  isFavourite: z.boolean().optional(),
  calories: caloriesSchema,
  protein: macroSchema,
  carbs: macroSchema,
  fat: macroSchema,
  tools: z.array(z.string().trim().min(1).max(100)).max(50),
  // Required and non-empty. PUT replaces these lists wholesale, so an omitted
  // array would otherwise delete every row and create none — a silent wipe
  // that still returns 200.
  ingredients: z.array(ingredientSchema).min(1, 'At least one ingredient is required').max(100),
  steps: z.array(stepSchema).min(1, 'At least one step is required').max(100),
})

/**
 * A ceiling on the whole recipe, not just each field.
 *
 * The per-field caps multiply: 100 steps × 2000 characters plus 100 ingredients
 * is already over 200KB of legitimate-looking rows, and every one of those is a
 * database row this request gets to write. One cap on the total is the only
 * thing that bounds it.
 *
 * This runs on the *parsed* value, so it measures what we'd actually store —
 * not the padding an attacker adds in unknown keys, which zod has stripped by
 * then. `express.json`'s 100kb limit sits above it and catches bodies too big
 * to be worth parsing at all; this one produces the message a user can act on.
 */
function withSizeLimit<T extends z.ZodType>(schema: T) {
  return schema.refine(
    (value) => Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_RECIPE_BYTES,
    `A recipe can't be larger than ${MAX_RECIPE_BYTES / 1024}KB — shorten the description or remove some steps`
  )
}

export const createRecipeSchema = withSizeLimit(recipeBaseSchema)
export const updateRecipeSchema = withSizeLimit(recipeBaseSchema)

export const favouriteSchema = z.object({
  // Must be present. `{ isFavourite: undefined }` is a no-op update that returns
  // 200, so the app's optimistic toggle would report success on a write that
  // never happened.
  isFavourite: z.boolean(),
})

/**
 * Onboarding's starter-pack import. The body carries ids only — the recipe
 * bodies live on the server, because fifteen of them would not fit inside
 * `express.json`'s 100kb limit and would cost fifteen separate auth calls.
 *
 * `.max(3)` is the number of packs that exist, not an arbitrary ceiling: it
 * bounds the work a single request can ask for without needing its own rule.
 */
export const importSchema = z.object({
  packIds: z.array(z.enum(STARTER_PACK_IDS)).min(1, 'Pick at least one pack').max(STARTER_PACK_IDS.length),
})

// `copyLibrarySchema` used to live here. Copying out of the shared library took
// a `language` in its body, because the library shipped in two and the language
// decided which of `title`/`titleKm` was stored. `data/library.ts` is Khmer
// only now, so there is nothing to choose: `/library/:id/copy` and
// `/library/import` take no body at all, and the recipe is addressed entirely
// by its URL.

/**
 * The meal planner's four mealtime slots. Deliberately the same four stored
 * English values as `Recipe.mealtime` — a planner slot and a recipe's own
 * mealtime are the same vocabulary, and duplicating the list here rather than
 * sharing one const is how they'd silently drift.
 */
export const MEALTIMES = ['Breakfast', 'Lunch', 'Dinner', 'Snack'] as const

/**
 * A calendar date, `YYYY-MM-DD`, and nothing else.
 *
 * The regex is not belt-and-braces over `new Date()`: `Date.parse` accepts
 * `2026-8-9`, `2026-08-09T22:00:00Z` and a pile of implementation-defined
 * formats, all of which would round-trip to a *different* string than the client
 * sent and quietly miss the unique constraint the slot depends on. The range
 * check then rejects `2026-02-31`, which matches the shape but isn't a day —
 * re-serialising and comparing is what catches the rollover.
 */
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }, 'Date must be a real calendar date')

/**
 * A slot's address: the two path params of a PUT or DELETE. Parsed rather than
 * trusted, because both go straight into a compound unique lookup — an
 * unvalidated `mealtime` would create a slot named whatever the client sent,
 * and it would then be invisible to a planner that only asks for the four.
 */
export const planSlotParamsSchema = z.object({
  date: dateSchema,
  mealtime: z.enum(MEALTIMES),
})

/** The body of a slot write. The date and mealtime are path params, not body. */
export const planSlotSchema = z.object({
  recipeId: z.uuid('A recipe id is required'),
})

/**
 * The planner reads a week at a time, so the range is required rather than
 * defaulted — an unbounded GET would return every meal the account has ever
 * planned, and grow without limit.
 *
 * 366 days is the cap. It's generous for a screen that shows seven, but the
 * bound exists to stop one request scanning the whole table, not to express a
 * product rule.
 */
export const planRangeSchema = z
  .object({ from: dateSchema, to: dateSchema })
  .refine((value) => value.from <= value.to, {
    message: '`from` must be on or before `to`',
    path: ['from'],
  })
  .refine((value) => {
    const days = (Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`)) / 86_400_000
    return days <= 366
  }, { message: 'Range must be 366 days or fewer', path: ['to'] })

/** A reset covers one day or exactly a Monday–Sunday planner week. */
export const planResetSchema = planRangeSchema.refine(({ from, to }) => {
  if (from === to) return true
  const monday = new Date(`${from}T00:00:00Z`)
  return monday.getUTCDay() === 1 && Date.parse(`${to}T00:00:00Z`) - monday.getTime() === 6 * 86_400_000
}, { message: 'Choose one day or a Monday–Sunday week', path: ['to'] })

/**
 * How many manual "Added by you" items one account may hold in one week.
 *
 * A bound rather than a product rule: without one, a loop in a client can fill
 * the table, and every `GET /grocery` afterwards has to read all of it back.
 */
export const MAX_GROCERY_ITEMS_PER_WEEK = 200

/**
 * The grocery list is derived over a date range, exactly as the planner is, so
 * it takes the planner's range rules unchanged — required, ordered, and capped
 * at 366 days so one request can't scan the whole plan.
 */
export const groceryRangeSchema = planRangeSchema

/**
 * A line's state write: a tick, an amount correction, or both.
 *
 * `key` is opaque here on purpose. The server builds it during derivation and
 * the client sends back whatever it was given; re-validating its *shape* would
 * duplicate the derivation's rules in a second place and go stale the moment
 * they changed. Bounding its length is enough to stop a hostile client writing
 * a megabyte into an indexed column.
 *
 * `amountOverride` is `.nullable()` as well as `.optional()`, and the two mean
 * different things — the same trap the nutrition columns set. Omitted leaves a
 * stored override alone; an explicit `null` clears it, so the line goes back to
 * reporting the plan's own sum. Only `.nullable()` lets that `null` through.
 */
export const groceryLineSchema = z.object({
  weekStart: dateSchema,
  key: z.string().min(1, 'A line key is required').max(500),
  ticked: z.boolean().optional(),
  amountOverride: z.number().finite().min(0).max(100_000).nullable().optional(),
})

/** A manual item. Mirrors `ingredientSchema` — it is the same kind of thing. */
export const groceryItemSchema = z.object({
  weekStart: dateSchema,
  name: z.string().trim().min(1, 'An ingredient name is required').max(200),
  amount: z.number().finite().min(0).max(100_000),
  unit: z.string().trim().max(50),
})

/** A manual item edit. Every field optional, but at least one must be present. */
export const groceryItemPatchSchema = z
  .object({
    name: z.string().trim().min(1, 'An ingredient name is required').max(200).optional(),
    amount: z.number().finite().min(0).max(100_000).optional(),
    unit: z.string().trim().max(50).optional(),
    ticked: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' })

export const credentialsSchema = z.object({
  email: z.email('A valid email is required').max(320),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
})

export type RecipeInput = z.infer<typeof recipeBaseSchema>

/** Flattens a ZodError into the { error, details } shape the clients expect. */
export function formatZodError(error: z.ZodError) {
  const details = error.issues.map((issue) => ({
    field: issue.path.join('.') || '(body)',
    message: issue.message,
  }))
  return { error: details[0]?.message ?? 'Invalid request body', details }
}

/** Drafts address date/mealtime slots and save both meals atomically. */
function mealWeekSchemaFor(mealtime: z.ZodType<'Breakfast' | 'Lunch' | 'Dinner'>, max: number, allowRemoval = false) {
  return z.object({
    weekStart: dateSchema,
    entries: z.array(z.object({ date: dateSchema, mealtime, recipeId: allowRemoval ? z.uuid().nullable() : z.uuid(), expectedRecipeId: z.uuid().nullable().optional() })).min(1).max(max),
  }).superRefine(({ weekStart, entries }, ctx) => {
    const start = new Date(`${weekStart}T00:00:00Z`)
    if (start.getUTCDay() !== 1) ctx.addIssue({ code: 'custom', path: ['weekStart'], message: 'Week must start on Monday' })
    const seen = new Set<string>()
    for (const [i, entry] of entries.entries()) {
      const day = new Date(`${entry.date}T00:00:00Z`).getTime()
      if (day < start.getTime() || day >= start.getTime() + 7 * 86400000 || seen.has(`${entry.date}:${entry.mealtime}`)) {
        ctx.addIssue({ code: 'custom', path: ['entries', i, 'date'], message: 'Slots must be unique and within the selected week' })
      }
      seen.add(`${entry.date}:${entry.mealtime}`)
      if (entry.recipeId === null && !entry.expectedRecipeId) {
        ctx.addIssue({ code: 'custom', path: ['entries', i, 'expectedRecipeId'], message: 'Removing a meal requires its original recipe' })
      }
    }
  })
}

export const dinnerWeekSchema = mealWeekSchemaFor(z.literal('Dinner').default('Dinner'), 7)
export const mealWeekSchema = mealWeekSchemaFor(z.enum(['Breakfast', 'Lunch', 'Dinner']), 21, true)
