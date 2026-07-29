// Post-run check: confirms the suite's teardown left nothing behind.
// Run with: npx tsx tests/verify-clean.ts
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { createClient } from '@supabase/supabase-js'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  const leftovers = await prisma.recipe.findMany({
    where: { OR: [{ title: { startsWith: 'QA ' } }, { description: { contains: 'automated QA suite' } }] },
    select: { id: true, title: true, userId: true },
  })
  console.log('leftover QA recipes:', leftovers.length, leftovers.map((r) => r.title).slice(0, 10))
  console.log('total recipes in DB:', await prisma.recipe.count())

  const { data } = await admin.auth.admin.listUsers()
  const qaUsers = data.users.filter((u) => u.email?.startsWith('qa-'))
  console.log('auth users:', data.users.length, '| leftover qa- users:', qaUsers.map((u) => u.email))

  const knownUserIds = new Set(data.users.map((u) => u.id))
  const orphans = await prisma.recipe.findMany({ select: { id: true, userId: true } })
  const orphaned = orphans.filter((r) => !knownUserIds.has(r.userId))
  console.log('recipes with no matching auth user:', orphaned.length)
}

main().finally(() => prisma.$disconnect())
