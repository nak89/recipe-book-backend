// Request-body schemas. Every write route parses through one of these and uses
// the *parsed* result, never req.body directly — zod strips unknown keys, so a
// client can't smuggle extra columns (or a row `id`) into a Prisma create.
//
// These bounds exist for two reasons: turn "wrong type reaches Prisma" 500s into
// honest 400s, and cap how much a single authenticated request can write. Without
// the caps a body is bounded only by express.json()'s 100kb default, which is a
// lot of rows.

import { z } from 'zod'

// A photoUrl is stored and later fetched by every device that views the recipe.
// Left unconstrained it's an arbitrary outbound request to a host of the
// submitter's choosing, so restrict it to hosts we actually serve images from.
// Unsplash is here because prisma/seed.ts uses it — drop it if you drop the seed.
function storageHosts(): string[] {
  const hosts = ['images.unsplash.com']
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

const stepSchema = z.object({
  stepNumber: z.number().int().min(1).max(1000),
  instruction: z.string().trim().min(1, 'Step instruction is required').max(2000),
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
