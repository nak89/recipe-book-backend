/**
 * Text folding for **comparison only** — the per-user title uniqueness rule.
 *
 * ## Why this exists
 *
 * Khmer is written without spaces between words, so word boundaries are marked
 * with an invisible zero-width space (U+200B), and most Khmer keyboards emit
 * them. Nothing you would reach for removes it: `.trim()` strips *visible*
 * whitespace and U+200B is Unicode category `Cf` (format) rather than `Zs`;
 * `.toLowerCase()` ignores it and Khmer has no case anyway; and `NFC` composes
 * marks without deleting characters.
 *
 * So two titles that are pixel-for-pixel identical on screen compare unequal —
 * which means the 409 never fires and the user ends up with two recipes that
 * look identically named and are told nothing about it.
 *
 * ## The one rule
 *
 * **Fold for comparison; never store the folded value.** In Khmer the ZWSP
 * carries line-breaking information, so stripping it from a saved title changes
 * how that title wraps. The stored title stays exactly as the user typed it.
 *
 * This is mirrored in the app's `src/lib/text.ts`. The two must agree, the same
 * way `MAX_RECIPE_BYTES` already has to — a title the app accepts as unique and
 * the server rejects (or vice versa) is worse than either rule alone.
 */

/**
 * Zero-width and invisible formatting characters.
 *
 * Written with `\u` escapes deliberately — the literal characters are invisible
 * in an editor, so a character class containing them is unreadable and one stray
 * paste away from being silently wrong.
 *
 * Covers soft hyphen, the zero-width space/non-joiner/joiner run, word joiner,
 * the BOM, and the two deprecated Khmer inherent vowels that still turn up in
 * older Khmer text.
 */
const INVISIBLE = /[­​-‍⁠﻿឴឵]/g

/**
 * Folds a string for comparison: invisible characters removed, canonically
 * composed, lowercased, trimmed.
 *
 * Use on **both sides** of every comparison — folding only one side finds
 * nothing when it's the other that carries the zero-width space.
 */
export function foldForCompare(value: string): string {
  return value.replace(INVISIBLE, '').normalize('NFC').trim().toLowerCase()
}
