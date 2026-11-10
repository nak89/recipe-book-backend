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
import { STARTER_PACKS, type StarterRecipe } from '../data/starterPacks.js'
import { LIBRARY, libraryDetail, type LibraryRecipe } from '../data/library.js'
import { createRecipeSchema } from '../validation.js'

/**
 * The packaged shape (tuple ingredients, bare step strings) rendered as the
 * body a client would POST, so the packs can be checked against the very schema
 * user-submitted recipes go through. The import route builds its Prisma input
 * the same way — if these two ever disagree, this test is the one that says so.
 */
function asApiBody(recipe: StarterRecipe) {
  const { ingredients, steps, ...rest } = recipe
  return {
    ...rest,
    ingredients: ingredients.map(([name, quantity, unit]) => ({ name, quantity, unit })),
    steps: steps.map((instruction, index) => ({ stepNumber: index + 1, instruction })),
  }
}

/**
 * The same rendering for a library recipe, minus the fields that are the
 * library's own bookkeeping rather than a recipe's content: the id, the
 * subject, the note and the source link. The copy route builds its Prisma input
 * from exactly what is left.
 */
function asLibraryApiBody(recipe: LibraryRecipe) {
  const { id, subject, note, source, ingredients, steps, ...rest } = recipe
  return {
    ...rest,
    // `mealtime` is `.optional()` in the schema and nullable in the column, so
    // "no mealtime" crosses the wire as an absent key rather than an explicit
    // null — Kroeung is a paste and belongs to no meal. Note this is the exact
    // opposite of the nutrition fields, where an explicit null is required to
    // *clear* a value; nothing is being cleared here.
    mealtime: rest.mealtime ?? undefined,
    ingredients: ingredients.map(([name, quantity, unit]) => ({ name, quantity, unit })),
    steps: steps.map((instruction, index) => ({ stepNumber: index + 1, instruction })),
  }
}

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
    // The two grocery tables hang off `userId` alone — no relation to Recipe,
    // so the cascade that clears meal-plan slots does not reach them and they
    // would survive the user they belong to.
    const lines = await prisma.groceryLine.deleteMany({ where: { userId: user.id } })
    const items = await prisma.groceryItem.deleteMany({ where: { userId: user.id } })
    await admin.auth.admin.deleteUser(user.id)
    console.log(
      `\x1b[90m  removed user ${user.email} and ${count} recipe(s), ` +
        `${lines.count} grocery line(s), ${items.count} added item(s)\x1b[0m`
    )
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
  // The list alice's recipe is left holding, in the order she left it in.
  // Deliberately neither alphabetical nor the order it was first written in: if
  // a read ever falls back to sorting by name — or to whatever the heap
  // returns, which is what it did before `Ingredient.position` — this is the
  // list that says so. Group 6 checks it is still this, untouched, after bob
  // has tried to overwrite the recipe.
  const aliceIngredients = ['zaatar', 'pasta', 'mint']

  await test('POST /recipes creates a recipe', async () => {
    const res = await api('/recipes', { method: 'POST', token: alice.token, body: JSON.stringify(validRecipe({ title })) })
    expectStatus(res, 201)
    recipeId = res.body.id
    expect(res.body.ingredients.length === 2, 'expected 2 ingredients')
    expect(res.body.steps.length === 2, 'expected 2 steps')
    // Ingredients used to come back in whatever order Postgres felt like — the
    // reads had no ORDER BY and there was no column to sort on. It looked right
    // only because PUT deletes and recreates the whole list, so heap order and
    // insertion order agreed. `position` makes it a stored fact; the server
    // assigns it from the array index, so a client never sends one.
    const names = res.body.ingredients.map((i: any) => i.name)
    expect(names[0] === 'eggs' && names[1] === 'butter', `ingredients reordered on write: ${names}`)
    const positions = res.body.ingredients.map((i: any) => i.position)
    expect(
      JSON.stringify(positions) === JSON.stringify([0, 1]),
      `positions should be 0,1 — got ${positions}`
    )
    return `201 id=${recipeId.slice(0, 8)}…`
  })

  await test('GET /recipes/:id returns it with steps and ingredients in order', async () => {
    const res = await api(`/recipes/${recipeId}`, { token: alice.token })
    expectStatus(res, 200)
    const numbers = res.body.steps.map((s: any) => s.stepNumber)
    expect(
      numbers.every((n: number, i: number) => i === 0 || n >= numbers[i - 1]),
      `steps came back out of order: ${numbers}`
    )
    const positions = res.body.ingredients.map((i: any) => i.position)
    expect(
      positions.every((n: number, i: number) => i === 0 || n > positions[i - 1]),
      `ingredients came back out of order: ${positions}`
    )
    return `steps ${numbers.join(',')} · ingredients ${positions.join(',')}`
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

  // Khmer marks word boundaries with an invisible zero-width space, and keyboards
  // emit them inconsistently — so the same title typed on two devices can differ
  // by a character nobody can see. `.trim()` doesn't strip it (it's category Cf,
  // not Zs), `.toLowerCase()` ignores it and NFC doesn't delete it, so the old
  // `mode: 'insensitive'` comparison called these two titles different and let
  // both save. This pins the fold that fixes it.
  await test('duplicate title differing only by a zero-width space is rejected', async () => {
    const withZwsp = `${title.slice(0, 3)}​${title.slice(3)}`
    expect(withZwsp !== title, 'test is vacuous — the ZWSP was not inserted')
    const res = await api('/recipes', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify(validRecipe({ title: withZwsp })),
    })
    expectStatus(res, 409, 'an invisible character slipped past the uniqueness check')
    return '409 — the fold saw through the invisible character'
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
      body: JSON.stringify(
        validRecipe({
          title,
          servings: 4,
          ingredients: aliceIngredients.map((name, i) => ({
            name,
            quantity: (i + 1) * 10,
            unit: 'g',
          })),
          steps: [{ stepNumber: 1, instruction: 'Boil' }],
        })
      ),
    })
    expectStatus(res, 200, 'a recipe must not collide with itself on save')
    const order = res.body.ingredients.map((i: any) => i.name)
    expect(
      JSON.stringify(order) === JSON.stringify(aliceIngredients),
      `a reordered list did not survive the save: ${order.join(', ')}`
    )
    return `saved without renaming · ${order.join(' → ')}`
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

  // ── Step timers ───────────────────────────────────────────────────────────
  group('5b. Step timers — what cook mode counts down')

  await test('a step keeps the duration it was saved with', async () => {
    const res = await api('/recipes', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify(
        validRecipe({
          title: `Timed ${Date.now()}`,
          steps: [
            { stepNumber: 1, instruction: 'Soak the rice.', durationSeconds: 1800 },
            { stepNumber: 2, instruction: 'Serve.' },
          ],
        })
      ),
    })
    expectStatus(res, 201)
    const steps = res.body.steps.sort((a: any, b: any) => a.stepNumber - b.stepNumber)
    expect(steps[0].durationSeconds === 1800, `expected 1800, got ${steps[0].durationSeconds}`)
    // An omitted timer is null, not 0 — a zero-second countdown and an unset
    // one are the same thing on screen and must not be two states in the data.
    expect(steps[1].durationSeconds === null, `expected null, got ${steps[1].durationSeconds}`)
    return '1800s kept, the untimed step is null'
  })

  await test('an explicit null clears a timer on edit', async () => {
    const created = await api('/recipes', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify(
        validRecipe({
          title: `Cleared ${Date.now()}`,
          steps: [{ stepNumber: 1, instruction: 'Simmer.', durationSeconds: 600 }],
        })
      ),
    })
    expectStatus(created, 201)

    const res = await api(`/recipes/${created.body.id}`, {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify(
        validRecipe({
          title: created.body.title,
          steps: [{ stepNumber: 1, instruction: 'Simmer.', durationSeconds: null }],
        })
      ),
    })
    expectStatus(res, 200)
    expect(
      res.body.steps[0].durationSeconds === null,
      `the timer survived being cleared: ${res.body.steps[0].durationSeconds}`
    )
    return 'null clears it'
  })

  await test('a duration outside 1..43200 seconds is rejected', async () => {
    for (const durationSeconds of [0, -60, 43_201, 90.5, '600']) {
      const res = await api('/recipes', {
        method: 'POST',
        token: alice.token,
        body: JSON.stringify(
          validRecipe({ steps: [{ stepNumber: 1, instruction: 'Boil.', durationSeconds }] })
        ),
      })
      expectStatus(res, 400)
    }
    return '400 on zero, negative, over twelve hours, fractional and string'
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
    const names = res.body.ingredients.map((i: any) => i.name)
    expect(
      JSON.stringify(names) === JSON.stringify(aliceIngredients),
      `ingredients were altered by a rejected write: ${names.join(', ')}`
    )
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

  await test('private uploads can be viewed by their owner but cannot be signed or attached by another account', async () => {
    const path = uploadedPaths[0]!
    const source = `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
    const payload = JSON.stringify({ urls: [source] })
    const anonymous = await api('/photos/sign', { method: 'POST', body: payload })
    expectStatus(anonymous, 401)
    const other = await api('/photos/sign', { method: 'POST', token: bob.token, body: payload })
    expectStatus(other, 404)
    const owner = await api('/photos/sign', { method: 'POST', token: alice.token, body: payload })
    expectStatus(owner, 200)
    expect(owner.headers.get('cache-control') === 'no-store', 'signed links must not be cached by proxies')
    const signed = await fetch(owner.body.photos[0].url)
    expectStatus(signed, 200)
    await signed.arrayBuffer()
    const publicRead = await fetch(source)
    expect(!publicRead.ok, 'bucket still permits public photo access')
    await publicRead.arrayBuffer()
    const attach = await api('/recipes', { method: 'POST', token: bob.token, body: JSON.stringify(validRecipe({ photoUrl: source })) })
    expectStatus(attach, 404)
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

  await test('multipart text fields are rejected before storage', async () => {
    const body = form(PNG_1X1, 'x.png', 'image/png')
    body.append('unexpected', 'not part of the upload contract')
    const res = await api('/upload', { method: 'POST', token: alice.token, rawBody: body })
    expectStatus(res, 400)
    expect(typeof res.body?.error === 'string', 'expected a JSON error')
  })

  await test('multiple files are rejected before storage', async () => {
    const body = form(PNG_1X1, 'x.png', 'image/png')
    body.append('photo', new Blob([new Uint8Array(PNG_1X1)], { type: 'image/png' }), 'second.png')
    const res = await api('/upload', { method: 'POST', token: alice.token, rawBody: body })
    expectStatus(res, 400)
  })

  await test('Supabase client roles cannot read business tables directly', async () => {
    for (const token of [undefined, alice.token]) {
      for (const table of ['Recipe', 'Ingredient', 'Step', 'MealPlan', 'GroceryLine', 'GroceryItem', '_prisma_migrations']) {
        const headers: Record<string, string> = { apikey: process.env.SUPABASE_PUBLISHABLE_KEY! }
        if (token) headers.Authorization = `Bearer ${token}`
        const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`, { headers })
        const body = await res.json() as { code?: string }
        expect((res.status === 401 || res.status === 403) && body.code === '42501',
          `${table}: expected permission denied, got ${res.status}`)
      }
    }
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

  group('10. Starter packs — the onboarding import')

  await test('GET /starter-packs needs a token', async () => {
    const res = await api('/starter-packs')
    expect(res.status === 401, `expected 401, got ${res.status}`)
    return 'picker metadata is not public'
  })

  await test('GET /starter-packs returns the packs without their recipe bodies', async () => {
    const res = await api('/starter-packs', { token: alice.token })
    expectStatus(res, 200)
    expect(Array.isArray(res.body) && res.body.length === STARTER_PACKS.length, `got ${JSON.stringify(res.body)?.slice(0, 80)}`)
    // The whole reason ids cross the wire instead of recipes: a picker shown
    // once should not download fifteen recipes to render three cards.
    expect(res.body.every((p: any) => p.recipes === undefined), 'recipe bodies leaked into the summary')
    expect(res.body.every((p: any) => typeof p.count === 'number' && p.count > 0), 'missing count')
    return res.body.map((p: any) => `${p.id}(${p.count})`).join(' ')
  })

  await test('every packaged recipe passes the same schema a user POST must', async () => {
    // Pins the photoUrl allowlist and the 60KB cap at test time rather than at
    // some user's first launch — this content never goes through POST /recipes,
    // so nothing else would ever check it.
    for (const pack of STARTER_PACKS) {
      for (const recipe of pack.recipes) {
        const parsed = createRecipeSchema.safeParse(asApiBody(recipe))
        expect(parsed.success, `${pack.id}/${recipe.title}: ${parsed.success ? '' : parsed.error.issues[0]?.message}`)
      }
    }
    return `${STARTER_PACKS.reduce((n, p) => n + p.recipes.length, 0)} recipes validated`
  })

  await test('importing one pack creates exactly its recipes, owned by the caller', async () => {
    const before = (await api('/recipes', { token: alice.token })).body.length
    const res = await api('/recipes/import', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify({ packIds: ['southeast-asian'] }),
    })
    expectStatus(res, 200)
    const pack = STARTER_PACKS.find((p) => p.id === 'southeast-asian')!
    expect(res.body.imported === pack.recipes.length, `imported ${res.body.imported}, expected ${pack.recipes.length}`)
    expect(res.body.skipped === 0, `skipped ${res.body.skipped} on a clean account`)
    const after = await api('/recipes', { token: alice.token })
    expect(after.body.length === before + pack.recipes.length, `grid went ${before} → ${after.body.length}`)
    const owned = await prisma.recipe.count({ where: { userId: alice.id, title: { in: pack.recipes.map((r) => r.title) } } })
    expect(owned === pack.recipes.length, `${owned} of ${pack.recipes.length} rows carry alice's userId`)
    return `${res.body.imported} imported, all scoped to the caller`
  })

  await test('imported recipes arrive with their ingredients and ordered steps', async () => {
    const first = STARTER_PACKS[0].recipes[0]
    const res = await api('/recipes', { token: alice.token })
    const row = res.body.find((r: any) => r.title === first.title)
    expect(row !== undefined, `${first.title} not in the list`)
    expect(row.ingredients.length === first.ingredients.length, `${row.ingredients.length} ingredients, expected ${first.ingredients.length}`)
    expect(row.steps.length === first.steps.length, `${row.steps.length} steps, expected ${first.steps.length}`)
    const numbers = row.steps.map((s: any) => s.stepNumber)
    expect(numbers.join(',') === numbers.slice().sort((a: number, b: number) => a - b).join(','), `steps out of order: ${numbers}`)
    return `${row.ingredients.length} ingredients, ${row.steps.length} steps in order`
  })

  await test('re-importing the same pack is a no-op, not a 409', async () => {
    // The onboarding gate re-runs while onboardedAt is unset, so this is the
    // ordinary path for anyone who force-quits mid-flow — not an edge case.
    const before = (await api('/recipes', { token: alice.token })).body.length
    const res = await api('/recipes/import', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify({ packIds: ['southeast-asian'] }),
    })
    expectStatus(res, 200)
    expect(res.body.imported === 0, `imported ${res.body.imported} duplicates`)
    expect(res.body.skipped === STARTER_PACKS[0].recipes.length, `skipped ${res.body.skipped}`)
    const after = (await api('/recipes', { token: alice.token })).body.length
    expect(after === before, `grid changed ${before} → ${after}`)
    return `0 imported, ${res.body.skipped} skipped, nothing duplicated`
  })

  await test('a collision is matched case-insensitively', async () => {
    const title = STARTER_PACKS[1].recipes[0].title
    const created = await api('/recipes', {
      method: 'POST',
      token: bob.token,
      body: JSON.stringify(validRecipe({ title: title.toUpperCase() })),
    })
    expectStatus(created, 201)
    const res = await api('/recipes/import', {
      method: 'POST',
      token: bob.token,
      body: JSON.stringify({ packIds: ['mediterranean'] }),
    })
    expectStatus(res, 200)
    expect(res.body.skipped === 1, `skipped ${res.body.skipped}, expected the upper-cased title to collide`)
    return `"${title.toUpperCase()}" blocked "${title}"`
  })

  await test('importing every pack creates one row per distinct title', async () => {
    const fresh = await makeUser('packs')
    const res = await api('/recipes/import', {
      method: 'POST',
      token: fresh.token,
      body: JSON.stringify({ packIds: STARTER_PACKS.map((p) => p.id) }),
    })
    expectStatus(res, 200)
    const distinct = new Set(STARTER_PACKS.flatMap((p) => p.recipes.map((r) => r.title.toLowerCase()))).size
    expect(res.body.imported === distinct, `imported ${res.body.imported}, expected ${distinct} distinct`)
    const list = await api('/recipes', { token: fresh.token })
    expect(list.body.length === distinct, `grid holds ${list.body.length}`)
    return `${distinct} recipes from ${STARTER_PACKS.length} packs, one request`
  })

  await test('an unknown pack id is rejected', async () => {
    const res = await api('/recipes/import', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify({ packIds: ['not-a-pack'] }),
    })
    expectStatus(res, 400)
    return res.body.error
  })

  await test('an empty selection is rejected', async () => {
    const res = await api('/recipes/import', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify({ packIds: [] }),
    })
    expectStatus(res, 400)
    return res.body.error
  })

  await test('import needs a token', async () => {
    const res = await api('/recipes/import', {
      method: 'POST',
      body: JSON.stringify({ packIds: ['mediterranean'] }),
    })
    expect(res.status === 401, `expected 401, got ${res.status}`)
    return 'no anonymous imports'
  })

  // ── Meal planner ──────────────────────────────────────────────────────────
  group('11. Meal planner — slots, scoping and the cascade')

  // A fixed week well clear of today, so these rows can't collide with anything
  // a developer has planned in the same database while running this.
  const MON = '2031-03-03'
  const TUE = '2031-03-04'
  const WEEK = { from: MON, to: '2031-03-09' }
  const range = (q: { from: string; to: string }) => `/meal-plan?from=${q.from}&to=${q.to}`

  let plannedRecipeId = ''

  await test('a recipe to plan', async () => {
    const res = await api('/recipes', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify(validRecipe({ title: `QA Planned ${randomUUID().slice(0, 6)}` })),
    })
    expectStatus(res, 201)
    plannedRecipeId = res.body.id
    return `id=${plannedRecipeId.slice(0, 8)}…`
  })

  await test('an empty week is an empty array, not a 404', async () => {
    const res = await api(range(WEEK), { token: alice.token })
    expectStatus(res, 200)
    expect(Array.isArray(res.body), 'expected an array')
    expect(res.body.length === 0, `expected 0 slots, got ${res.body.length}`)
  })

  await test('PUT fills a slot', async () => {
    const res = await api(`/meal-plan/${MON}/Dinner`, {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify({ recipeId: plannedRecipeId }),
    })
    expectStatus(res, 200)
    expect(res.body.date === MON, `date came back as ${res.body.date}, expected ${MON}`)
    expect(res.body.mealtime === 'Dinner', `mealtime came back as ${res.body.mealtime}`)
    expect(res.body.recipe?.title !== undefined, 'expected the recipe to be embedded')
    return `${res.body.date} ${res.body.mealtime}`
  })

  await test('the date survives the round trip as a plain calendar day', async () => {
    // The regression this pins: storing a timestamp instead of a DATE makes the
    // day depend on the writing timezone, and the slot silently moves.
    const res = await api(range(WEEK), { token: alice.token })
    expectStatus(res, 200)
    expect(res.body.length === 1, `expected 1 slot, got ${res.body.length}`)
    expect(res.body[0].date === MON, `read back ${res.body[0].date}, wrote ${MON}`)
    return res.body[0].date
  })

  await test('PUT to the same slot overwrites rather than accumulating', async () => {
    const second = await api('/recipes', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify(validRecipe({ title: `QA Replacement ${randomUUID().slice(0, 6)}` })),
    })
    expectStatus(second, 201)
    const res = await api(`/meal-plan/${MON}/Dinner`, {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify({ recipeId: second.body.id }),
    })
    expectStatus(res, 200)
    const week = await api(range(WEEK), { token: alice.token })
    expect(week.body.length === 1, `slot duplicated — ${week.body.length} rows for one slot`)
    expect(week.body[0].recipeId === second.body.id, 'slot still points at the old recipe')
    return 'one row, replaced'
  })

  await test('the same day holds a different mealtime independently', async () => {
    const res = await api(`/meal-plan/${MON}/Breakfast`, {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify({ recipeId: plannedRecipeId }),
    })
    expectStatus(res, 200)
    const week = await api(range(WEEK), { token: alice.token })
    expect(week.body.length === 2, `expected 2 slots, got ${week.body.length}`)
    return '2 slots on one day'
  })

  await test('a range excludes days outside it', async () => {
    const res = await api(range({ from: TUE, to: TUE }), { token: alice.token })
    expectStatus(res, 200)
    expect(res.body.length === 0, "Monday's slots leaked into a Tuesday-only range")
  })

  await test('an unknown mealtime is rejected', async () => {
    const res = await api(`/meal-plan/${MON}/Brunch`, {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify({ recipeId: plannedRecipeId }),
    })
    expectStatus(res, 400)
    return res.body.error
  })

  for (const [label, date] of [
    ['a malformed date', '03-03-2031'],
    ['a date that is not a real day', '2031-02-31'],
    ['a timestamp rather than a date', '2031-03-03T00:00:00Z'],
  ] as const) {
    await test(`PUT rejects ${label}`, async () => {
      const res = await api(`/meal-plan/${encodeURIComponent(date)}/Dinner`, {
        method: 'PUT',
        token: alice.token,
        body: JSON.stringify({ recipeId: plannedRecipeId }),
      })
      expectStatus(res, 400)
      return res.body.error
    })
  }

  await test('GET requires a range', async () => {
    const res = await api('/meal-plan', { token: alice.token })
    expectStatus(res, 400)
    return res.body.error
  })

  await test('GET rejects a backwards range', async () => {
    const res = await api(range({ from: '2031-03-09', to: MON }), { token: alice.token })
    expectStatus(res, 400)
    return res.body.error
  })

  await test('GET rejects a range over 366 days', async () => {
    const res = await api(range({ from: '2031-01-01', to: '2032-06-01' }), { token: alice.token })
    expectStatus(res, 400)
    return res.body.error
  })

  await test('planning needs a token', async () => {
    const res = await api(`/meal-plan/${MON}/Lunch`, {
      method: 'PUT',
      body: JSON.stringify({ recipeId: plannedRecipeId }),
    })
    expect(res.status === 401, `expected 401, got ${res.status}`)
    return 'no anonymous planning'
  })

  await test("bob cannot plan alice's recipe", async () => {
    // The FK proves the recipe exists; only the ownership check stops bob using
    // it as an oracle for alice's titles and photos via GET.
    const res = await api(`/meal-plan/${MON}/Dinner`, {
      method: 'PUT',
      token: bob.token,
      body: JSON.stringify({ recipeId: plannedRecipeId }),
    })
    expectStatus(res, 404)
    return '404, not 403 — the id is not confirmed'
  })

  await test("bob's week does not show alice's slots", async () => {
    const res = await api(range(WEEK), { token: bob.token })
    expectStatus(res, 200)
    expect(res.body.length === 0, `bob can see ${res.body.length} of alice's planned meals`)
  })

  await test("bob cannot clear alice's slot", async () => {
    const res = await api(`/meal-plan/${MON}/Dinner`, { method: 'DELETE', token: bob.token })
    expectStatus(res, 404)
    const week = await api(range(WEEK), { token: alice.token })
    expect(week.body.length === 2, "alice lost a slot to bob's delete")
    return "alice's slots intact"
  })

  await test('DELETE clears a slot', async () => {
    const res = await api(`/meal-plan/${MON}/Breakfast`, { method: 'DELETE', token: alice.token })
    expectStatus(res, 204)
    const week = await api(range(WEEK), { token: alice.token })
    expect(week.body.length === 1, `expected 1 slot left, got ${week.body.length}`)
    return '204'
  })

  await test('DELETE on an empty slot is a 404', async () => {
    const res = await api(`/meal-plan/${MON}/Breakfast`, { method: 'DELETE', token: alice.token })
    expectStatus(res, 404)
    return res.body.error
  })

  await test('deleting a recipe unplans it', async () => {
    // The cascade, end to end: a slot pointing at a recipe that no longer exists
    // has nothing to render, so unplanning has to follow deleting.
    const week = await api(range(WEEK), { token: alice.token })
    const remaining = week.body[0]
    expect(remaining !== undefined, 'expected a slot to still be planned')
    const del = await api(`/recipes/${remaining.recipeId}`, { method: 'DELETE', token: alice.token })
    expectStatus(del, 204)
    const after = await api(range(WEEK), { token: alice.token })
    expect(after.body.length === 0, `${after.body.length} orphaned slot(s) survived the recipe delete`)
    return 'slot removed with the recipe'
  })

  // ── Grocery ───────────────────────────────────────────────────────────────
  group('12. Grocery — derivation, ticks, overrides and scoping')

  // A different fixed week from the planner group's, so the two can't see each
  // other's rows. Monday, because `from` is the week start.
  const GMON = '2031-04-07'
  const GTUE = '2031-04-08'
  const GWEEK = { from: GMON, to: '2031-04-13' }
  const grocery = (q: { from: string; to: string }) => `/grocery?from=${q.from}&to=${q.to}`

  await test('an empty week derives an empty list, not a 404', async () => {
    const res = await api(grocery(GWEEK), { token: alice.token })
    expectStatus(res, 200)
    expect(Array.isArray(res.body.lines), 'expected lines to be an array')
    expect(res.body.lines.length === 0, `expected 0 lines, got ${res.body.lines.length}`)
    expect(res.body.items.length === 0, `expected 0 added items, got ${res.body.items.length}`)
  })

  await test('the range is required and capped, like the planner\'s', async () => {
    const missing = await api('/grocery', { token: alice.token })
    expectStatus(missing, 400)
    const backwards = await api(grocery({ from: '2031-04-13', to: GMON }), { token: alice.token })
    expectStatus(backwards, 400)
    const huge = await api(grocery({ from: '2030-01-01', to: '2032-01-01' }), { token: alice.token })
    expectStatus(huge, 400)
    return 'missing, reversed and over-366 all rejected'
  })

  let sharedRecipeId = ''
  let otherUnitRecipeId = ''

  await test('two planned meals sharing an ingredient sum into one line', async () => {
    // Same name AND same unit in both recipes — this is the case that must add.
    const first = await api('/recipes', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify(
        validRecipe({
          title: `QA Grocery A ${randomUUID().slice(0, 6)}`,
          ingredients: [
            { name: 'Beef shin', quantity: 300, unit: 'g' },
            { name: 'Lemongrass', quantity: 2, unit: 'stalks' },
          ],
        })
      ),
    })
    expectStatus(first, 201)
    sharedRecipeId = first.body.id

    const second = await api('/recipes', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify(
        validRecipe({
          title: `QA Grocery B ${randomUUID().slice(0, 6)}`,
          ingredients: [{ name: 'Beef shin', quantity: 250, unit: 'g' }],
        })
      ),
    })
    expectStatus(second, 201)

    await api(`/meal-plan/${GMON}/Dinner`, {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify({ recipeId: sharedRecipeId }),
    })
    await api(`/meal-plan/${GTUE}/Dinner`, {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify({ recipeId: second.body.id }),
    })

    const res = await api(grocery(GWEEK), { token: alice.token })
    expectStatus(res, 200)
    const beef = res.body.lines.find((l: any) => l.name === 'Beef shin')
    expect(beef !== undefined, 'no line for the shared ingredient')
    expect(beef.planAmount === 550, `expected 550 g summed, got ${beef.planAmount}`)
    expect(beef.unit === 'g', `unit came back as ${beef.unit}`)
    return `550 g from two meals`
  })

  await test('the same recipe planned twice counts twice', async () => {
    // Buying for one dinner when two are planned is the failure this pins: the
    // aggregation must walk slots, not distinct recipes.
    await api(`/meal-plan/${GMON}/Lunch`, {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify({ recipeId: sharedRecipeId }),
    })
    const res = await api(grocery(GWEEK), { token: alice.token })
    const beef = res.body.lines.find((l: any) => l.name === 'Beef shin')
    expect(beef.planAmount === 850, `expected 850 g (550 + a repeat of 300), got ${beef.planAmount}`)
    return '850 g — the repeat counted'
  })

  await test('a line splits its sum back out into the meals that made it', async () => {
    // What the app's "Today" scope and its dish filter both narrow by. A week's
    // total can't be taken apart again once summed, so without this the chips
    // have nothing to filter on — which is exactly what they did before the
    // field existed.
    //
    // Standing plan at this point: Monday dinner + Monday lunch are the shared
    // recipe (300 g each), Tuesday dinner is the other one (250 g).
    const res = await api(grocery(GWEEK), { token: alice.token })
    const beef = res.body.lines.find((l: any) => l.name === 'Beef shin')
    expect(Array.isArray(beef.parts), 'no parts on the line')
    // Two meals of one dish on one day are a single part, not two: a part is
    // addressed by (date, recipe), and the app asks it "what did this dish want
    // on Monday", never "what did Monday's second sitting want".
    expect(beef.parts.length === 2, `expected 2 parts, got ${beef.parts.length}`)

    const monday = beef.parts.find((p: any) => p.date === GMON && p.recipeId === sharedRecipeId)
    expect(monday !== undefined, 'no Monday part for the shared recipe')
    expect(monday.amount === 600, `expected 600 g on Monday (two meals), got ${monday.amount}`)

    const tuesday = beef.parts.find((p: any) => p.date === GTUE)
    expect(tuesday !== undefined, 'no Tuesday part')
    expect(tuesday.amount === 250, `expected 250 g on Tuesday, got ${tuesday.amount}`)
    expect(tuesday.recipeId !== sharedRecipeId, 'Tuesday’s part is filed against the wrong recipe')

    // Presence is the filter, so a day nothing was planned on must be absent
    // rather than zero — a zero would put an empty row on that day's list.
    const days = new Set(beef.parts.map((p: any) => p.date))
    expect(days.size === 2, `only the two planned days should appear, got ${[...days].join(', ')}`)
    // And the split has to reconcile with the total it came from.
    const summed = beef.parts.reduce((a: number, p: any) => a + p.amount, 0)
    expect(summed === beef.planAmount, `parts sum to ${summed}, planAmount is ${beef.planAmount}`)
    return 'Mon 600 g + Tue 250 g = the week’s 850 g'
  })

  await test('the week’s dishes come back once each, in the order they are cooked', async () => {
    // The dish filter's chips. The aggregation walks slots, so a repeat is
    // bought for twice — but a dish planned twice is still one chip to press,
    // and this is the one place that de-duplication happens.
    const res = await api(grocery(GWEEK), { token: alice.token })
    expect(Array.isArray(res.body.dishes), 'no dishes on the list')
    const ids = res.body.dishes.map((d: any) => d.id)
    expect(
      new Set(ids).size === ids.length,
      `a dish planned twice appeared twice: ${ids.join(', ')}`
    )
    // The shared recipe holds Monday's dinner, and Monday is the first day
    // planned, so it leads.
    expect(ids[0] === sharedRecipeId, 'the first-planned dish is not first')
    const shared = res.body.dishes.find((d: any) => d.id === sharedRecipeId)
    expect(typeof shared.title === 'string' && shared.title.length > 0, 'a dish came back untitled')
    expect('photoUrl' in shared, 'a dish came back without its photo')
    // Every recipe a line names has to be a dish the chip row can draw.
    const known = new Set(ids)
    const orphan = res.body.lines
      .flatMap((l: any) => l.parts)
      .find((p: any) => !known.has(p.recipeId))
    expect(orphan === undefined, `a part names a dish that isn’t in the list: ${orphan?.recipeId}`)
    return `${ids.length} dishes, first-planned first`
  })

  await test('the same name in a different unit stays a separate line', async () => {
    const res = await api('/recipes', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify(
        validRecipe({
          title: `QA Grocery C ${randomUUID().slice(0, 6)}`,
          // 'g' vs 'kg': free-text units have no conversion table, so summing
          // them would be inventing one. Two rows is the honest answer.
          ingredients: [{ name: 'Beef shin', quantity: 1, unit: 'kg' }],
        })
      ),
    })
    expectStatus(res, 201)
    otherUnitRecipeId = res.body.id
    await api(`/meal-plan/${GTUE}/Lunch`, {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify({ recipeId: otherUnitRecipeId }),
    })

    const list = await api(grocery(GWEEK), { token: alice.token })
    const beefLines = list.body.lines.filter((l: any) => l.name === 'Beef shin')
    expect(beefLines.length === 2, `expected 2 beef lines (g and kg), got ${beefLines.length}`)
    const kg = beefLines.find((l: any) => l.unit === 'kg')
    expect(kg?.planAmount === 1, `expected 1 kg on its own line, got ${kg?.planAmount}`)
    return 'g and kg kept apart'
  })

  await test('names differing only by a zero-width space fold into one line', async () => {
    // The Khmer case: keyboards emit U+200B at word boundaries, so two visually
    // identical names compare unequal and would split into two rows — stranding
    // the tick on whichever redrew second.
    const zwsp = await api('/recipes', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify(
        validRecipe({
          title: `QA Grocery ZWSP ${randomUUID().slice(0, 6)}`,
          ingredients: [{ name: 'Beef​ shin', quantity: 100, unit: 'g' }],
        })
      ),
    })
    expectStatus(zwsp, 201)
    await api(`/meal-plan/${GMON}/Breakfast`, {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify({ recipeId: zwsp.body.id }),
    })

    const res = await api(grocery(GWEEK), { token: alice.token })
    const gramLines = res.body.lines.filter((l: any) => l.unit === 'g' && l.name.includes('shin'))
    expect(gramLines.length === 1, `zero-width space split the line into ${gramLines.length}`)
    expect(gramLines[0].planAmount === 950, `expected 950 g, got ${gramLines[0].planAmount}`)
    return '950 g on one folded line'
  })

  let beefKey = ''

  await test('a tick persists across a refetch', async () => {
    const before = await api(grocery(GWEEK), { token: alice.token })
    beefKey = before.body.lines.find((l: any) => l.unit === 'g' && l.name.includes('shin')).key

    const put = await api('/grocery/line', {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify({ weekStart: GMON, key: beefKey, ticked: true }),
    })
    expectStatus(put, 200)
    expect(put.body.ticked === true, 'PUT did not report the line ticked')

    const after = await api(grocery(GWEEK), { token: alice.token })
    const line = after.body.lines.find((l: any) => l.key === beefKey)
    expect(line.ticked === true, 'the tick did not survive the refetch')
    return 'ticked, and still ticked'
  })

  await test('an amount override wins over the plan sum, and null clears it', async () => {
    const set = await api('/grocery/line', {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify({ weekStart: GMON, key: beefKey, amountOverride: 1200 }),
    })
    expectStatus(set, 200)

    const overridden = await api(grocery(GWEEK), { token: alice.token })
    const line = overridden.body.lines.find((l: any) => l.key === beefKey)
    expect(line.amount === 1200, `expected the override 1200, got ${line.amount}`)
    expect(line.planAmount === 950, `planAmount should still report 950, got ${line.planAmount}`)
    // Sending only the override must not have wiped the tick set a moment ago.
    expect(line.ticked === true, 'a partial write cleared the tick')

    const cleared = await api('/grocery/line', {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify({ weekStart: GMON, key: beefKey, amountOverride: null }),
    })
    expectStatus(cleared, 200)
    const back = await api(grocery(GWEEK), { token: alice.token })
    const reset = back.body.lines.find((l: any) => l.key === beefKey)
    expect(reset.amount === 950, `expected the plan sum back, got ${reset.amount}`)
    expect(reset.amountOverride === null, 'the override did not clear')
    return 'override applied, then cleared'
  })

  await test('a manual item is created, edited, counted and deleted', async () => {
    const created = await api('/grocery/items', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify({ weekStart: GMON, name: 'Bin bags', amount: 1, unit: '' }),
    })
    expectStatus(created, 201)
    const itemId = created.body.id

    const listed = await api(grocery(GWEEK), { token: alice.token })
    expect(listed.body.items.length === 1, `expected 1 added item, got ${listed.body.items.length}`)

    const patched = await api(`/grocery/items/${itemId}`, {
      method: 'PATCH',
      token: alice.token,
      body: JSON.stringify({ ticked: true, amount: 2 }),
    })
    expectStatus(patched, 200)
    expect(patched.body.ticked === true && patched.body.amount === 2, 'patch did not apply')

    const removed = await api(`/grocery/items/${itemId}`, { method: 'DELETE', token: alice.token })
    expectStatus(removed, 204)
    const empty = await api(grocery(GWEEK), { token: alice.token })
    expect(empty.body.items.length === 0, 'the item survived its delete')
    return 'created, patched, deleted'
  })

  await test('bob cannot read, tick or touch alice\'s list', async () => {
    // No FK protects these tables — the scoping is entirely in the WHERE, so
    // this is the test that stands between a typo and a stranger's shopping.
    const read = await api(grocery(GWEEK), { token: bob.token })
    expectStatus(read, 200)
    expect(read.body.lines.length === 0, `bob saw ${read.body.lines.length} of alice's lines`)

    const bobItem = await api('/grocery/items', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify({ weekStart: GMON, name: 'Alice only', amount: 1, unit: '' }),
    })
    expectStatus(bobItem, 201)

    const steal = await api(`/grocery/items/${bobItem.body.id}`, {
      method: 'PATCH',
      token: bob.token,
      body: JSON.stringify({ ticked: true }),
    })
    expectStatus(steal, 404)
    const destroy = await api(`/grocery/items/${bobItem.body.id}`, {
      method: 'DELETE',
      token: bob.token,
    })
    expectStatus(destroy, 404)

    // Bob ticking the same key writes his own row, not over alice's.
    await api('/grocery/line', {
      method: 'PUT',
      token: bob.token,
      body: JSON.stringify({ weekStart: GMON, key: beefKey, ticked: false }),
    })
    const alicesStill = await api(grocery(GWEEK), { token: alice.token })
    const line = alicesStill.body.lines.find((l: any) => l.key === beefKey)
    expect(line.ticked === true, "bob's write reached alice's line")
    return '404 on both, and no cross-write'
  })

  await test('grocery routes require a token', async () => {
    const res = await api(grocery(GWEEK))
    expectStatus(res, 401)
    const put = await api('/grocery/line', {
      method: 'PUT',
      body: JSON.stringify({ weekStart: GMON, key: 'x|y', ticked: true }),
    })
    expectStatus(put, 401)
  })

  await test('a line write is validated', async () => {
    const noKey = await api('/grocery/line', {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify({ weekStart: GMON, key: '', ticked: true }),
    })
    expectStatus(noKey, 400)
    const badDate = await api('/grocery/line', {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify({ weekStart: '2031-4-7', key: 'x|y', ticked: true }),
    })
    expectStatus(badDate, 400)
    const badAmount = await api('/grocery/items', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify({ weekStart: GMON, name: 'Nope', amount: -5, unit: 'g' }),
    })
    expectStatus(badAmount, 400)
    const noName = await api('/grocery/items', {
      method: 'POST',
      token: alice.token,
      body: JSON.stringify({ weekStart: GMON, name: '   ', amount: 1, unit: 'g' }),
    })
    expectStatus(noName, 400)
    return 'blank key, loose date, negative amount and blank name all rejected'
  })

  await test('unplanning a meal removes its ingredients from the list', async () => {
    // The point of deriving rather than storing: no rebuild step, no stale row.
    await api(`/meal-plan/${GTUE}/Lunch`, { method: 'DELETE', token: alice.token })
    const res = await api(grocery(GWEEK), { token: alice.token })
    const kg = res.body.lines.find((l: any) => l.unit === 'kg')
    expect(kg === undefined, 'the unplanned meal left its ingredients behind')
    return 'kg line gone with its meal'
  })

  group('13. Shared library — browse, copy, and the language trap')

  await test('every library recipe satisfies the schema a user recipe goes through', async () => {
    // Same reasoning as the starter-pack check above: this content never passes
    // through POST /recipes, so nothing else would ever validate it. It is what
    // pins the squarespace host into the photoUrl allowlist and the 60KB cap at
    // test time rather than at a user's first tap on Explore.
    for (const recipe of LIBRARY) {
      const parsed = createRecipeSchema.safeParse(asLibraryApiBody(recipe))
      expect(parsed.success, `${recipe.id}: ${parsed.success ? '' : parsed.error.issues[0]?.message}`)
    }
    return `${LIBRARY.length} recipes validated`
  })

  await test('every library recipe is written in Khmer, body and all', async () => {
    // The library is Khmer only — see the note at the top of `data/library.ts`.
    // The Khmer was drafted rather than supplied and is owed a native reader,
    // but a row that quietly kept its English is a different problem entirely,
    // and it is the one nothing else would catch. Khmer runs U+1780–U+17FF.
    //
    // `subject`, `mealtime` and `difficulty` are deliberately *not* checked:
    // they are stored English enum values the client translates through
    // `i18n/labels.ts`, exactly as `Recipe.mealtime` is everywhere else.
    const khmer = /[ក-៿]/
    for (const recipe of LIBRARY) {
      for (const [field, value] of [
        ['title', recipe.title],
        ['description', recipe.description],
        ['headline', recipe.headline],
        ['cuisine', recipe.cuisine],
        ['note', recipe.note],
      ] as const) {
        expect(khmer.test(value), `${recipe.id}: ${field} is not Khmer — "${value}"`)
      }
      for (const [name] of recipe.ingredients) {
        expect(khmer.test(name), `${recipe.id}: ingredient "${name}" is not Khmer`)
      }
      for (const tool of recipe.tools) {
        expect(khmer.test(tool), `${recipe.id}: tool "${tool}" is not Khmer`)
      }
      recipe.steps.forEach((step, i) =>
        expect(khmer.test(step), `${recipe.id}: step ${i + 1} is not Khmer`)
      )
    }
    return `${LIBRARY.length} recipes, no English left`
  })

  await test('library units keep measurements Latin and count-words Khmer', async () => {
    // The split `ingredients.km.ts` sets out and `units.km.ts` follows: `g` and
    // `tbsp` are symbols and stay Latin — that is how Cambodian recipes write
    // them, and the ingredient row's unit column is a fixed width that must not
    // wrap — while anything you *count* is a Khmer word. A unit written as an
    // English word ("cloves", "leaves") is the failure this catches: it would
    // reach the grocery list, where `unitFor` would pluralise it into a Khmer
    // list.
    const measurements = new Set(['g', 'kg', 'ml', 'l', 'tsp', 'tbsp'])
    for (const recipe of LIBRARY) {
      for (const [name, , unit] of recipe.ingredients) {
        if (measurements.has(unit)) continue
        expect(
          /[ក-៿]/.test(unit),
          `${recipe.id}: "${name}" is counted in "${unit}", which is neither a measurement symbol nor Khmer`
        )
      }
    }
    return 'symbols Latin, count-words Khmer'
  })

  await test('library ids are unique — the copy constraint depends on it', async () => {
    const ids = LIBRARY.map((r) => r.id)
    expect(new Set(ids).size === ids.length, `duplicate library id: ${ids.join(', ')}`)
    return `${ids.length} distinct ids`
  })

  await test('GET /library lists everything, with nothing saved yet', async () => {
    const res = await api('/library', { token: alice.token })
    expect(res.status === 200, `expected 200, got ${res.status}`)
    const catalogue = await api('/library/catalogue')
    expect(catalogue.status === 200, `public catalogue returned ${catalogue.status}`)
    const expectedSize = process.env.EXPLORE_PUBLIC_ORIGIN || process.env.LOCAL_RECIPE_PREVIEW_ORIGIN ? 64 : LIBRARY.length
    expect(res.body.recipes.length === expectedSize, `expected ${expectedSize} recipes`)
    expect(catalogue.body.recipes.length === expectedSize, `expected ${expectedSize} public recipes`)
    expect(res.body.featuredIds.length === 6, 'expected six featured dishes')
    expect(res.body.savedIds.length === 0, 'a fresh account should have saved nothing')
    // The browse payload must not carry the bodies — that's the whole reason
    // there is a separate detail route.
    expect(res.body.recipes[0].ingredients === undefined, 'browse payload leaked ingredients')
    expect(res.body.recipes[0].steps === undefined, 'browse payload leaked steps')
    return `${res.body.recipes.length} summaries, no bodies`
  })

  await test('GET /library/:id returns the body, and 404s on an unknown id', async () => {
    const res = await api('/library/fish-amok', { token: alice.token })
    expect(res.status === 200, `expected 200, got ${res.status}`)
    expect(res.body.ingredients.length > 0, 'detail carried no ingredients')
    expect(res.body.savedRecipeId === null, 'nothing is saved yet')
    const missing = await api('/library/no-such-dish', { token: alice.token })
    expect(missing.status === 404, `expected 404, got ${missing.status}`)
    return '200 with a body, 404 on a stranger'
  })

  await test('GET /library/:id names its ingredient tuples', async () => {
    // `LIBRARY` stores `[name, quantity, unit]` so that eight full recipes stay
    // readable in a source file. That is a storage shape, and serving it
    // unmapped sent the app an array where it reads `ingredient.name` — which
    // came back `undefined` and threw on the first one it folded. The
    // `ingredients.length > 0` check above passed either way; this is the
    // assertion that does not.
    const res = await api('/library/fish-amok', { token: alice.token })
    for (const item of res.body.ingredients) {
      expect(
        typeof item.name === 'string' && item.name.length > 0,
        `an ingredient reached the wire without a name: ${JSON.stringify(item)}`
      )
      expect(typeof item.quantity === 'number', `${item.name}: quantity is not a number`)
      expect(typeof item.unit === 'string', `${item.name}: unit is not a string`)
    }
    // The other seven are checked through the serialiser rather than over the
    // network — the shape is what is at stake, not the route, and seven more
    // requests would spend limiter budget group 14 is about to need.
    for (const id of LIBRARY.map((r) => r.id)) {
      const detail = libraryDetail(id)
      expect(detail !== undefined, `libraryDetail lost ${id}`)
      expect(
        detail!.ingredients.every((i) => typeof i.name === 'string' && i.name.length > 0),
        `${id} has an unnamed ingredient`
      )
    }
    return `named ${res.body.ingredients.length} on amok, ${LIBRARY.length} recipes checked`
  })

  await test('copying stores the Khmer title and stamps libraryId', async () => {
    // No body: the library is one language, so there is nothing to choose and
    // `/library/:id/copy` takes nothing but its URL.
    const res = await api('/library/fish-amok/copy', { method: 'POST', token: alice.token })
    expect(res.status === 201, `expected 201, got ${res.status}`)
    expect(res.body.title === 'អាម៉ុកត្រី', `stored "${res.body.title}"`)
    expect(res.body.libraryId === 'fish-amok', 'libraryId was not stamped')
    expect(res.body.ingredients.length === 10, `expected 10 ingredients, got ${res.body.ingredients.length}`)
    expect(res.body.steps[0].stepNumber === 1, 'steps were not numbered from 1')
    return `"${res.body.title}" copied`
  })

  await test('copying the same recipe again returns the same row, not a second one', async () => {
    const res = await api('/library/fish-amok/copy', { method: 'POST', token: alice.token })
    expect(res.status === 200, `expected 200 for a re-copy, got ${res.status}`)
    const all = await api('/recipes', { token: alice.token })
    const copies = all.body.filter((r: any) => r.libraryId === 'fish-amok')
    expect(copies.length === 1, `expected 1 copy, found ${copies.length}`)
    return 'idempotent'
  })

  await test('renaming a copy does not let a second one through', async () => {
    // The live version of the bug `Recipe.libraryId` exists for. It used to be
    // reached by switching language — the copy stored whichever title you were
    // reading, so a title check saw "Cambodian Fish Amok" and អាម៉ុកត្រី as two
    // recipes. One language closed that door and left this one open: a copy is
    // the user's own content the moment it lands, and the first thing they may
    // do is rename it. Only the id survives that.
    const all = await api('/recipes', { token: alice.token })
    const copy = all.body.find((r: any) => r.libraryId === 'fish-amok')
    const renamed = await api(`/recipes/${copy.id}`, {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify({ ...validRecipe({}), title: 'ម្ហូបល្ងាចថ្ងៃអង្គារ', photoUrl: copy.photoUrl }),
    })
    expect(renamed.status === 200, `rename failed: ${renamed.status}`)

    const res = await api('/library/fish-amok/copy', { method: 'POST', token: alice.token })
    expect(res.status === 200, `expected 200, got ${res.status}`)
    const after = await api('/recipes', { token: alice.token })
    const copies = after.body.filter((r: any) => r.libraryId === 'fish-amok')
    expect(copies.length === 1, `the rename created ${copies.length} copies`)
    expect(res.body.title === 'ម្ហូបល្ងាចថ្ងៃអង្គារ', 'the copy route handed back the library row, not the user\'s')
    return 'one recipe, under the name the user gave it'
  })

  await test('a second copy stores its own Khmer title', async () => {
    const res = await api('/library/kroeung/copy', { method: 'POST', token: alice.token })
    expect(res.status === 201, `expected 201, got ${res.status}`)
    expect(res.body.title === 'គ្រឿង', `stored "${res.body.title}"`)
    expect(/[ក-៿]/.test(res.body.description), 'description was not Khmer')
    expect(res.body.ingredients.every((i: any) => /[ក-៿]/.test(i.name)), 'an ingredient arrived in English')
    expect(res.body.steps.every((s: any) => /[ក-៿]/.test(s.instruction)), 'a step arrived in English')
    return `"${res.body.title}", body in Khmer`
  })

  await test('savedIds now reports both copies', async () => {
    const res = await api('/library', { token: alice.token })
    expect(res.body.savedIds.includes('fish-amok'), 'fish-amok missing from savedIds')
    expect(res.body.savedIds.includes('kroeung'), 'kroeung missing from savedIds')
    const detail = await api('/library/fish-amok', { token: alice.token })
    expect(detail.body.savedRecipeId !== null, 'detail did not report the saved row')
    return `${res.body.savedIds.length} saved`
  })

  await test('a copied recipe is still editable — the photoUrl survives a PUT', async () => {
    // The real reason images.squarespace-cdn.com had to go in the allowlist
    // rather than merely be trusted at copy time. Without it this PUT is a 400
    // and the recipe is frozen the moment it lands in the book.
    const all = await api('/recipes', { token: alice.token })
    const copy = all.body.find((r: any) => r.libraryId === 'fish-amok')
    const res = await api(`/recipes/${copy.id}`, {
      method: 'PUT',
      token: alice.token,
      body: JSON.stringify({ ...validRecipe({}), title: 'My Amok', photoUrl: copy.photoUrl }),
    })
    expect(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`)
    expect(res.body.photoUrl === copy.photoUrl, 'the library photo was rejected on edit')
    return 'edited, photo intact'
  })

  await test('copying refuses a title the account already wrote itself', async () => {
    // The clash is against the library's Khmer title now, which is the only
    // title there is. Someone who wrote their own ឡុកឡាក់សាច់គោ still owns that
    // name, and the per-user title rule is what their next save enforces — so
    // one rule rather than two.
    await api('/recipes', {
      method: 'POST',
      token: bob.token,
      body: JSON.stringify({ ...validRecipe({}), title: 'ឡុកឡាក់សាច់គោ' }),
    })
    const res = await api('/library/beef-lok-lak/copy', { method: 'POST', token: bob.token })
    expect(res.status === 409, `expected 409, got ${res.status}`)
    return '409, naming the existing recipe'
  })

  await test('one account’s copies are invisible to another', async () => {
    const res = await api('/library', { token: bob.token })
    expect(!res.body.savedIds.includes('fish-amok'), "bob can see alice's copy")
    return 'savedIds is scoped'
  })

  await test('copy takes no body, and 404s on an unknown id', async () => {
    // It used to take `{ language }` and 400 without one. The library is Khmer
    // only, so there is nothing to send — and a leftover body must not become a
    // 400 for an app that has not been updated yet.
    for (const body of [undefined, '{}', JSON.stringify({ language: 'fr' })]) {
      const res = await api('/library/num-e/copy', { method: 'POST', token: alice.token, body })
      expect(
        res.status === 201 || res.status === 200,
        `expected a copy for body ${JSON.stringify(body)}, got ${res.status}`
      )
    }
    const unknown = await api('/library/no-such-dish/copy', { method: 'POST', token: alice.token })
    expect(unknown.status === 404, `expected 404, got ${unknown.status}`)
    return 'body ignored, 404 on the id'
  })

  // A book of its own for the bulk import: alice has copied two of the eight by
  // now, and "imported 8, skipped 0" is only a meaningful assertion on an empty
  // one. Torn down with the others.
  const carol = await makeUser('classics')

  await test('importing the whole library fills an empty book in one request', async () => {
    // Onboarding's "Begin with eight classics". A fresh account, so everything
    // lands and nothing is skipped.
    const res = await api('/library/import', { method: 'POST', token: carol.token })
    expect(res.status === 200, `expected 200, got ${res.status}`)
    expect(res.body.imported === LIBRARY.length, `imported ${res.body.imported}`)
    expect(res.body.skipped === 0, `skipped ${res.body.skipped}`)

    const all = await api('/recipes', { token: carol.token })
    expect(all.body.length === LIBRARY.length, `book holds ${all.body.length}`)
    // Ingredients and steps have to arrive with them — the batching writes them
    // in two separate statements keyed back by libraryId, which is exactly the
    // kind of thing that silently writes zero rows.
    const amok = all.body.find((r: any) => r.libraryId === 'fish-amok')
    expect(amok.title === 'អាម៉ុកត្រី', `imported as "${amok.title}"`)
    expect(amok.ingredients.length === 10, `amok has ${amok.ingredients.length} ingredients`)
    expect(amok.steps.length === 5, `amok has ${amok.steps.length} steps`)
    // Position is assigned server-side from the array index, and the batched
    // import writes all eight recipes' ingredients in one statement — which is
    // exactly where an off-by-one would put row 0 of the second recipe at the
    // end of the first.
    expect(amok.ingredients[0].name === 'ត្រីរ៉ស់', `first ingredient is "${amok.ingredients[0].name}"`)
    return `${res.body.imported} recipes, bodies intact`
  })

  await test('re-importing skips everything instead of duplicating it', async () => {
    // The resume-after-quit path: force-quitting between the write and
    // `onboardedAt` lands the user back on this screen.
    const res = await api('/library/import', { method: 'POST', token: carol.token })
    expect(res.status === 200, `expected 200, got ${res.status}`)
    expect(res.body.imported === 0, `imported ${res.body.imported} on a re-run`)
    expect(res.body.skipped === LIBRARY.length, `skipped ${res.body.skipped}`)

    const all = await api('/recipes', { token: carol.token })
    expect(all.body.length === LIBRARY.length, `book grew to ${all.body.length}`)
    return 'zero imported, book unchanged'
  })

  await test('re-importing after a rename still skips, rather than doubling the book', async () => {
    // The same trap the single copy has, at eight times the size. It used to be
    // reachable by switching language; now it is reachable by renaming, which
    // is something a user does to their own recipe on the first day. Skipping
    // by title would see a stranger and hand back sixteen recipes.
    const before = await api('/recipes', { token: carol.token })
    const kroeung = before.body.find((r: any) => r.libraryId === 'kroeung')
    const renamed = await api(`/recipes/${kroeung.id}`, {
      method: 'PUT',
      token: carol.token,
      body: JSON.stringify({ ...validRecipe({}), title: 'គ្រឿងរបស់ខ្ញុំ', photoUrl: kroeung.photoUrl }),
    })
    expect(renamed.status === 200, `rename failed: ${renamed.status}`)

    const res = await api('/library/import', { method: 'POST', token: carol.token })
    expect(res.body.imported === 0, `imported ${res.body.imported} after a rename`)
    const all = await api('/recipes', { token: carol.token })
    expect(all.body.length === LIBRARY.length, `book grew to ${all.body.length}`)
    return 'still eight'
  })

  await test('the library needs a token like everything else', async () => {
    for (const path of ['/library', '/library/fish-amok']) {
      const res = await api(path)
      expect(res.status === 401, `${path}: expected 401, got ${res.status}`)
    }
    return '401 without a session'
  })

  // ── Rate limiting (runs last: it deliberately exhausts the buckets) ───────
  group('13b. Atomic dinner-week drafts')
  let dinnerA: string
  let dinnerB: string
  let foreignDinner: string
  const draftWeek = '2026-11-09'
  const dinnerBatch = (entries: { date: string; recipeId: string }[], weekStart = draftWeek) => JSON.stringify({ weekStart, entries })
  await test('prepare dinner generation fixtures', async () => {
    const a = await api('/recipes', { method: 'POST', token: alice.token, body: JSON.stringify(validRecipe({ title: `Dinner A ${randomUUID()}` })) })
    const b = await api('/recipes', { method: 'POST', token: alice.token, body: JSON.stringify(validRecipe({ title: `Dinner B ${randomUUID()}` })) })
    const foreign = await api('/recipes', { method: 'POST', token: bob.token, body: JSON.stringify(validRecipe({ title: `Foreign dinner ${randomUUID()}` })) })
    expectStatus(a, 201); expectStatus(b, 201); expectStatus(foreign, 201)
    dinnerA = a.body.id; dinnerB = b.body.id; foreignDinner = foreign.body.id
  })
  await test('dinner drafts require authentication', async () => {
    expectStatus(await api('/meal-plan/week/dinners', { method: 'PUT', body: dinnerBatch([{ date: draftWeek, recipeId: dinnerA }]) }), 401)
  })
  await test('dinner draft dates are real, unique, within one Monday week and bounded', async () => {
    for (const body of [
      dinnerBatch([], draftWeek),
      dinnerBatch([{ date: draftWeek, recipeId: dinnerA }], '2026-11-10'),
      dinnerBatch([{ date: '2026-11-16', recipeId: dinnerA }]),
      dinnerBatch([{ date: '2026-11-31', recipeId: dinnerA }]),
      dinnerBatch([{ date: draftWeek, recipeId: dinnerA }, { date: draftWeek, recipeId: dinnerB }]),
      dinnerBatch(Array.from({ length: 8 }, () => ({ date: draftWeek, recipeId: dinnerA }))),
    ]) expectStatus(await api('/meal-plan/week/dinners', { method: 'PUT', token: alice.token, body }), 400)
  })
  await test('foreign recipes reject the entire draft without partial writes', async () => {
    const r = await api('/meal-plan/week/dinners', { method: 'PUT', token: alice.token, body: dinnerBatch([{ date: draftWeek, recipeId: dinnerA }, { date: '2026-11-10', recipeId: foreignDinner }]) })
    expectStatus(r, 404)
    const week = await api(`/meal-plan?from=${draftWeek}&to=2026-11-15`, { token: alice.token })
    expect(week.body.length === 0, 'foreign recipe caused partial save')
  })
  await test('dinner batch saves once and accepts an identical retry', async () => {
    const body = dinnerBatch([{ date: draftWeek, recipeId: dinnerA }, { date: '2026-11-10', recipeId: dinnerB }])
    for (let i = 0; i < 2; i++) {
      const r = await api('/meal-plan/week/dinners', { method: 'PUT', token: alice.token, body })
      expectStatus(r, 200); expect(r.body.length === 2, 'retry duplicated slots')
    }
  })
  await test('a changed slot aborts all new dinners and preserves the original', async () => {
    const r = await api('/meal-plan/week/dinners', { method: 'PUT', token: alice.token, body: dinnerBatch([{ date: draftWeek, recipeId: dinnerB }, { date: '2026-11-11', recipeId: dinnerA }]) })
    expectStatus(r, 409)
    const week = await api(`/meal-plan?from=${draftWeek}&to=2026-11-15`, { token: alice.token })
    expect(week.body.length === 2, 'conflict left a partially saved draft')
    expect(week.body.find((s: any) => s.date === draftWeek).recipeId === dinnerA, 'existing dinner overwritten')
  })
  await test('concurrent conflicting drafts leave a complete winning draft', async () => {
    const weekStart = '2026-12-07'
    const send = (recipeId: string) => api('/meal-plan/week/dinners', { method: 'PUT', token: alice.token, body: dinnerBatch([{ date: weekStart, recipeId }, { date: '2026-12-08', recipeId }], weekStart) })
    const responses = await Promise.all([send(dinnerA), send(dinnerB)])
    expect(responses.some(r => r.status === 200) && responses.some(r => r.status === 409), 'expected one winner and one conflict')
    const week = await api(`/meal-plan?from=${weekStart}&to=2026-12-13`, { token: alice.token })
    expect(week.body.length === 2 && new Set(week.body.map((s: any) => s.recipeId)).size === 1, 'concurrent save produced a mixed week')
    const other = await api(`/meal-plan?from=${weekStart}&to=2026-12-13`, { token: bob.token })
    expect(other.body.length === 0, 'another user can read the draft')
    const grocery = await api(`/grocery?from=${weekStart}&to=2026-12-13`, { token: alice.token })
    expectStatus(grocery, 200); expect(grocery.body.lines.length > 0, 'groceries did not derive from batch')
  })

  await test('mixed lunch/dinner drafts save fourteen slots and retry without changing breakfast', async () => {
    const weekStart = '2027-01-04'
    expectStatus(await api(`/meal-plan/${weekStart}/Breakfast`, { method: 'PUT', token: alice.token, body: JSON.stringify({ recipeId: dinnerA }) }), 200)
    const entries = Array.from({ length: 7 }, (_, day) => ['Lunch', 'Dinner'].map(mealtime => ({
      date: `2027-01-${String(4 + day).padStart(2, '0')}`, mealtime, recipeId: mealtime === 'Lunch' ? dinnerA : dinnerB,
    }))).flat()
    for (let i = 0; i < 2; i++) {
      const result = await api('/meal-plan/week/meals', { method: 'PUT', token: alice.token, body: JSON.stringify({ weekStart, entries }) })
      expectStatus(result, 200)
      expect(result.body.length === 15, 'both meals should save once alongside breakfast')
      expect(result.body.find((slot: any) => slot.mealtime === 'Breakfast').recipeId === dinnerA, 'breakfast changed')
      for (const entry of entries) expect(result.body.some((slot: any) => slot.date === entry.date && slot.mealtime === entry.mealtime && slot.recipeId === entry.recipeId), 'missing meal slot')
    }
    const foreign = await api('/meal-plan/week/meals', { method: 'PUT', token: bob.token, body: JSON.stringify({ weekStart, entries }) })
    expectStatus(foreign, 404)
  })
  await test('a conflicting dinner rolls back an earlier lunch change in a mixed draft', async () => {
    const weekStart = '2027-01-04'
    const result = await api('/meal-plan/week/meals', { method: 'PUT', token: alice.token, body: JSON.stringify({ weekStart, entries: [
      { date: weekStart, mealtime: 'Lunch', recipeId: dinnerB, expectedRecipeId: dinnerA },
      { date: weekStart, mealtime: 'Dinner', recipeId: dinnerA, expectedRecipeId: foreignDinner },
    ] }) })
    expectStatus(result, 409)
    const week = await api(`/meal-plan?from=${weekStart}&to=2027-01-10`, { token: alice.token })
    expect(week.body.find((slot: any) => slot.mealtime === 'Lunch' && slot.date === weekStart).recipeId === dinnerA, 'lunch change was not rolled back')
  })
  await test('explicit moves swap existing dinners atomically and retry safely', async () => {
    const body = JSON.stringify({ weekStart: draftWeek, entries: [
      { date: draftWeek, recipeId: dinnerB, expectedRecipeId: dinnerA },
      { date: '2026-11-10', recipeId: dinnerA, expectedRecipeId: dinnerB },
    ] })
    for (let i = 0; i < 2; i++) {
      const r = await api('/meal-plan/week/dinners', { method: 'PUT', token: alice.token, body })
      expectStatus(r, 200)
      expect(r.body.find((s: any) => s.date === draftWeek).recipeId === dinnerB, 'first day did not swap')
      expect(r.body.find((s: any) => s.date === '2026-11-10').recipeId === dinnerA, 'second day did not swap')
      expect(r.body.length === 2, 'swap duplicated slots')
    }
  })
  await test('stale move baselines abort the entire save', async () => {
    const body = JSON.stringify({ weekStart: draftWeek, entries: [
      { date: '2026-11-11', recipeId: dinnerA, expectedRecipeId: null },
      { date: draftWeek, recipeId: dinnerA, expectedRecipeId: dinnerA },
    ] })
    const r = await api('/meal-plan/week/dinners', { method: 'PUT', token: alice.token, body })
    expectStatus(r, 409)
    const week = await api(`/meal-plan?from=${draftWeek}&to=2026-11-15`, { token: alice.token })
    expect(week.body.length === 2 && !week.body.some((s: any) => s.date === '2026-11-11'), 'stale move left a partial save')
  })

  group('14. Rate limiting')

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

  /**
   * **Concurrent, not sequential, and that is the fix rather than a detail.**
   *
   * This used to `await` 200 requests one after another. Every one of them makes
   * a live `supabase.auth.getUser` call, so the loop ran at 250–600ms per
   * request — 50 to 120 seconds end to end. The limiter's window is 60 seconds
   * on a fixed reset, so a slow enough run spread those 200 requests across
   * *three* windows, none of which reached 100, and the test then failed having
   * proved nothing about the limiter. It was luck that it ever passed: the
   * green line read "throttled after 159", i.e. it was already straddling a
   * boundary and only just winning.
   *
   * Firing them concurrently lands them inside one window, and is a truer test
   * besides — a burst is what the limiter exists to stop, and a request every
   * quarter-second is not one. Batched rather than all at once so the dev server
   * isn't asked for 150 sockets in a single tick.
   */
  await test('the recipes API is throttled under a burst (limit 100 / min)', async () => {
    const BATCH = 25
    const BATCHES = 6 // 150 requests — comfortably over the 100/min limit
    let sent = 0
    let throttledAt = 0
    const started = Date.now()

    for (let batch = 0; batch < BATCHES && throttledAt === 0; batch++) {
      const responses = await Promise.all(
        Array.from({ length: BATCH }, () => api('/recipes', { token: alice.token }))
      )
      for (const res of responses) {
        sent += 1
        if (res.status === 429 && throttledAt === 0) throttledAt = sent
      }
    }

    const elapsed = (Date.now() - started) / 1000
    expect(
      throttledAt > 0,
      `sent ${sent} requests in ${elapsed.toFixed(1)}s without ever being throttled`
    )
    // A burst that outran the window proves nothing even when it goes green, so
    // say so rather than reporting a pass that isn't one.
    expect(elapsed < 60, `the burst took ${elapsed.toFixed(1)}s, longer than the limiter's window`)
    return `throttled after ${throttledAt} request(s), burst took ${elapsed.toFixed(1)}s`
  })

  await test('throttling applies before token verification (protects the Supabase call)', async () => {
    // The preceding burst can finish at the reset boundary. Exhaust a fresh
    // window with junk tokens too, rather than depending on its old bucket.
    const started = Date.now()
    let blocked = false
    for (let batch = 0; batch < 6 && !blocked; batch++) {
      const responses = await Promise.all(Array.from({ length: 25 }, () => api('/recipes', { token: 'garbage-token' })))
      for (const res of responses) {
        expect(res.status === 401 || res.status === 429, `unexpected junk-token status ${res.status}`)
        if (res.status === 429) blocked = true
      }
    }
    expect(Date.now() - started < 60000, 'junk-token burst exceeded the limiter window')
    expect(blocked, 'junk tokens never reached the limiter; token verification may run first')
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
