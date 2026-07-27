//upload endpoint using Supabase Storage and multer as middleware

import express from 'express'
import type { Request, Response } from 'express'
import multer from 'multer'
import { randomUUID } from 'crypto'
import { supabase } from '../supabase.js'
import { requireAuth } from '../middleware/auth.js'

const router = express.Router()
// stores the uploaded file in memory as buffer
const storage = multer.memoryStorage()
const upload = multer ({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, //reject files larger than 5MB
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('image/')) { //only allow uploads that ends with image/jpeg || image/png..
            cb(null, true)
        } else {
            cb(new Error('Only image files are allowed'))
        }
    },
})

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'recipe-photos'

//upload.single('photo') tells multer to expect 1 file under field name photo
router.post('/', requireAuth, upload.single('photo'), async(req: Request, res: Response) => {
    if(!req.file) {
        return res.status(400).json({ error: 'No file uploaded' })
    }
    try {
        const extension = req.file.originalname.split('.').pop() ?? 'jpg'
        const path = `${req.userId}/${randomUUID()}.${extension}`

        const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .upload(path, req.file.buffer, { contentType: req.file.mimetype })
        if (uploadError) throw uploadError

        const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
        res.json({ url: data.publicUrl })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Failed to upload image' })
    }
})

export default router
