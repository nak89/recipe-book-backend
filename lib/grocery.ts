/**
 * Turning a week of meal plan into a shopping list.
 *
 * The list is **derived**, never stored: `GET /grocery` reads the week's slots,
 * walks their recipes' ingredients and sums them here. Nothing is written, so
 * changing Tuesday's dinner changes the list on the next read rather than
 * leaving a stale row behind that only a "rebuild" button could fix.
 *
 * What the database does hold is the two things this function cannot know — the
 * ticks and the hand-typed amount corrections, which are merged on top by the
 * route, and the manual items, which never come through here at all.
 */
import { foldForCompare } from './text.js'

export interface AggregatableIngredient {
  name: string
  quantity: number
  unit: string
  /** The `YYYY-MM-DD` of the slot this ingredient came from. */
  date: string
  /** The recipe the slot was filled with. */
  recipeId: string
}

/**
 * One contribution to a line: what a single dish, on a single day, asked for.
 *
 * This is the atom the whole line is built from, and it is sent down rather
 * than only the total because **every lens the app offers is a filter over
 * these**. A week's sum cannot be taken apart again once it has been added up,
 * so a screen narrowed to Tuesday — or to the amok — has nothing to narrow *by*
 * unless the pieces travel with it.
 *
 * The two axes are also asked for together ("what do I still need for the amok,
 * today"), which is why this is one list of atoms rather than a `byDate` map
 * beside a `byRecipe` one: two maps can each answer their own question and
 * neither can answer both, and a third map for the intersection is the point at
 * which you should have sent the atoms.
 *
 * Aggregated per `(date, recipeId)`, so the same dish planned for lunch *and*
 * dinner on one day is a single part carrying both meals' share.
 */
export interface LinePart {
  date: string
  recipeId: string
  amount: number
}

export interface DerivedLine {
  /** `foldForCompare(name)|foldForCompare(unit)` — the state row's address. */
  key: string
  /** As the user typed it, from the first ingredient that produced this line. */
  name: string
  unit: string
  /** The plan's own sum, before any override the user has typed over it. */
  planAmount: number
  /**
   * The same sum broken back out into the meals that made it — see `LinePart`.
   *
   * Only contributing `(date, recipeId)` pairs appear, so **presence is the
   * filter and the value is what to show once filtered**. Both halves matter: a
   * "Today" heading over the week's 550 g is a different wrong answer from a
   * chip that does nothing at all.
   */
  parts: LinePart[]
}

/**
 * The address of a line.
 *
 * Folded on both halves because Khmer keyboards emit zero-width spaces at word
 * boundaries: `ខ្ទឹមស` typed on two different days can differ by an invisible
 * character, and an unfolded key would put the same ingredient on two rows —
 * and strand the tick on whichever one redrew second. The pipe cannot appear in
 * either half after folding without being part of the user's own text, and a
 * name containing one merely groups with other names containing one in the same
 * position, which is harmless.
 *
 * Mirrored in the app's `src/lib/grocery.ts`; the two must agree, or a tick
 * written by the client lands on a key the server never derives.
 */
export function groceryKey(name: string, unit: string): string {
  return `${foldForCompare(name)}|${foldForCompare(unit)}`
}

/**
 * Sums ingredients into lines, one per (folded name, folded unit).
 *
 * **Same name, different unit stays separate.** `400 g` of tomatoes and `2`
 * tomatoes are not 402 of anything, and the units in this app are free text —
 * `cloves`, `tbsp`, `stalks`, `''` — so there is no conversion table to reach
 * for and inventing one would be a food-database project. Two rows is the
 * honest answer, and it is also what a shopper wants to read.
 *
 * **Slots, not recipes.** The same dinner planned on Monday and Thursday is two
 * dinners, so its ingredients count twice. Callers must therefore pass one
 * entry per *slot*, with the recipe's ingredients repeated — de-duplicating
 * recipes first would quietly under-buy for the week.
 */
export function aggregateIngredients(ingredients: AggregatableIngredient[]): DerivedLine[] {
  const lines = new Map<string, DerivedLine>()
  // `${lineKey}|${date}|${recipeId}` -> the part to add into. A second index
  // rather than a scan of `line.parts`, which is quadratic on the one shape
  // that matters — a staple appearing in every dish of the week.
  const parts = new Map<string, LinePart>()

  for (const ingredient of ingredients) {
    const key = groceryKey(ingredient.name, ingredient.unit)
    const existing = lines.get(key)
    if (existing) {
      existing.planAmount += ingredient.quantity
    } else {
      lines.set(key, {
        key,
        // First one in wins the display spelling. Any of them renders the same
        // to a reader — they only differ by the invisible characters the fold
        // removed — so there is nothing to choose between them.
        name: ingredient.name,
        unit: ingredient.unit,
        planAmount: ingredient.quantity,
        parts: [],
      })
    }

    const partKey = `${key}|${ingredient.date}|${ingredient.recipeId}`
    const part = parts.get(partKey)
    if (part) {
      part.amount += ingredient.quantity
    } else {
      const fresh = {
        date: ingredient.date,
        recipeId: ingredient.recipeId,
        amount: ingredient.quantity,
      }
      parts.set(partKey, fresh)
      lines.get(key)!.parts.push(fresh)
    }
  }

  // Sorted by the folded key so the list is stable between requests. Postgres
  // gives no order without ORDER BY and a Map preserves insertion order, which
  // would otherwise make the list re-shuffle whenever a slot was added.
  // The parts are sorted for the same reason and by the same argument: they
  // arrive in whatever order the slots did.
  for (const line of lines.values()) {
    line.parts.sort((a, b) => a.date.localeCompare(b.date) || a.recipeId.localeCompare(b.recipeId))
  }

  return [...lines.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * Floating-point sums drift: `0.1 + 0.2` is `0.30000000000000004`, and a
 * shopping list that asks for that has stopped being readable. Three decimals
 * is past any real ingredient's precision and short of the drift.
 */
export function roundAmount(value: number): number {
  return Math.round(value * 1000) / 1000
}
