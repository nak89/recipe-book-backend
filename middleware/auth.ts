import jwt from 'jsonwebtoken'
import type { Request, Response, NextFunction } from 'express'

interface JwtPayload {
    userId: string
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization

    if(!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided '})
    }

    const token = authHeader.split(' ')[1]

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload 
        req.userId = decoded.userId 
        next()
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' })
    }
}