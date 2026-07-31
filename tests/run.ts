// End-to-end QA suite. Run with:  npx tsx tests/run.ts
// Requires a server on TEST_API_URL (default http://localhost:3100) and the
// same .env the server uses.
//
// Creates two throwaway Supabase users so cross-user isolation can be tested
// for real, then deletes them and everything they made.

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomUUID } from 'crypto'
import {
  api,
  expect,
  expectStatus,
  group,
  results,
  summary,
  test,
  validRecipe,
  PNG_1X1,
  MALICIOUS_SVG,
} from './harness.js'

const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'recipe-photos'

interface TestUser {
  id: string
  email: string
  password: string
  token: string
}

const createdUsers: TestUser[] = []
const uploadedPaths: string[] = []

async function makeUser(label: string): Promise<TestUser> {
  const email = `qa-${label}-${randomUUID().slice(0, 8)}@example.com`
  const password = `Qa!${randomUUID().slice(0, 16)}`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`could not create test user: ${error?.message}`)
  const signIn = await anon.auth.signInWithPassword({ email, password })
  if (signIn.error || !signIn.data.session) throw new Error(`could not sign in test user: ${signIn.error?.message}`)
  const user = { id: data.user.id, email, password, token: signIn.data.session.access_token }
  createdUsers.push(user)
  return user
}

async function teardown() {
  console.log('\n\x1b[90mCleaning up…\x1b[0m')
  for (const path of uploadedPaths) {
    await supabaseRemove(path)
  }
  for (const user of createdUsers) {
    // No FK from Recipe to auth.users, so deleting the user would orphan rows.
    const { count } = await prisma.recipe.deleteMany({ where: { userId: user.id } })
    await admin.auth.admin.deleteUser(user.id)
    console.log(`\x1b[90m  removed user ${user.email} and ${count} recipe(s)\x1b[0m`)
  }
  await prisma.$disconnect()
}

async function supabaseRemove(path: string) {
  const { error } = await admin.storage.from(BUCKET).remove([path])
  if (error) console.log(`\x1b[90m  (could not remove ${path}: ${error.message})\x1b[0m`)
  else console.log(`\x1b[90m  removed uploaded object ${path}\x1b[0m`)
}

function form(buf: Buffer, filename: string, type: string, field = 'photo') {
  const fd = new FormData()
  fd.append(field, new Blob([new Uint8Array(buf)], { type }), filename)
  return fd
}

async function main() {
  const alice = await makeUser('alice')
  const bob = await makeUser('bob')
  console.log(`\x1b[90mtest users: ${alice.email} / ${bob.email}\x1b[0m`)

  // ── Authentication ────────────────────────────────────────────────────────
  group('1. Authentication')

  await test('rejects a request with no Authorization header', async () => {
    const res = await api('/recipes')
    expectStatus(res, 401)
    return `401 ${res.body?.error}`
  })

  await test('rejects a malformed Authorization scheme', async () => {
    const res = await api('/recipes', { headers: { Authorization: `Token ${alice.token}` } })
    expectStatus(res, 401)
  })

  await test('rejects a forged/garbage bearer token', async () => {
    const res = await api('/recipes', { token: 'not.a.real.token' })
    expectStatus(res, 401)
  })

  await test('rejects a structurally valid but unsigned JWT', async () => {
    const fake = [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ sub: alice.id, exp: 9999999999 })).toString('base64url'),
      'forgedsignature',
    ].join('.')
    const res = await api('/recipes', { token: fake })
    expectStatus(res, 401)
  })

  await test('accepts a valid token', async () => {
    const res = await api('/recipes', { token: alice.token })
    expectStatus(res, 200)
    expect(Array.isArray(res.body), 'expected an array')
    return `${res.body.length} recipe(s)`
  })

  // ── Input validation: deliberately bad payloads ───────────────────────────
  group('2. Input validation — negative tests (all of these SHOULD be rejected)')

  const badBodies: [string, Record<string, unknown>, string][] = [
    ['missing title', validRecipe({ title: undefined }), 'title'],
    ['blank / whitespace-only title', validRecipe({ title: '   ' }), 'title'],
    ['title over 200 chars', validRecipe({ title: 'x'.repeat(300) }), 'title'],
    ['missing photoUrl', validRecipe({ photoUrl: undefined }), 'photoUrl'],
    ['blank photoUrl', validRecipe({ photoUrl: '  ' }), 'photoUrl'],
    ['photoUrl on an attacker-controlled host', validRecipe({ photoUrl: 'https://evil.example/track.png' }), 'photoUrl'],
    ['photoUrl with javascript: scheme', validRecipe({ photoUrl: 'javascript:alert(1)' }), 'photoUrl'],
    ['photoUrl over plain http', validRecipe({ photoUrl: 'http://images.unsplash.com/x.png' }), 'photoUrl'],
    ['totalMinutes as a string', validRecipe({ totalMinutes: 'abc' }), 'totalMinutes'],
    ['totalMinutes negative', validRecipe({ totalMinutes: -10 }), 'totalMinutes'],
    ['servings zero', validRecipe({ servings: 0 }), 'servings'],
    ['servings negative', validRecipe({ servings: -5 }), 'servings'],
    ['difficulty not in the enum', validRecipe({ difficulty: 'Impossible' }), 'difficulty'],
    ['mealtime not in the enum', validRecipe({ mealtime: 'Brunch' }), 'mealtime'],
    ['ingredients missing entirely', validRecipe({ ingredients: undefined }), 'ingredients'],
    ['ingredients empty array', validRecipe({ ingredients: [] }), 'ingredients'],
    ['ingredient quantity as a string', validRecipe({ ingredients: [{ name: 'salt', quantity: 'lots', unit: 'g' }] }), 'quantity'],
    ['ingredient with blank name', validRecipe({ ingredients: [{ name: '  ', quantity: 1, unit: 'g' }] }), 'name'],
    ['over 100 ingredients', validRecipe({ ingredients: Array.from({ length: 101 }, () => ({ name: 'x', quantity: 1, unit: 'g' })) }), 'ingredients'],
    ['steps missing entirely', validRecipe({ steps: undefined }), 'steps'],
    ['steps empty array', validRecipe({ steps: [] }), 'steps'],
    ['step instruction over 2000 chars', validRecipe({ steps: [{ stepNumber: 1, instruction: 'x'.repeat(2001) }] }), 'instruction'],
    ['tools not an array', validRecipe({ tools: 'pan' }), 'tools'],
    ['isFavourite as a string', validRecipe({ isFavourite: 'yes' }), 'isFavourite'],
  ]

  for (const [label, body, expectedField] of badBodies) {
    await test(`POST /recipes rejects: ${label}`, async () => {
      const res = await api('/recipes', { method: 'POST', token: alice.token, body: JSON.stringify(body) })
      expectStatus(res, 400, `body was ${JSON.stringify(body).slice(0, 80)}`)
      expect(typeof res.body?.error === 'string', 'expected a JSON { error } body')
      const fields = (res.body?.details ?? []).map((d: any) => d.field).join(',')
      expect(
        fields.includes(expectedField) || res.body.error.toLowerCase().includes(expectedField.toLowerCase()),
        `expected the error to mention "${expectedField}", got fields [${fields}] / "${res.body.error}"`
      )
      return `400 ${res.body.error}`
    })
  }

  // Optional fields still have ceilings, and the whole recipe has one too.
  await test('POST /recipes rejects a description over 1000 words', async () => {
    const res = await api('/recipes', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify(validRecipe({ description: 'word '.repeat(1001).trim() })),
    })
    expectStatus(res, 400)
    expect(
      JSON.stringify(res.body).toLowerCase().includes('word'),
      `expected the word limit to be named, got "${res.body?.error}"`
    )
    return `400 ${res.body.error}`
  })

  await test('POST /recipes accepts a description of exactly 1000 words', async () => {
    const res = await api('/recipes', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify(validRecipe({ description: 'word '.repeat(1000).trim() })),
    })
    expectStatus(res, 201, 'the limit itself must be allowed, not just under it')
    return 'boundary is inclusive'
  })

  await test('POST /recipes rejects a recipe over the 60KB size cap', async () => {
    // Every field inside its own limit; only the total is too big.
    const res = await api('/recipes', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify(
        validRecipe({
          steps: Array.from({ length: 40 }, (_, i) => ({ stepNumber: i + 1, instruction: 'x'.repeat(1900) })),
        })
      ),
    })
    expectStatus(res, 400)
    expect(
      JSON.stringify(res.body).toLowerCase().includes('kb'),
      `expected the size limit to be named, got "${res.body?.error}"`
    )
    return `400 ${res.body.error}`
  })

  await test('PUT /recipes/:id is capped the same way', async () => {
    const seed = await api('/recipes', { method: 'POST', token: alice.token, body: JSON.stringify(validRecipe()) })
    expectStatus(seed, 201)
    const res = await api(`/recipes/${seed.body.id}`, {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify(
        validRecipe({
          title: seed.body.title,
          steps: Array.from({ length: 40 }, (_, i) => ({ stepNumber: i + 1, instruction: 'x'.repeat(1900) })),
        })
      ),
    })
    expectStatus(res, 400)
    return `400 ${res.body.error}`
  })

  await test('a body over express.json’s 100kb limit → 413 JSON, not a 500', async () => {
    const res = await api('/recipes', {
      method: 'POST',
      token: alice.token,
      headers: { 'Content-Type': 'application/json' },
      rawBody: JSON.stringify(validRecipe({ description: 'x'.repeat(200_000) })),
    })
    expectStatus(res, 413)
    expect(res.body?.error !== undefined, `expected JSON, got: ${res.raw.slice(0, 60)}`)
    return `413 ${res.body.error}`
  })

  await test('POST /recipes rejects malformed JSON with JSON (not an HTML error page)', async () => {
    const res = await api('/recipes', {
      method: 'POST',
      token: alice.token,
      headers: { 'Content-Type': 'application/json' },
      rawBody: '{"title": "broken",,,}',
    })
    expectStatus(res, 400)
    expect(!res.raw.trimStart().startsWith('<'), `got an HTML body: ${res.raw.slice(0, 60)}`)
    return `400 ${res.body?.error}`
  })

  // ── Mass assignment ───────────────────────────────────────────────────────
  group('3. Mass assignment — extra fields must be stripped, not stored')

  let massAssignId = ''
  await test('a userId in the body cannot reassign ownership', async () => {
    const res = await api('/recipes', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify(validRecipe({ userId: bob.id })),
    })
    expectStatus(res, 201)
    massAssignId = res.body.id
    expect(res.body.userId === alice.id, `recipe was created under ${res.body.userId}, expected ${alice.id}`)
    return 'stored under the caller, not the injected id'
  })

  await test("the injected owner (bob) cannot see that recipe", async () => {
    const res = await api(`/recipes/${massAssignId}`, { token: bob.token })
    expectStatus(res, 404)
  })

  await test('a client-supplied ingredient id is ignored', async () => {
    const planted = '00000000-0000-0000-0000-0000deadbeef'
    const res = await api('/recipes', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify(
        validRecipe({ ingredients: [{ id: planted, name: 'flour', quantity: 100, unit: 'g' }] })
      ),
    })
    expectStatus(res, 201)
    expect(res.body.ingredients[0].id !== planted, 'server accepted a client-chosen row id')
    return 'server generated its own id'
  })

  // ── Happy path ────────────────────────────────────────────────────────────
  group('4. CRUD happy path')

  let recipeId = ''
  const title = `QA Carbonara ${randomUUID().slice(0, 6)}`

  await test('POST /recipes creates a recipe', async () => {
    const res = await api('/recipes', { method: 'POST', token: alice.token, body: JSON.stringify(validRecipe({ title })) })
    expectStatus(res, 201)
    recipeId = res.body.id
    expect(res.body.ingredients.length === 2, 'expected 2 ingredients')
    expect(res.body.steps.length === 2, 'expected 2 steps')
    return `201 id=${recipeId.slice(0, 8)}…`
  })

  await test('GET /recipes/:id returns it with steps in order', async () => {
    const res = await api(`/recipes/${recipeId}`, { token: alice.token })
    expectStatus(res, 200)
    const numbers = res.body.steps.map((s: any) => s.stepNumber)
    expect(
      numbers.every((n: number, i: number) => i === 0 || n >= numbers[i - 1]),
      `steps came back out of order: ${numbers}`
    )
    return `steps ${numbers.join(',')}`
  })

  await test('duplicate title is rejected with 409', async () => {
    const res = await api('/recipes', { method: 'POST', token: alice.token, body: JSON.stringify(validRecipe({ title })) })
    expectStatus(res, 409)
    return `409 ${res.body.error}`
  })

  await test('duplicate title differing only in case is rejected', async () => {
    const res = await api('/recipes', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify(validRecipe({ title: title.toUpperCase() })),
    })
    expectStatus(res, 409)
  })

  await test('a different user may reuse the same title', async () => {
    const res = await api('/recipes', { method: 'POST', token: bob.token, body: JSON.stringify(validRecipe({ title })) })
    expectStatus(res, 201)
    return 'uniqueness is per-user, as intended'
  })

  await test('PUT /recipes/:id replaces ingredients and steps', async () => {
    const res = await api(`/recipes/${recipeId}`, {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify(
        validRecipe({
          title,
          servings: 6,
          ingredients: [{ name: 'pasta', quantity: 400, unit: 'g' }],
          steps: [{ stepNumber: 1, instruction: 'Boil' }],
        })
      ),
    })
    expectStatus(res, 200)
    expect(res.body.servings === 6, 'servings not updated')
    expect(res.body.ingredients.length === 1, `expected 1 ingredient, got ${res.body.ingredients.length}`)
    return 'replaced 2 ingredients with 1'
  })

  await test('PUT keeping the recipe’s own title is not a duplicate', async () => {
    const res = await api(`/recipes/${recipeId}`, {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify(validRecipe({ title, servings: 4, ingredients: [{ name: 'pasta', quantity: 400, unit: 'g' }], steps: [{ stepNumber: 1, instruction: 'Boil' }] })),
    })
    expectStatus(res, 200, 'a recipe must not collide with itself on save')
    return 'saved without renaming'
  })

  let secondId = ''
  const secondTitle = `QA Focaccia ${randomUUID().slice(0, 6)}`

  await test('POST creates a second recipe (for the rename test)', async () => {
    const res = await api('/recipes', { method: 'POST', token: alice.token, body: JSON.stringify(validRecipe({ title: secondTitle })) })
    expectStatus(res, 201)
    secondId = res.body.id
  })

  await test('PUT renaming onto another of your recipes → 409', async () => {
    const res = await api(`/recipes/${secondId}`, {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify(validRecipe({ title })),
    })
    expectStatus(res, 409, 'rename collided but was allowed through')
    return `409 ${res.body?.error}`
  })

  await test('PUT renaming onto a title differing only in case → 409', async () => {
    const res = await api(`/recipes/${secondId}`, {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify(validRecipe({ title: title.toLowerCase() })),
    })
    expectStatus(res, 409)
  })

  await test('…and the rejected rename changed nothing', async () => {
    const res = await api(`/recipes/${secondId}`, { token: alice.token })
    expectStatus(res, 200)
    expect(res.body.title === secondTitle, `title became "${res.body.title}"`)
    expect(res.body.ingredients.length === 2, `ingredients were replaced: ${res.body.ingredients.length}`)
    return 'title and rows untouched — the 409 came before the write'
  })

  await test('a different user may rename onto that title', async () => {
    const bobRecipe = await api('/recipes', { method: 'POST', token: bob.token, body: JSON.stringify(validRecipe({ title: `QA Bob ${randomUUID().slice(0, 6)}` })) })
    expectStatus(bobRecipe, 201)
    const res = await api(`/recipes/${bobRecipe.body.id}`, {
      method: 'PUT',
      token: bob.token,
      body: JSON.stringify(validRecipe({ title: secondTitle })),
    })
    expectStatus(res, 200, 'title uniqueness must stay per-user')
    return 'per-user, as intended'
  })

  await test('PATCH /recipes/:id/favourite sets the flag', async () => {
    const res = await api(`/recipes/${recipeId}/favourite`, {
      method: 'PATCH',
      token: alice.token,
      body: JSON.stringify({ isFavourite: true }),
    })
    expectStatus(res, 200)
    expect(res.body.isFavourite === true, 'flag not set')
  })

  await test('PATCH favourite with a missing field is rejected (not a silent no-op)', async () => {
    const res = await api(`/recipes/${recipeId}/favourite`, { method: 'PATCH', token: alice.token, body: JSON.stringify({}) })
    expectStatus(res, 400)
    return `400 ${res.body.error}`
  })

  await test('PATCH favourite with a non-boolean is rejected', async () => {
    const res = await api(`/recipes/${recipeId}/favourite`, {
      method: 'PATCH',
      token: alice.token,
      body: JSON.stringify({ isFavourite: 'yes' }),
    })
    expectStatus(res, 400)
  })

  // ── Nutrition ─────────────────────────────────────────────────────────────
  group('5. Nutrition — per-serving values, and clearing them')

  let nutritionId = ''

  await test('POST stores all four nutrition values', async () => {
    const res = await api('/recipes', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify(validRecipe({ calories: 520, protein: 31.5, carbs: 48, fat: 22 })),
    })
    expectStatus(res, 201)
    nutritionId = res.body.id
    expect(
      res.body.calories === 520 && res.body.protein === 31.5 && res.body.carbs === 48 && res.body.fat === 22,
      `stored ${JSON.stringify([res.body.calories, res.body.protein, res.body.carbs, res.body.fat])}`
    )
    return '520 kcal, 31.5 g protein — decimals survive'
  })

  await test('a recipe saved without nutrition reads back as null, not 0', async () => {
    const res = await api('/recipes', { method: 'POST', token: alice.token, body: JSON.stringify(validRecipe()) })
    expectStatus(res, 201)
    const values = [res.body.calories, res.body.protein, res.body.carbs, res.body.fat]
    expect(values.every((v) => v === null), `expected four nulls, got ${JSON.stringify(values)}`)
    return 'null means "not known", which is not the claim 0 makes'
  })

  await test('PUT with explicit nulls actually clears a saved value', async () => {
    const res = await api(`/recipes/${nutritionId}`, {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify(validRecipe({ calories: null, protein: null, carbs: null, fat: null })),
    })
    expectStatus(res, 200)
    // Re-read rather than trusting the echo — what got written is the point.
    const after = await api(`/recipes/${nutritionId}`, { token: alice.token })
    const values = [after.body.calories, after.body.protein, after.body.carbs, after.body.fat]
    expect(values.every((v) => v === null), `still stored ${JSON.stringify(values)}`)
  })

  await test('PUT that omits nutrition leaves the stored values alone (undefined is not null)', async () => {
    const set = await api(`/recipes/${nutritionId}`, {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify(validRecipe({ calories: 400, protein: 10, carbs: 20, fat: 5 })),
    })
    expectStatus(set, 200)
    const omitted = await api(`/recipes/${nutritionId}`, {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify(validRecipe()),
    })
    expectStatus(omitted, 200)
    expect(omitted.body.calories === 400, `omission cleared it (got ${omitted.body.calories})`)
    return 'omitting preserves — which is why the app always sends an explicit null'
  })

  await test('calories above the 10,000 per-serving cap is rejected', async () => {
    const res = await api('/recipes', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify(validRecipe({ calories: 10_001 })),
    })
    expectStatus(res, 400)
    return `400 ${res.body.error}`
  })

  await test('a macro above the 1,000 g cap is rejected', async () => {
    const res = await api('/recipes', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify(validRecipe({ protein: 1001 })),
    })
    expectStatus(res, 400)
  })

  await test('a negative nutrition value is rejected', async () => {
    const res = await api('/recipes', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify(validRecipe({ fat: -1 })),
    })
    expectStatus(res, 400)
  })

  await test('a nutrition value sent as a string is rejected', async () => {
    const res = await api('/recipes', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify(validRecipe({ carbs: '48' })),
    })
    expectStatus(res, 400)
  })

  // ── Cross-user isolation ──────────────────────────────────────────────────
  group('6. Cross-user isolation — bob attacking alice')

  await test("bob cannot read alice's recipe", async () => {
    const res = await api(`/recipes/${recipeId}`, { token: bob.token })
    expectStatus(res, 404)
    return '404, not 403 — the id is not confirmed'
  })

  await test("bob cannot update alice's recipe", async () => {
    const res = await api(`/recipes/${recipeId}`, {
      method: 'PUT',
      token: bob.token,
      body: JSON.stringify(validRecipe({ title: 'Owned by bob' })),
    })
    expectStatus(res, 404)
  })

  await test("…and alice's ingredients survived that attempt", async () => {
    const res = await api(`/recipes/${recipeId}`, { token: alice.token })
    expectStatus(res, 200)
    expect(res.body.ingredients.length === 1, `ingredients were wiped: got ${res.body.ingredients.length}, expected 1`)
    expect(res.body.steps.length === 1, `steps were wiped: got ${res.body.steps.length}, expected 1`)
    expect(res.body.title === title, `title was changed to "${res.body.title}"`)
    return 'rows intact — the delete never ran'
  })

  await test("bob cannot favourite alice's recipe", async () => {
    const res = await api(`/recipes/${recipeId}/favourite`, {
      method: 'PATCH',
      token: bob.token,
      body: JSON.stringify({ isFavourite: false }),
    })
    expectStatus(res, 404)
  })

  await test("bob cannot delete alice's recipe", async () => {
    const res = await api(`/recipes/${recipeId}`, { method: 'DELETE', token: bob.token })
    expectStatus(res, 404)
    const check = await api(`/recipes/${recipeId}`, { token: alice.token })
    expectStatus(check, 200, 'recipe should still exist')
  })

  await test("bob's list does not contain alice's recipes", async () => {
    const res = await api('/recipes', { token: bob.token })
    expectStatus(res, 200)
    expect(!res.body.some((r: any) => r.id === recipeId), "bob's list leaked alice's recipe")
    return `${res.body.length} recipe(s), none of them alice's`
  })

  // ── Not-found and routing edge cases ──────────────────────────────────────
  group('7. Edge cases and error shape')

  await test('GET a well-formed but nonexistent id → 404', async () => {
    const res = await api(`/recipes/${randomUUID()}`, { token: alice.token })
    expectStatus(res, 404)
  })

  await test('GET a malformed id → 404, not a 500', async () => {
    const res = await api('/recipes/not-a-uuid-at-all', { token: alice.token })
    expectStatus(res, 404)
  })

  await test('DELETE a nonexistent id → 404', async () => {
    const res = await api(`/recipes/${randomUUID()}`, { method: 'DELETE', token: alice.token })
    expectStatus(res, 404)
  })

  await test('an unknown route returns JSON 404, not an HTML page', async () => {
    const res = await api('/does-not-exist')
    expectStatus(res, 404)
    expect(res.body?.error !== undefined, `expected JSON, got: ${res.raw.slice(0, 60)}`)
  })

  await test('DELETE /recipes/:id removes it', async () => {
    const res = await api(`/recipes/${recipeId}`, { method: 'DELETE', token: alice.token })
    expectStatus(res, 204)
    const check = await api(`/recipes/${recipeId}`, { token: alice.token })
    expectStatus(check, 404, 'should be gone')
  })

  // ── Upload ────────────────────────────────────────────────────────────────
  group('8. Photo upload')

  await test('upload without a token → 401', async () => {
    const res = await api('/upload', { method: 'POST', rawBody: form(PNG_1X1, 'x.png', 'image/png') })
    expectStatus(res, 401)
  })

  await test('a real PNG uploads and returns a Supabase URL', async () => {
    const res = await api('/upload', {
      method: 'POST',
      token: alice.token,
      rawBody: form(PNG_1X1, 'photo.png', 'image/png'),
    })
    expectStatus(res, 200)
    expect(typeof res.body?.url === 'string', 'no url returned')
    const host = new URL(res.body.url).host
    expect(host === new URL(process.env.SUPABASE_URL!).host, `unexpected host ${host}`)
    const path = res.body.url.split(`/${BUCKET}/`)[1]
    if (path) uploadedPaths.push(decodeURIComponent(path))
    return `stored at ${path}`
  })

  await test('an SVG declared as image/svg+xml is rejected (stored-XSS vector)', async () => {
    const res = await api('/upload', {
      method: 'POST',
      token: alice.token,
      rawBody: form(MALICIOUS_SVG, 'payload.svg', 'image/svg+xml'),
    })
    expectStatus(res, 400)
    return `400 ${res.body?.error}`
  })

  await test('HTML disguised with an image/png content type is rejected', async () => {
    const html = Buffer.from('<html><script>alert(document.domain)</script></html>')
    const res = await api('/upload', {
      method: 'POST',
      token: alice.token,
      rawBody: form(html, 'innocent.png', 'image/png'),
    })
    expectStatus(res, 400)
    return 'magic-byte check caught it'
  })

  await test('a PNG renamed to .html still stores with an image content type', async () => {
    const res = await api('/upload', {
      method: 'POST',
      token: alice.token,
      rawBody: form(PNG_1X1, 'payload.html', 'image/png'),
    })
    expectStatus(res, 200)
    expect(res.body.url.endsWith('.png'), `extension came from the filename: ${res.body.url}`)
    const path = res.body.url.split(`/${BUCKET}/`)[1]
    if (path) uploadedPaths.push(decodeURIComponent(path))
    return 'extension derived from the bytes, not the name'
  })

  await test('a file over 5MB → 413 JSON, not an HTML crash page', async () => {
    const big = Buffer.concat([PNG_1X1, Buffer.alloc(6 * 1024 * 1024)])
    const res = await api('/upload', { method: 'POST', token: alice.token, rawBody: form(big, 'big.png', 'image/png') })
    expectStatus(res, 413)
    expect(res.body?.error !== undefined, `expected JSON, got: ${res.raw.slice(0, 60)}`)
    return `413 ${res.body.error}`
  })

  await test('an unexpected form field → 400 JSON', async () => {
    const res = await api('/upload', {
      method: 'POST',
      token: alice.token,
      rawBody: form(PNG_1X1, 'x.png', 'image/png', 'avatar'),
    })
    expectStatus(res, 400)
    expect(res.body?.error !== undefined, `expected JSON, got: ${res.raw.slice(0, 60)}`)
  })

  // ── Headers ───────────────────────────────────────────────────────────────
  group('9. CORS and security headers')

  await test('a disallowed browser origin gets no CORS header back', async () => {
    const res = await api('/', { headers: { Origin: 'https://evil.example' } })
    const allow = res.headers.get('access-control-allow-origin')
    expect(allow === null, `server allowed https://evil.example (returned "${allow}")`)
  })

  await test('the app origin is allowed', async () => {
    const res = await api('/', { headers: { Origin: 'http://localhost:8081' } })
    expect(
      res.headers.get('access-control-allow-origin') === 'http://localhost:8081',
      'expected the app origin to be echoed back'
    )
  })

  await test('helmet security headers are present', async () => {
    const res = await api('/')
    expect(res.headers.get('x-content-type-options') === 'nosniff', 'missing X-Content-Type-Options')
    expect(res.headers.get('x-frame-options') !== null, 'missing X-Frame-Options')
    return 'nosniff + frame options set'
  })

  // ── Rate limiting (runs last: it deliberately exhausts the buckets) ───────
  group('10. Rate limiting')

  await test('repeated failed logins are throttled (limit 10 / 15 min)', async () => {
    let throttledAt = 0
    for (let i = 1; i <= 14; i++) {
      const res = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: `nobody-${randomUUID().slice(0, 6)}@example.com`, password: 'wrong-password' }),
      })
      if (res.status === 429) {
        throttledAt = i
        expect(res.body?.error !== undefined, 'expected a JSON body on 429')
        break
      }
      expectStatus(res, 401, `attempt ${i} should be a failed login`)
    }
    expect(throttledAt > 0, 'never throttled after 14 failed logins — brute force is unlimited')
    return `throttled on attempt ${throttledAt}`
  })

  await test('the 429 carries standard RateLimit headers', async () => {
    const res = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'x@example.com', password: 'y' }) })
    expectStatus(res, 429)
    expect(res.headers.get('ratelimit') !== null || res.headers.get('ratelimit-policy') !== null, 'no RateLimit headers')
    return res.headers.get('ratelimit-policy') ?? res.headers.get('ratelimit') ?? ''
  })

  await test('the recipes API is throttled under a burst (limit 100 / min)', async () => {
    let throttledAt = 0
    for (let i = 1; i <= 200; i++) {
      const res = await api('/recipes', { token: alice.token })
      if (res.status === 429) {
        throttledAt = i
        break
      }
    }
    expect(throttledAt > 0, 'sent 200 requests without ever being throttled')
    return `throttled after ${throttledAt} request(s) in this burst`
  })

  await test('throttling applies before token verification (protects the Supabase call)', async () => {
    const res = await api('/recipes', { token: 'garbage-token' })
    expect(res.status === 429, `expected 429 from the limiter, got ${res.status}`)
    return 'junk tokens are rejected by the limiter, not forwarded to Supabase'
  })
}

main()
  .catch((err) => {
    console.error('\n\x1b[31mSuite aborted:\x1b[0m', err)
    results.push({ group: 'suite', name: 'suite completed', passed: false, detail: String(err) })
  })
  .finally(async () => {
    await teardown()
    const failed = summary()
    process.exit(failed > 0 ? 1 : 0)
  })
