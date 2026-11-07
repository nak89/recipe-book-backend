import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { createClient } from '@supabase/supabase-js'
import { ASIAN_HOUSEHOLD } from '../data/asianHousehold.js'
import { createRecipeSchema } from '../validation.js'

// Intentionally development-only, with an explicit user. Never infer a recipient.
const DEV_REF = 'geuqlixuxutgjgsejcgt'
if (process.env.SUPABASE_URL !== `https://${DEV_REF}.supabase.co` ||
    decodeURIComponent(new URL(process.env.DATABASE_URL!).username) !== `postgres.${DEV_REF}`) {
  throw new Error('This seed only runs against Recipe Book development.')
}
const userId = process.env.SEED_USER_ID
if (!userId) throw new Error('Set SEED_USER_ID to the development recipe owner.')
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

async function main() {
  const { data, error } = await admin.auth.admin.getUserById(userId!)
  if (error || !data.user) throw new Error('Development user does not exist.')
  const recipes = ASIAN_HOUSEHOLD.map(({ ingredients, steps, ...recipe }) => createRecipeSchema.parse({
    ...recipe, difficulty: 'Beginner', tools: [],
    ingredients: ingredients.map(([name, quantity, unit]) => ({ name, quantity, unit })),
    steps: steps.map((instruction, i) => ({ instruction, stepNumber: i + 1 })),
  }))
  let added = 0
  await prisma.$transaction(async (tx) => {
    for (const recipe of recipes) {
      if (await tx.recipe.findFirst({ where: { userId, title: { equals: recipe.title, mode: 'insensitive' } } })) continue
      const { ingredients, steps, ...fields } = recipe
      await tx.recipe.create({ data: {
        ...fields, userId: userId!,
        ingredients: { create: ingredients.map((ingredient, position) => ({ ...ingredient, position })) },
        steps: { create: steps },
      } })
      added++
    }
  }, { timeout: 60000 })
  console.log(`${added} Asian household recipes added; ${recipes.length - added} existing recipes preserved.`)
  console.log(`Development account now has ${await prisma.recipe.count({ where: { userId } })} recipes.`)
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'Seed failed'); process.exitCode = 1 }).finally(() => prisma.$disconnect())
