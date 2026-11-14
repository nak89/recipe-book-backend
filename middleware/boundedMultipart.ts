import type { RequestHandler } from 'express'
import { HttpError } from '../httpError.js'

const maxConcurrentUploads = 4
const uploadDeadlineMs = 30_000
let activeUploads = 0

export function boundedMultipart(parse: RequestHandler): RequestHandler {
  return (req, res, next) => {
    if (activeUploads >= maxConcurrentUploads) {
      res.setHeader('Connection', 'close')
      return next(new HttpError(429, 'Uploads are busy. Try again shortly.'))
    }

    activeUploads++
    let finished = false
    const deadline = setTimeout(() => {
      if (!release()) return
      res.setHeader('Connection', 'close')
      next(new HttpError(408, 'The upload timed out. Try again on a faster connection.'))
    }, uploadDeadlineMs)
    deadline.unref()

    function release() {
      if (finished) return false
      finished = true
      clearTimeout(deadline)
      res.off('close', release)
      activeUploads--
      return true
    }

    res.once('close', release)
    parse(req, res, error => {
      if (release()) next(error)
    })
  }
}
