import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import express from 'express'
import { authLimiter } from '../rateLimits.js'
import { ownedPhotoPath } from '../lib/photoPaths.js'

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
