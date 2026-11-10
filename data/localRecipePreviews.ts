import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { supabase } from '../supabase.js'
import type { LibraryRecipe } from './library.js'

const configuredOrigin = process.env.NODE_ENV !== 'production'
  ? process.env.LOCAL_RECIPE_PREVIEW_ORIGIN
  : undefined
const assetPath = new URL('./local-recipe-images/', import.meta.url)
export const explorePublicOrigin = process.env.EXPLORE_PUBLIC_ORIGIN
export const recipeImageDirectory = configuredOrigin || explorePublicOrigin ? fileURLToPath(assetPath) : undefined

export function readIllustratedRecipes(origin: string, preview = false): LibraryRecipe[] {
  const recipes = JSON.parse(readFileSync(new URL('./localRecipePreviews.json', import.meta.url), 'utf8')) as Omit<LibraryRecipe, 'photoUrl'>[]
  return recipes.map((recipe) => {
    if (!/^[a-z0-9-]+$/.test(recipe.id) || !existsSync(new URL(`${recipe.id}.jpg`, assetPath))) {
      throw new Error(`Missing or invalid recipe image for ${recipe.id}`)
    }
    return {
      ...recipe,
      ...(preview ? { localPreview: true as const } : {}),
      illustrated: true,
      photoUrl: new URL(`/local-recipe-images/${recipe.id}.jpg`, origin).href,
    }
  })
}

export const localRecipePreviews = configuredOrigin && !explorePublicOrigin
  ? readIllustratedRecipes(configuredOrigin, true)
  : []

// A saved copy uses the same account-owned storage as an ordinary upload, so
// its image remains available after the local preview server is switched off.
export async function storeLibraryPhoto(recipe: LibraryRecipe, userId: string) {
  const bucket = supabase.storage.from(process.env.SUPABASE_STORAGE_BUCKET ?? 'recipe-photos')
  const path = `${userId}/${randomUUID()}.jpg`
  const bytes = readFileSync(new URL(`${recipe.id}.jpg`, assetPath))
  const { error } = await bucket.upload(path, bytes, { contentType: 'image/jpeg' })
  if (error) throw error
  return {
    url: bucket.getPublicUrl(path).data.publicUrl,
    remove: () => bucket.remove([path]),
  }
}
