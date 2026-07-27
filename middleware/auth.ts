//This is a middleware, whenever the routes hits an endpoint we have to do requireAuth to check for authorization before
//allowing to proceed to any other endpoint
//Doing this saves time instead of writing a auth check for every endpoint
//We can just put this in front of each of them

import type { Request, Response, NextFunction } from 'express'
import { supabase } from '../supabase.js'

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization

    if(!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided '})
    }

    const token = authHeader.split(' ')[1]

    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data.user) {
        return res.status(401).json({ error: 'Invalid or expired token' })
    }

    req.userId = data.user.id
    next()
}
