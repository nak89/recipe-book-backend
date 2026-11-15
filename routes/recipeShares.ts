import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Router, type Request } from 'express'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/database.js'
import { ownedPhotoPath } from '../lib/photoPaths.js'
import { foldForCompare } from '../lib/text.js'
import { supabase } from '../supabase.js'
import { requireAuth } from '../middleware/auth.js'
import { apiLimiter, uploadLimiter } from '../rateLimits.js'
import { HttpError } from '../httpError.js'

const router = Router()
const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'recipe-photos'
const approvedPublicPhotoHosts = new Set(['images.unsplash.com', 'images.squarespace-cdn.com'])
const imageTypes: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' }
const maxPhotoSize = 5 * 1024 * 1024

const recipeFields = {
  title: true, description: true, difficulty: true, totalMinutes: true, servings: true,
  cuisine: true, mealtime: true, tools: true, calories: true, protein: true, carbs: true, fat: true,
  ingredients: {
    orderBy: { position: 'asc' },
    select: { name: true, quantity: true, unit: true },
  },
  steps: {
    orderBy: { stepNumber: 'asc' },
    select: { stepNumber: true, instruction: true, durationSeconds: true },
  },
} satisfies Prisma.RecipeSelect

const notFound = () => new HttpError(404, 'Shared recipe not found')
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

function readToken(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw notFound()
  return hashToken(token)
}

function sharedPhoto(recipe: { photoUrl: string | null; userId: string }) {
  if (!recipe.photoUrl) return undefined
  try {
    const path = ownedPhotoPath(recipe.photoUrl, recipe.userId, process.env.SUPABASE_URL!, bucket)
    if (path) return { path }
    const url = new URL(recipe.photoUrl)
    if (url.protocol === 'https:' && !url.port && !url.username && !url.password &&
      approvedPublicPhotoHosts.has(url.hostname)) return { publicUrl: url.href }
  } catch {
    // Legacy recipes can contain a reference that current uploads cannot create.
  }
}

async function findShare(tokenHash: string) {
  const share = await prisma.recipeShare.findUnique({
    where: { tokenHash },
    select: { recipeId: true, recipe: { select: { ...recipeFields, userId: true, photoUrl: true } } },
  })
  if (!share) throw notFound()
  return share
}

async function ownerRecipe(recipeId: string, userId: string) {
  const owner = await prisma.recipe.findUnique({
    where: { id: recipeId, userId },
    select: { share: { select: { recipeId: true } } },
  })
  if (!owner) throw notFound()
  return owner
}

router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  next()
}, apiLimiter)

router.get('/owner/:recipeId', requireAuth, async (req: Request<{ recipeId: string }>, res) => {
  const owner = await ownerRecipe(req.params.recipeId, req.userId!)
  res.json({ active: Boolean(owner.share) })
})

router.put('/owner/:recipeId', requireAuth, async (req: Request<{ recipeId: string }>, res) => {
  const recipeId = req.params.recipeId
  await ownerRecipe(recipeId, req.userId!)
  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashToken(token)
  await prisma.recipeShare.upsert({
    where: { recipeId },
    create: { recipeId, tokenHash },
    update: { tokenHash },
  })
  res.json({ token })
})

router.delete('/owner/:recipeId', requireAuth, async (req: Request<{ recipeId: string }>, res) => {
  await ownerRecipe(req.params.recipeId, req.userId!)
  await prisma.recipeShare.deleteMany({ where: { recipeId: req.params.recipeId } })
  res.status(204).end()
})

router.get('/:token', async (req, res) => {
  const { recipe } = await findShare(readToken(req.params.token))
  const photo = sharedPhoto(recipe)
  const { userId: _owner, photoUrl: _reference, ...fields } = recipe
  res.json({ ...fields, photoUrl: photo?.publicUrl, hasPrivatePhoto: Boolean(photo?.path) })
})

router.get('/:token/photo', async (req, res) => {
  const tokenHash = readToken(req.params.token)
  const { recipe } = await findShare(tokenHash)
  const path = sharedPhoto(recipe)?.path
  if (!path) throw notFound()
  const { data, error } = await supabase.storage.from(bucket).download(path)
  if (error || !data || data.size > maxPhotoSize) throw notFound()
  const bytes = Buffer.from(await data.arrayBuffer())
  // A revoke or photo swap may have happened while Storage was responding.
  const current = await findShare(tokenHash)
  if (sharedPhoto(current.recipe)?.path !== path) throw notFound()
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  res.type(imageTypes[path.split('.').at(-1)!]!).send(bytes)
})

router.post('/:token/copy', uploadLimiter, requireAuth, async (req: Request<{ token: string }>, res) => {
  const userId = req.userId!
  const tokenHash = readToken(req.params.token)
  const { recipeId, recipe } = await findShare(tokenHash)
  if (recipe.userId === userId) return res.json({ id: recipeId })

  const where = { userId_sharedFromId: { userId, sharedFromId: recipeId } }
  const existing = await prisma.recipe.findUnique({ where, select: { id: true } })
  if (existing) return res.json(existing)

  const storage = supabase.storage.from(bucket)
  const photo = sharedPhoto(recipe)
  let copiedPath: string | undefined
  try {
    const { userId: _owner, photoUrl: _reference, ingredients, steps, ...fields } = recipe
    let photoUrl = photo?.publicUrl
    if (photo?.path) {
      const target = `${userId}/${randomUUID()}.${photo.path.split('.').at(-1)}`
      const { error } = await storage.copy(photo.path, target)
      if (error) throw new HttpError(502, 'The recipe photo could not be copied')
      copiedPath = target
      photoUrl = storage.getPublicUrl(target).data.publicUrl
    }
    if (!photoUrl) throw new HttpError(422, 'The recipe needs a shareable photo before it can be copied')

    const saved = await prisma.$transaction(async tx => {
      const active = await tx.$queryRaw<{ recipeId: string }[]>`
        SELECT "recipeId" FROM public."RecipeShare" WHERE "tokenHash" = ${tokenHash} FOR SHARE
      `
      if (!active.length) throw notFound()
      const alreadySaved = await tx.recipe.findUnique({ where, select: { id: true } })
      if (alreadySaved) return { recipe: alreadySaved, created: false }

      const titles = await tx.recipe.findMany({ where: { userId }, select: { title: true } })
      if (titles.some(r => foldForCompare(r.title) === foldForCompare(fields.title))) {
        throw new HttpError(409, 'You already have a recipe with this title')
      }
      const copy = await tx.recipe.create({
        data: {
          ...fields, userId, sharedFromId: recipeId, photoUrl,
          ingredients: { create: ingredients.map((item, position) => ({ ...item, position })) },
          steps: { create: steps },
        },
        select: { id: true },
      })
      return { recipe: copy, created: true }
    })
    if (saved.created) copiedPath = undefined
    res.status(saved.created ? 201 : 200).json(saved.recipe)
  } catch (error) {
    // Concurrent copies converge on the same recipient-owned recipe.
    if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') {
      const winner = await prisma.recipe.findUnique({ where, select: { id: true } })
      if (winner) return res.json(winner)
    }
    throw error
  } finally {
    if (copiedPath) {
      // Cleanup failures must preserve the outcome of the copy request.
      try {
        const { error } = await storage.remove([copiedPath])
        if (error) console.warn('Could not clean up a temporary recipe share photo')
      } catch {
        console.warn('Could not clean up a temporary recipe share photo')
      }
    }
  }
})

export default router
