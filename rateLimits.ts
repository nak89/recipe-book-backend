// Rate limiters.
//
// The auth limiter matters most. /auth proxies to Supabase, so every request
// reaches Supabase Auth from *this server's* IP — meaning Supabase's own
// per-IP throttling applies to the whole user base at once. Without a limiter
// here, one attacker brute-forcing logins gets the server throttled and every
// legitimate login fails with it.
//
// The api limiter runs *before* requireAuth on purpose. requireAuth makes a live
// supabase.auth.getUser() call per request, so an unauthenticated flood of junk
// tokens would otherwise burn the Supabase quota one outbound call at a time.
// That also means these are keyed by IP, not userId — there's no userId yet.

import rateLimit from 'express-rate-limit'
import type { Request, Response } from 'express'

function tooMany(_req: Request, res: Response) {
  res.status(429).json({ error: 'Too many requests, please try again later' })
}

const shared = {
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: tooMany,
} as const

/** Sign-up and sign-in. Successful logins don't count, so a real user typing a
 *  password wrong twice is unaffected; a credential-stuffing run is not. */
export const authLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  // Account creation still costs resources even when it succeeds. Only a
  // successful login gets its allowance back; signups always count.
  requestWasSuccessful: (req, res) =>
    /^\/auth\/login\/?$/i.test(req.originalUrl.split('?')[0]!) && res.statusCode < 400,
})

/** Uploads are 5MB each and land in a bucket nothing ever prunes. */
export const uploadLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 30,
})

/** General API ceiling — far above what the app does, low enough to matter. */
export const apiLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 100,
})
