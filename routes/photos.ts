import { Router } from 'express'
import { z } from 'zod'
import { supabase } from '../supabase.js'
import { ownedPhotoPath } from '../lib/photoPaths.js'
import { HttpError } from '../httpError.js'

const router = Router()
const schema = z.object({ urls: z.array(z.string().url().max(2048)).min(1).max(50) })
const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'recipe-photos'
export const PHOTO_TTL_SECONDS = 3600

router.post('/sign', async (req, res) => {
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) throw new HttpError(400, 'Invalid photo request')
  const sources = [...new Set(parsed.data.urls)]
  const paths = sources.map(source => {
    const path = ownedPhotoPath(source, req.userId!, process.env.SUPABASE_URL!, bucket)
    if (!path) throw new HttpError(400, 'Invalid photo reference')
    return path
  })
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, PHOTO_TTL_SECONDS)
  if (error) throw error
  if (!data || data.some(photo => photo.error || !photo.signedUrl)) throw new HttpError(404, 'Photo not found')
  res.setHeader('Cache-Control', 'no-store')
  res.json({ photos: data.map((photo, i) => ({
    source: sources[i], url: photo.signedUrl, expiresAt: Date.now() + PHOTO_TTL_SECONDS * 1000,
  })) })
})

export default router
