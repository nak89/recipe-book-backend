//upload endpoint using Supabase Storage and multer as middleware

import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import multer from 'multer'
import { randomUUID } from 'crypto'
import { supabase } from '../supabase.js'
import { requireAuth } from '../middleware/auth.js'
import { HttpError } from '../httpError.js'

const router = express.Router()
// stores the uploaded file in memory as buffer
const storage = multer.memoryStorage()

// The declared MIME type is just a header the client writes, so it can't be
// trusted for anything. `image/svg+xml` starts with "image/" and an SVG can
// carry <script> — served back from a public bucket under that content type,
// that's an attacker-controlled script hosted on our own storage domain.
// So: allowlist the raster types we actually accept, then confirm the bytes
// really are that type before uploading.
const ALLOWED = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic', // iOS photo library hands these back untouched
} as const

type Ext = keyof typeof ALLOWED

/** Identifies the image from its magic bytes, or null if it isn't one we take. */
function sniff(buf: Buffer): Ext | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png'
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp'
  }
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12)
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return 'heic'
  }
  return null
}

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }, //reject files larger than 5MB
  fileFilter: (_req, file, cb) => {
    // Deliberately lenient: this header is client-supplied, so it decides
    // nothing — sniff() below is the real gate. Kept loose because the app
    // derives the type from a filename and sends "image/jpg" for .jpg files,
    // which no strict allowlist would match.
    if (file.mimetype.startsWith('image/')) {
      cb(null, true)
    } else {
      cb(new HttpError(400, 'Only JPEG, PNG, WebP or HEIC images are allowed'))
    }
  },
})

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'recipe-photos'

//upload.single('photo') tells multer to expect 1 file under field name photo
router.post('/', requireAuth, upload.single('photo'), async (req: Request, res: Response, next: NextFunction) => {
    if(!req.file) {
        return res.status(400).json({ error: 'No file uploaded' })
    }

    const kind = sniff(req.file.buffer)
    if (!kind) {
        return res.status(400).json({ error: 'File is not a valid JPEG, PNG, WebP or HEIC image' })
    }

    try {
        // Extension and content type both come from the sniffed bytes — never
        // from originalname or the client's declared mimetype.
        const path = `${req.userId}/${randomUUID()}.${kind}`

        const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .upload(path, req.file.buffer, { contentType: ALLOWED[kind] })
        if (uploadError) throw uploadError

        const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
        res.json({ url: data.publicUrl })
    } catch (err) {
        next(err)
    }
})

export default router
