import assert from 'node:assert/strict'
import test from 'node:test'
import { dailyExplore } from '../data/exploreRotation.js'
import { LIBRARY } from '../data/library.js'
import schedule from '../data/exploreSchedule.json'
import illustrated from '../data/localRecipePreviews.json'

const recipes = [...LIBRARY, ...illustrated.map((recipe) => ({
  ...LIBRARY[0],
  id: recipe.id,
}))]

test('Cambodia midnight advances the daily selection, including leap-day rollover', () => {
  const before = dailyExplore(recipes, schedule, new Date('2028-02-29T16:59:59Z'))
  const after = dailyExplore(recipes, schedule, new Date('2028-02-29T17:00:00Z'))
  assert.deepEqual(before.featuredIds, schedule[28])
  assert.equal(before.nextChangeAt, '2028-02-29T17:00:00.000Z')
  assert.deepEqual(after.featuredIds, schedule[0])
  assert.equal(after.nextChangeAt, '2028-03-01T17:00:00.000Z')
})

test('the published schedule covers the entire catalogue across 31 distinct pages', () => {
  assert.equal(recipes.length, 64)
  assert.deepEqual(new Set(schedule.flat()), new Set(recipes.map((recipe) => recipe.id)))
  const pages = Array.from({ length: 31 }, (_, i) =>
    dailyExplore(recipes, schedule, new Date(Date.UTC(2026, 0, i + 1, 12))).featuredIds)
  assert.ok(pages.every((ids) => ids.length === 6 && new Set(ids).size === 6))
  assert.equal(new Set(pages.map((ids) => [...ids].sort().join(','))).size, 31)
})
