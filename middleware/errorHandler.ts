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

  // Malformed JSON body — express.json() throws a SyntaxError with .status set.
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON body' })
  }

  console.error(err)
  res.status(500).json({ error: 'Something went wrong' })
}
