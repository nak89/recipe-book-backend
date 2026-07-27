//File that handles authentication by proxying to Supabase Auth.
//Keeps the same request/response shape the frontend already expects
//({ token, user: { id, email } }) so only the token's origin changes.

import express from 'express'
import type { Request, Response } from 'express'
import { supabaseAuth } from '../supabase.js'

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

    const { data, error } = await supabaseAuth.auth.signUp({ email, password })
    if (error) {
        const status = error.status === 422 ? 409 : 400
        return res.status(status).json({ error: error.message })
    }
    if (!data.session || !data.user) {
        // Project has "Confirm email" enabled — no session until the user verifies.
        return res.status(201).json({ message: 'Check your email to confirm your account before logging in' })
    }

    res.status(201).json({ token: data.session.access_token, user: { id: data.user.id, email: data.user.email } })
})

router.post('/login', async (req: Request<{}, {}, LoginInput>, res: Response) =>{
    const { email, password } = req.body

    if(!email){
        return res.status(400).json({ error: 'Email is required '})
    }

    if(!password){
        return res.status(400).json({ error: 'Password is required '})
    }

    const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password })
    if (error || !data.session || !data.user) {
        return res.status(401).json({ error: 'Invalid email or password' })
    }

    res.status(200).json({ token: data.session.access_token, user: { id: data.user.id, email: data.user.email } })
})

export default router
