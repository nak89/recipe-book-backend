import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL as string

// The server is stateless — every request carries its own token — so neither
// client should ever hold onto a session. This matters: a client that has a
// session attaches that user's token to every later request, which would make
// Storage uploads run as the last-signed-in user and get blocked by RLS.
const statelessAuth = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const

// Secret key: server-only, bypasses RLS. Used to verify user tokens
// (auth.getUser) and to upload recipe photos to Storage. Never use this
// client for sign-up/sign-in — see supabaseAuth below.
export const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SECRET_KEY as string, {
  auth: statelessAuth,
})

// Publishable key: the key user-facing auth flows are meant to run under.
// Kept as a separate instance so sign-in never mutates the admin client above.
export const supabaseAuth = createClient(
  SUPABASE_URL,
  process.env.SUPABASE_PUBLISHABLE_KEY as string,
  { auth: statelessAuth }
)
