//upload endpoint using cloudinary and multer as middleware

import express from 'express'
import type { Request, Response } from 'express'
import multer from 'multer'
import cloudinary from '../cloudinary'
import { requireAuth } from '../middleware/auth'

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
//upload.single('photo') tells multer to expect 1 file under field name photo
router.post('/', requireAuth, upload.single('photo'), async(req: Request, res: Response) => {
    if(!req.file) {
        return res.status(400).json({ error: 'No file uploaded' })
    }
    try {
        const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
            cloudinary.uploader.upload_stream( //Cloudinary way of uploading from buffer
                {
                    folder: 'recipe-book',
                    transformation: [{ width: 800, height: 600, crop: 'fill' }],
                },
                (error, result) => {
                    if(error || !result) reject(error)
                    else resolve(result)
                }
            ).end(req.file!.buffer)
        })

        res.json({ url: result.secure_url })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Failed to uplaod image' })
    }
})

export default router

