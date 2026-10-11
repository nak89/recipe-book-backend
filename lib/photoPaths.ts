import { HttpError } from '../httpError.js'

/** Canonical references are stable; signed URLs are only temporary display URLs. */
export function ownedPhotoPath(value: string, userId: string, origin: string, bucket: string): string | null {
  const url = new URL(value)
  if (url.origin !== new URL(origin).origin) return null
  if (url.username || url.password || url.search || url.hash) throw new HttpError(400, 'Invalid photo reference')
  const prefix = `/storage/v1/object/public/${bucket}/`
  if (!url.pathname.startsWith(prefix)) throw new HttpError(400, 'Invalid photo reference')
  const path = url.pathname.slice(prefix.length)
  // Our upload endpoint creates exactly these two segments. Reject encoded
  // separators/traversal rather than trying to normalise an attacker URL.
  if (!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|png|webp|heic)$/i.test(path)) {
    throw new HttpError(400, 'Invalid photo reference')
  }
  if (path.split('/')[0] !== userId) throw new HttpError(404, 'Photo not found')
  return path
}
