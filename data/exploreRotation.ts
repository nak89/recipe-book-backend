import type { LibraryRecipe } from './library.js'

const cambodiaDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Phnom_Penh',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
})

export function dailyExplore(recipes: readonly LibraryRecipe[], schedule: readonly string[][], now = new Date()) {
  const parts = cambodiaDate.formatToParts(now)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const day = Number(parts.find((part) => part.type === 'day')?.value)
  const ids = new Set(recipes.map((recipe) => recipe.id))
  const featuredIds = (schedule[day - 1] ?? []).filter((id) => ids.has(id)).slice(0, 6)
  for (const { id } of recipes) {
    if (featuredIds.length === 6) break
    if (!featuredIds.includes(id)) featuredIds.push(id)
  }
  // Phnom Penh is UTC+7. Convert the next local midnight to a UTC instant.
  const nextChangeAt = new Date(Date.UTC(year, month - 1, day + 1, -7)).toISOString()
  return { featuredIds, nextChangeAt }
}
