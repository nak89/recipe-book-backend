import { Router } from 'express'
import multer from 'multer'
import { randomUUID } from 'node:crypto'
import { supabase } from '../supabase.js'
import { requireAuth } from '../middleware/auth.js'
import { boundedMultipart } from '../middleware/boundedMultipart.js'
import { normalizePhoto } from '../lib/normalizePhoto.js'
import { HttpError } from '../httpError.js'

const router = Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 2, fieldNameSize: 100 },
  fileFilter: (_req, file, cb) => {
    // A MIME header is only a preliminary gate. The decoder validates the actual bytes.
    if (!file.mimetype.startsWith('image/')) return cb(new HttpError(400, 'Only images are allowed'))
    cb(null, true)
  },
}).single('photo')

const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'recipe-photos'

router.post('/', requireAuth, boundedMultipart(upload), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'No file uploaded')
  const photo = await normalizePhoto(req.file.buffer, 'store').catch(error => {
    if (error instanceof HttpError && error.status === 415) throw new HttpError(400, error.message)
    throw error
  })
  if (res.destroyed) return

  const path = `${req.userId}/${randomUUID()}.${photo.ext}`
  const storage = supabase.storage.from(bucket)
  const { error } = await storage.upload(path, photo.data, { contentType: photo.contentType })
  if (error) throw error
  res.json({ url: storage.getPublicUrl(path).data.publicUrl })
})

export default router
