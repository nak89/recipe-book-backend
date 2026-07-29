// Minimal test harness — no framework, just fetch and assertions, so this runs
// with `npx tsx tests/run.ts` against a live server.
//
// Tests are grouped and printed as they run. Nothing here mocks anything: it
// talks to the real API, the real Supabase project and the real database, then
// cleans up after itself.

export const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3100'

const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const grey = (s: string) => `\x1b[90m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`

export interface Result {
  group: string
  name: string
  passed: boolean
  detail: string
}

export const results: Result[] = []
let currentGroup = 'ungrouped'

export function group(name: string) {
  currentGroup = name
  console.log(`\n${bold(name)}`)
}

export async function test(name: string, fn: () => Promise<string | void>) {
  try {
    const detail = (await fn()) ?? ''
    results.push({ group: currentGroup, name, passed: true, detail })
    console.log(`  ${green('PASS')}  ${name}${detail ? grey(`  — ${detail}`) : ''}`)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    results.push({ group: currentGroup, name, passed: false, detail })
    console.log(`  ${red('FAIL')}  ${name}\n        ${red(detail)}`)
  }
}

export function expect(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

export function expectStatus(res: { status: number }, expected: number, context = '') {
  if (res.status !== expected) {
    throw new Error(`expected ${expected}, got ${res.status}${context ? ` (${context})` : ''}`)
  }
}

export interface ApiResponse<T = any> {
  status: number
  body: T
  headers: Headers
  raw: string
}

/** Fetch that never throws on a bad body — the raw text is kept so a test can
 *  assert the server answered JSON rather than an HTML error page. */
export async function api(
  path: string,
  options: RequestInit & { token?: string; rawBody?: RequestInit['body'] } = {}
): Promise<ApiResponse> {
  const { token, rawBody, ...init } = options
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers, body: rawBody ?? init.body })
  const raw = await res.text()
  let body: any = null
  try {
    body = raw ? JSON.parse(raw) : null
  } catch {
    body = null
  }
  return { status: res.status, body, headers: res.headers, raw }
}

export function summary() {
  const passed = results.filter((r) => r.passed).length
  const failed = results.length - passed
  console.log(`\n${bold('─'.repeat(60))}`)
  console.log(`${bold('Total')}  ${results.length}   ${green(`${passed} passed`)}   ${failed ? red(`${failed} failed`) : '0 failed'}`)
  if (failed) {
    console.log(`\n${bold(red('Failures'))}`)
    for (const r of results.filter((x) => !x.passed)) {
      console.log(`  ${red('✗')} [${r.group}] ${r.name}\n      ${grey(r.detail)}`)
    }
  }
  return failed
}

/** A valid recipe body — spread and override to build invalid variants. */
export function validRecipe(overrides: Record<string, unknown> = {}) {
  return {
    title: `QA Test Recipe ${Math.random().toString(36).slice(2, 10)}`,
    description: 'Created by the automated QA suite',
    photoUrl: 'https://images.unsplash.com/photo-1612874742237-6526221588e3',
    difficulty: 'Beginner',
    totalMinutes: 25,
    servings: 2,
    cuisine: 'Italian',
    mealtime: 'Dinner',
    tools: ['pan', 'whisk'],
    ingredients: [
      { name: 'eggs', quantity: 2, unit: 'whole' },
      { name: 'butter', quantity: 10, unit: 'g' },
    ],
    steps: [
      { stepNumber: 1, instruction: 'Beat the eggs' },
      { stepNumber: 2, instruction: 'Melt the butter and cook' },
    ],
    ...overrides,
  }
}

/** 1x1 transparent PNG. */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

export const MALICIOUS_SVG = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.domain)"><script>alert(1)</script></svg>`
)
