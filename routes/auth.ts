import express from 'express'
import type { Request, Response } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'


const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const router = express.Router()

interface SignupInput {
    email: string 
    password: string
}
interface LoginInput {
    email: string 
    password: string
}

router.post('/signup', async (req: Request<{}, {}, SignupInput>, res: Response) => {
    const { email, password } = req.body

    if(!email) {
        return res.status(400).json({ error: 'Email is required' })
    }
    if(!password) {
        return res.status(400).json({ error: 'Password is required' })
    }
    const existingUser = await prisma.user.findUnique({ where: { email } })
    if(existingUser) {
        return res.status(409).json({ error: 'An account with this email already exists' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
        data: { email, password: hashedPassword },
    })

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET as string, {
        expiresIn: '24h'
    })

    res.status(201).json({ token, user: { id: user.id, email:user.email } })
})

router.post('/login', async (req: Request<{}, {}, LoginInput>, res: Response) =>{
    const { email, password } = req.body

    if(!email){
        return res.status(400).json({ error: 'Email is required '})
    }

    if(!password){
        return res.status(400).json({ error: 'Password is required '})
    }

    const user = await prisma.user.findUnique({ where: { email } })
    if(!user) {
        return res.status(401).json({ error: 'Invalid email or password '})
    }

    const passwordMatched = await bcrypt.compare(password, user.password)
    if(!passwordMatched) {
        return res.status(401).json({ error: 'Invalid email or password' })
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET as string, {
        expiresIn: '24h',
    })

    res.status(200).json({ token, user: { id: user.id, email: user.email } })
})

export default router

