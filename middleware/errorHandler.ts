// Without these, an unhandled route error falls through to Express's default
// handler, which answers with an HTML page (and a stack trace when NODE_ENV
// isn't production). Every client here parses JSON, so it sees a parse failure
// instead of the real reason — "file too large" arrived as an unreadable 500.

import type { Request, Response, NextFunction } from 'express'
import multer from 'multer'
import { HttpError } from '../httpError.js'

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: 'Not found' })
}

/** body-parser tags its failures with a `type` instead of subclassing Error. */
function bodyParserType(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('type' in err)) return undefined
  const type = (err as { type: unknown }).type
  return typeof type === 'string' ? type : undefined
}

export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(err)

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message })
  }

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Image must be 5MB or smaller' })
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Unexpected file field — use "photo"' })
    }
    return res.status(400).json({ error: 'Invalid file upload' })
  }

  // A body over express.json()'s limit. body-parser throws a plain Error with a
  // `type`, not a SyntaxError, so without this it fell to the generic 500 —
  // hiding the one thing the client could actually act on.
  if (bodyParserType(err) === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large' })
  }
  if (bodyParserType(err) === 'encoding.unsupported') {
    return res.status(415).json({ error: 'Use an uncompressed JSON request body' })
  }

  // Malformed JSON body — express.json() throws a SyntaxError with .status set.
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON body' })
  }

  console.error(err)
  res.status(500).json({ error: 'Something went wrong' })
}
