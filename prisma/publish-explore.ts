import 'dotenv/config'
import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { LIBRARY } from '../data/library.js'
import { readIllustratedRecipes } from '../data/localRecipePreviews.js'
import schedule from '../data/exploreSchedule.json'

const origin = new URL(process.env.EXPLORE_PUBLIC_ORIGIN ?? 'http://localhost')
if (origin.protocol !== 'https:' || origin.href !== origin.origin + '/') {
  throw new Error('Set EXPLORE_PUBLIC_ORIGIN to the HTTPS origin that serves the catalogue images')
}

const recipes = [...LIBRARY, ...readIllustratedRecipes(origin.origin)]
const ids = new Set(recipes.map((recipe) => recipe.id))
const scheduledIds = new Set(schedule.flat())
if (recipes.length !== 64 || ids.size !== 64 || schedule.length !== 31 ||
  schedule.some((page) => page.length !== 6 || new Set(page).size !== 6 || page.some((id) => !ids.has(id))) ||
  scheduledIds.size !== 64 || new Set(schedule.map((page) => [...page].sort().join(','))).size !== 31) {
  throw new Error('Expected 64 distinct recipes and 31 distinct pages of six valid recipe IDs')
}

if (process.argv.includes('--check')) {
  console.log('Validated 64 recipes, images, and 31 daily pages.')
} else {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const snapshot = { recipes: recipes as unknown as Prisma.InputJsonValue, schedule }
  try {
    await prisma.exploreCatalogue.upsert({
      where: { id: 'active' },
      create: { id: 'active', ...snapshot },
      update: snapshot,
    })
    console.log('Published 64 shared recipes and their 31-day schedule.')
  } finally {
    await prisma.$disconnect()
  }
}
