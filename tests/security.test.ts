import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import sharp from 'sharp'
import { authLimiter } from '../rateLimits.js'
import { ownedPhotoPath } from '../lib/photoPaths.js'
import { normalizePhoto } from '../lib/normalizePhoto.js'
import { HttpError } from '../httpError.js'
import { boundedMultipart } from '../middleware/boundedMultipart.js'

test('photo references reject other owners, signed URLs, foreign buckets and encoded paths', () => {
  const owner = '11111111-1111-4111-8111-111111111111'
  const path = `${owner}/22222222-2222-4222-8222-222222222222.png`
  const origin = 'https://test.supabase.co'
  const source = `${origin}/storage/v1/object/public/recipe-photos/${path}`
  assert.equal(ownedPhotoPath(source, owner, origin, 'recipe-photos'), path)
  assert.equal(ownedPhotoPath('https://images.unsplash.com/photo', owner, origin, 'recipe-photos'), null)
  assert.throws(() => ownedPhotoPath(source, 'someone-else', origin, 'recipe-photos'))
  for (const invalid of [source + '?token=abc', source.replace('/public/', '/sign/'), source.replace('/recipe-photos/', '/other/'), source.replace(`${owner}/`, `${owner}%2F`), source + '#fragment']) {
    assert.throws(() => ownedPhotoPath(invalid, owner, origin, 'recipe-photos'))
  }
})

test('photo normalization decodes and resizes the image and removes metadata', async () => {
  const source = await sharp({ create: { width: 1024, height: 512, channels: 3, background: '#567' } })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer()
  assert.equal((await sharp(source).metadata()).orientation, 6)

  const photo = await normalizePhoto(source, 'analyze')
  const metadata = await sharp(photo.data).metadata()
  assert.equal(photo.contentType, 'image/jpeg')
  assert.equal(metadata.width, 384)
  assert.equal(metadata.height, 768)
  assert.equal(metadata.exif, undefined)
})

test('a JPEG signature alone does not pass image validation', async () => {
  await assert.rejects(normalizePhoto(Buffer.from([0xff, 0xd8, 0xff]), 'store'),
    (error: unknown) => error instanceof HttpError && error.status === 415)
})

test('multipart processing times out once and ignores a late parser callback', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const headers = new Map<string, string>()
  const response = Object.assign(new EventEmitter(), {
    setHeader: (name: string, value: string) => headers.set(name, value),
  }) as unknown as Response
  let finish: NextFunction | undefined
  const results: unknown[] = []
  boundedMultipart((_req, _res, next) => { finish = next })({} as Request, response, error => { results.push(error) })

  context.mock.timers.tick(30_000)
  assert.equal(results.length, 1)
  assert.ok(results[0] instanceof HttpError && results[0].status === 408)
  assert.equal(headers.get('Connection'), 'close')
  finish?.()
  assert.equal(results.length, 1)
})

test('successful logins are exempt, successful signups consume the auth allowance', async () => {
  const app = express()
  app.use('/auth', authLimiter)
  app.post('/auth/login', (_req, res) => res.sendStatus(200))
  app.post('/auth/signup', (_req, res) => res.sendStatus(201))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}/auth`
  try {
    for (let i = 0; i < 12; i++) {
      const response = await fetch(`${base}/login`, { method: 'POST' })
      await response.text()
      assert.equal(response.status, 200)
    }
    for (let i = 0; i < 10; i++) {
      const response = await fetch(`${base}/signup`, { method: 'POST' })
      await response.text()
      assert.equal(response.status, 201)
    }
    const blocked = await fetch(`${base}/signup`, { method: 'POST' })
    assert.equal(blocked.status, 429)
    assert.match((await blocked.json() as { error: string }).error, /Too many requests/)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
