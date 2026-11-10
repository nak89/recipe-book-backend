import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dinnerWeekSchema, mealWeekSchema } from '../validation.js'

const weekStart = '2026-11-09'
const recipeId = '11111111-1111-4111-8111-111111111111'
const entries = Array.from({ length: 7 }, (_, day) => ['Breakfast', 'Lunch', 'Dinner'].map(mealtime => ({
  date: `2026-11-${String(9 + day).padStart(2, '0')}`, mealtime, recipeId, expectedRecipeId: null,
}))).flat()

test('a full week accepts twenty-one distinct breakfast, lunch and dinner slots', () => {
  assert.equal(mealWeekSchema.parse({ weekStart, entries }).entries.length, 21)
})

test('meal weeks reject duplicates, missing mealtimes, snack and out-of-week dates', () => {
  for (const invalid of [
    [entries[0], entries[0]],
    [{ date: weekStart, recipeId }],
    [{ ...entries[0], recipeId: null }],
    [{ ...entries[0], mealtime: 'Snack' }],
    [{ ...entries[0], date: '2026-11-16' }],
    [...entries, entries[0]],
    [],
  ]) assert.equal(mealWeekSchema.safeParse({ weekStart, entries: invalid }).success, false)
  assert.equal(mealWeekSchema.safeParse({ weekStart: '2026-11-10', entries }).success, false)
})

test('meal weeks retain concurrency baselines and require valid recipe ids', () => {
  assert.equal(mealWeekSchema.parse({ weekStart, entries: [{ ...entries[0], expectedRecipeId: recipeId }] }).entries[0].expectedRecipeId, recipeId)
  assert.equal(mealWeekSchema.safeParse({ weekStart, entries: [{ ...entries[0], recipeId: 'invalid' }] }).success, false)
})

test('legacy dinner drafts default to dinner and cannot write a lunch', () => {
  assert.equal(dinnerWeekSchema.parse({ weekStart, entries: [{ date: weekStart, recipeId }] }).entries[0].mealtime, 'Dinner')
  assert.equal(dinnerWeekSchema.safeParse({ weekStart, entries: [entries[0]] }).success, false)
})

test('a removal requires the recipe that occupied the slot and legacy dinner writes reject removal', () => {
  const removal = { date: weekStart, mealtime: 'Breakfast', recipeId: null, expectedRecipeId: recipeId }
  assert.equal(mealWeekSchema.parse({ weekStart, entries: [removal] }).entries[0].recipeId, null)
  assert.equal(dinnerWeekSchema.safeParse({ weekStart, entries: [{ ...removal, mealtime: 'Dinner' }] }).success, false)
})
