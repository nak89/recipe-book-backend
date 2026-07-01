//File that handles all the authentication and authorization 
//logic throughout the backend using jsonwebtoken and bcrypt to generate
//token and hash password respectively

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

// /signup endpoint hit, once user singup store the hashed password in the db

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
    
    //never store actual string of password in database in case of data breach
    const hashedPassword = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
        data: { email, password: hashedPassword },
    })
    //create a token for the user, expires in 24h
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET as string, {
        expiresIn: '24h'
    })

    res.status(201).json({ token, user: { id: user.id, email:user.email } })
})

//Same logic as signup 
router.post('/login', async (req: Request<{}, {}, LoginInput>, res: Response) =>{
    const { email, password } = req.body

    if(!email){
        return res.status(400).json({ error: 'Email is required '})
    }

    if(!password){
        return res.status(400).json({ error: 'Password is required '})
    }
    //search database for correct user
    const user = await prisma.user.findUnique({ where: { email } })
    if(!user) {
        return res.status(401).json({ error: 'Invalid email or password '})
    }
    //compare hashed(password) entered with hashed(password stored) with 
    //bcrypt.compare
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

