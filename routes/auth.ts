//File that handles authentication by proxying to Supabase Auth.
//Keeps the same request/response shape the frontend already expects
//({ token, user: { id, email } }) so only the token's origin changes.
//
//Note: the mobile app talks to Supabase Auth directly and does not use these
//routes. They remain the most exposed surface on the server (unauthenticated,
//and every call costs a real Supabase Auth request), so they are rate limited
//in index.ts. If nothing ends up needing them, deleting them is the safer move.

import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { supabaseAuth } from '../supabase.js'
import { credentialsSchema, formatZodError } from '../validation.js'

const router = express.Router()

// Sign-in validates presence only. Enforcing a length here would lock out any
// account whose password predates the rule — that check belongs on sign-up.
const loginSchema = z.object({
    email: z.string().trim().min(1, 'Email is required').max(320),
    password: z.string().min(1, 'Password is required').max(128),
})

router.post('/signup', async (req: Request, res: Response) => {
    const parsed = credentialsSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(400).json(formatZodError(parsed.error))
    }
    const { email, password } = parsed.data

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

router.post('/login', async (req: Request, res: Response) =>{
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(400).json(formatZodError(parsed.error))
    }
    const { email, password } = parsed.data

    const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password })
    if (error || !data.session || !data.user) {
        // One message for every failure mode — "no such account" would let
        // someone enumerate which emails are registered.
        return res.status(401).json({ error: 'Invalid email or password' })
    }

    res.status(200).json({ token: data.session.access_token, user: { id: data.user.id, email: data.user.email } })
})

export default router
