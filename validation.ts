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

const recipeBaseSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().max(5000).optional(),
  photoUrl: photoUrlSchema,
  difficulty: z.enum(['Beginner', 'Intermediate', 'Advanced']),
  totalMinutes: z.number().int().min(1).max(100_000),
  servings: z.number().int().min(1).max(1000),
  cuisine: z.string().trim().max(100).optional(),
  mealtime: z.enum(['Breakfast', 'Lunch', 'Dinner', 'Snack']).optional(),
  isFavourite: z.boolean().optional(),
  calories: z.number().finite().min(0).max(100_000).optional(),
  protein: z.number().finite().min(0).max(100_000).optional(),
  carbs: z.number().finite().min(0).max(100_000).optional(),
  fat: z.number().finite().min(0).max(100_000).optional(),
  tools: z.array(z.string().trim().min(1).max(100)).max(50),
  // Required and non-empty. PUT replaces these lists wholesale, so an omitted
  // array would otherwise delete every row and create none — a silent wipe
  // that still returns 200.
  ingredients: z.array(ingredientSchema).min(1, 'At least one ingredient is required').max(100),
  steps: z.array(stepSchema).min(1, 'At least one step is required').max(100),
})

export const createRecipeSchema = recipeBaseSchema
export const updateRecipeSchema = recipeBaseSchema

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
