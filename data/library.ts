// The shared recipe library behind Explore.
//
// Eight Cambodian recipes by Chef Nak (chefnak.com), transcribed 2026-08-14 and
// translated to Khmer 2026-08-21. Unlike `starterPacks.ts` — which a new account
// imports once and then owns — these stay on the server and are browsed. A user
// *copies* one into their book when they want it, which is why `libraryId`
// exists on Recipe.
//
// ## This file is Khmer, in one language only
//
// It used to be English with `titleKm`/`descriptionKm` beside it, and the client
// picked. It no longer is: title, description, headline, ingredients, steps,
// tools, cuisine and note are all Khmer, and there is no English left to fall
// back to. Cambodian recipes by a Cambodian chef, written in Khmer.
//
// Three consequences worth knowing before changing anything here:
//
//   - **The language toggle does not reach this content, because there is
//     nothing for it to choose between.** That is the app's ordinary rule, not
//     an exception to it — the toggle translates chrome and never content, and
//     these are content. An English UI shows Khmer recipes, exactly as it shows
//     a Khmer recipe the user wrote themselves.
//   - **`/library/:id/copy` and `/library/import` no longer take a language.**
//     They used to, because the language decided which title was stored. There
//     is one title now, so the body carries nothing and `copyLibrarySchema` is
//     gone. `Recipe.libraryId` still does the idempotency work it always did.
//   - **Explore's search reads one title, not two.** Someone typing "amok" in
//     Latin no longer finds អាម៉ុកត្រី. That was the cost of the change and it
//     was accepted; if it ever needs solving, the answer is a romanised search
//     key on each row, not a second English copy of the recipe.
//
// The Khmer was drafted here, not supplied by Chef Nak, and **the whole file is
// now owed a native reader** — not just the two strings that used to be. The
// technique vocabulary is where the risk is: បុក, លីង, ចំហុយ, ច្របាច់ and ជ្រលក់
// carry distinctions an English method flattens, and getting one wrong makes a
// step read as a different action rather than as an awkward one.
//
// ## Content rules
//
//   - Ingredient names must match the app's `src/data/ingredients.km.ts`
//     exactly, or `emojiForIngredient` silently renders that row without its
//     emoji and `aisleForIngredient` files it under Other. The ten names this
//     translation introduced were added there in the same change. (It was
//     `ingredients.ts` — the Latin pantry — before; the Latin entries added for
//     the English version of this file are left in place, since a user is still
//     free to write "Galangal" in their own recipe.)
//   - **Units follow the split `ingredients.km.ts` sets out**: measurement
//     abbreviations stay Latin (`g`, `ml`, `l`, `tbsp`, `tsp`) because that is
//     how Cambodian recipes actually write them and because the ingredient
//     row's unit column is a fixed 46pt that must not wrap; count-words are
//     Khmer (កំពិស, សន្លឹក, គ្រាប់, ចំណិត, ពែង, ផ្លែ, កណ្ដាប់). Every count-word
//     used here is one `data/units.km.ts` already knows.
//   - Numerals inside step prose are Khmer, because the prose is Khmer.
//     Ingredient quantities stay JS numbers and are rendered through the app's
//     `n()`, so those follow the reader's language rather than this file.
//   - Every photoUrl must be on a host in `validation.ts`'s allowlist. These are
//     on `images.squarespace-cdn.com`, which was added for them — a copied
//     recipe has to stay editable, and `PUT /recipes` re-validates the photoUrl
//     it is handed.
//   - `subject`, `mealtime` and `difficulty` stay **English stored values**.
//     They are enums the client translates through `i18n/labels.ts`, the same
//     arrangement `Mealtime` has everywhere else; a chip reading "បង្អែម" still
//     filters on `'Sweets'`. Do not translate them here.
//
// ## Where this differs from the source pages, and why
//
// Four places. Each is a gap in the source, confirmed on re-check rather than an
// extraction miss, and each is resolved here in the least inventive way:
//
//   1. Amok's "banana leaves + toothpicks (optional, traditional)" carries no
//      quantity because it is equipment, not food. It is in `tools`.
//   2. Num E's brown sugar has no stated quantity anywhere on the page. It is
//      set to 200 g — an estimate, marked below, and the one number in this file
//      that is not Chef Nak's.
//   3. Num E lists 700 g of sticky rice flour but the method only spends 400 g
//      (200 pandan + 200 beetroot). Pumpkin and taro are also listed and never
//      used. The likely reading is that two dough steps are missing from the
//      page; rather than invent them, the ingredients are transcribed as written
//      and the method is left as-is.
//   4. Meang Nem's final step wraps the salad in leafy greens that appear in no
//      ingredient list. The source treats them as an accompaniment brought to
//      the table, so they are not an ingredient here either.
//
// Quantities are normalised to grams and millilitres where the source used kg or
// lb, so a week's plan aggregates onto one grocery line instead of two. Nothing
// else about a quantity is changed.
//
// Servings take the **lower** bound of the source's range ("4-6" → 4). It is the
// promise the recipe can always keep.

/** The five chips under `BY SUBJECT`, minus All. */
export const SUBJECTS = ['Soups', 'Grilled', 'Sweets', 'Festival'] as const

export type Subject = (typeof SUBJECTS)[number]

export interface LibraryRecipe {
  /** Stable, and stored on a copied Recipe — see `Recipe.libraryId`. */
  id: string
  /** Khmer. There is no English title any more — see the note at the top. */
  title: string
  description: string
  photoUrl: string
  /**
   * The one ingredient that names the dish, for Explore's tile caption
   * ("ត្រីរ៉ស់ · ៤៥′").
   *
   * Authored rather than derived, because it cannot be derived: the first row of
   * an ingredient list is the biggest quantity, not the defining flavour, and
   * the browse payload deliberately carries no ingredients at all. One word per
   * recipe, naming what you would go to the market for.
   */
  headline: string
  /**
   * A stored English value the client translates, like `mealtime`. Null is a
   * real answer, not missing data: Lok Lak is sautéed and Kroeung is a paste;
   * neither is a soup, a grill or a sweet, and calling either a festival dish to
   * fill a chip would be inventing a claim about the food. They appear under
   * All, which is where a browse surface should show everything anyway.
   */
  subject: Subject | null
  /** Null for Kroeung, which is a component rather than a meal. */
  mealtime: 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack' | null
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced'
  cuisine: string
  totalMinutes: number
  servings: number
  tools: string[]
  /** [name, quantity, unit] — the tuple shape starterPacks.ts uses. */
  ingredients: [string, number, string][]
  steps: string[]
  /** Chef Nak's own closing note, shown under the method. */
  note: string
  /** The page this was transcribed from. Rendered as the attribution line. */
  source: string
}

const photo = (path: string) =>
  `https://images.squarespace-cdn.com/content/v1/62e142d43354ad73f5540791/${path}`

export const LIBRARY: LibraryRecipe[] = [
  {
    id: 'fish-amok',
    headline: 'ត្រីរ៉ស់',
    title: 'អាម៉ុកត្រី',
    description:
      'អាម៉ុកគឺជាម្ហូបមួយដែលខ្ញុំវិលត្រឡប់មករកម្ដងហើយម្ដងទៀត — មិនមែនព្រោះវាល្បីនោះទេ តែព្រោះវាផ្ទុកនូវព្រលឹងនៃការចម្អិនម្ហូបខ្មែរ។ គ្រឿង ទឹកដូងខាប់ និងត្រី ចំហុយរហូតទន់រលោងដូចសង់ខ្យា។',
    photoUrl: photo('166580b2-b9e5-4ec9-be14-2798bd32911e/Fish+Amok+by+Chef+Nak.jpeg'),
    subject: 'Festival',
    mealtime: 'Dinner',
    difficulty: 'Intermediate',
    cuisine: 'ខ្មែរ',
    totalMinutes: 45,
    servings: 4,
    // Banana leaves and toothpicks live here rather than in `ingredients`: the
    // source gives them no quantity because you do not eat them.
    tools: ['ឆ្នាំងចំហុយ', 'ចានលាយ', 'ស្លឹកចេក', 'ឈើចាក់ធ្មេញ'],
    ingredients: [
      ['ត្រីរ៉ស់', 1000, 'g'],
      ['គ្រឿង', 20, 'g'],
      ['ទឹកដូងខាប់', 320, 'g'],
      ['ម្ទេសក្រហមស្ងួតបុក', 80, 'g'],
      ['កាពិ', 10, 'g'],
      ['ស្ករត្នោត', 30, 'g'],
      ['អំបិល', 5, 'g'],
      ['ស៊ុតមាន់', 2, 'គ្រាប់'],
      ['ម្ទេសក្រហមវែង', 1, 'គ្រាប់'],
      ['ស្លឹកក្រូចសើច', 3, 'សន្លឹក'],
    ],
    steps: [
      'ចិតត្រីជាដុំៗទំហំ ២–៣ សង់ទីម៉ែត្រ ហើយទុកទឹកដូងខាប់ ២០ ក្រាមដាច់ដោយឡែក។ ចិតម្ទេសក្រហមជាសរសៃ រួចត្រាំក្នុងទឹកបន្តិចឱ្យវារួញ។ ចិតស្លឹកក្រូចសើចជាសរសៃតូចៗ។',
      'លាយគ្រឿង ម្ទេសបុក កាពិ ស្ករត្នោត អំបិល និងស៊ុត ឱ្យរលោង។ បន្ថែមទឹកដូងខាប់ រួចលាយសាច់ត្រីចូលដោយថ្នមៗ។ ទុកឱ្យជ្រាបរសជាតិ ១៥–២០ នាទី។',
      'កាត់ស្លឹកចេកជារង្វង់ ២៤ សន្លឹក (ទទឹង ១៥ សង់ទីម៉ែត្រ) ហើយផ្គុំពីរសន្លឹកម្ដងធ្វើជាពែង ចាក់ភ្ជាប់នឹងឈើចាក់ធ្មេញ។ ចាក់គ្រឿងផ្សំចូលត្រឹម ៨០ ភាគរយ។',
      'ចំហុយរយៈពេល ១០ នាទី។ ដាក់ទឹកដូងខាប់ ស្លឹកក្រូចសើច និងសរសៃម្ទេសពីលើ រួចចំហុយបន្ត ២ នាទីទៀត។',
      'ញ៉ាំក្ដៗ ជាមួយបាយសដាំចំហុយ។',
    ],
    note: 'លាយដោយថ្នមៗ និងចំហុយដោយប្រុងប្រយ័ត្ន — អាម៉ុកត្រីត្រូវតែទន់រលោង និងក្រអូប មិនមែនធ្ងន់ឡើយ។',
    source: 'https://www.chefnak.com/cambodian-fish-amok',
  },
  {
    id: 'beef-lok-lak',
    headline: 'ម្រេចកំពត',
    title: 'ឡុកឡាក់សាច់គោ',
    description:
      'សាច់គោចិញ្ច្រាំជាដុំ ឆារួចរៀបលើបន្លែស្រស់ ញ៉ាំជាមួយទឹកជ្រលក់ម្រេចខ្មៅកំពត ទឹកក្រូចឆ្មារ និងអំបិលសមុទ្រ។ ជាម្ហូបបុរាណមួយរបស់កម្ពុជាដែលទទួលឥទ្ធិពលពីបារាំង។',
    photoUrl: photo('2f0f38cd-7a57-4a3f-9d26-0e7c5b947004/Beef+Lok+Lak+by+Chef+Nak.jpeg'),
    subject: null,
    mealtime: 'Dinner',
    difficulty: 'Beginner',
    cuisine: 'ខ្មែរ',
    totalMinutes: 45,
    servings: 6,
    tools: ['ខ្ទះ', 'ត្បាល់បុក'],
    ingredients: [
      ['សាច់គោសាន់', 1000, 'g'],
      ['ខ្ទឹមស', 5, 'កំពិស'],
      ['ប្រេងឆា', 2, 'tbsp'],
      ['ស្ករត្នោត', 1.5, 'tbsp'],
      ['អំបិលសមុទ្រ', 1, 'tsp'],
      ['ស្រាឆាចិន', 2, 'tbsp'],
      ['ទឹកខ្យង', 2, 'tbsp'],
      ['ទឹកស៊ីអ៊ីវ', 2, 'tbsp'],
      ['ប្រេងល្ង', 1.5, 'tbsp'],
      ['សាឡាដ់', 500, 'g'],
      ['ប៉េងប៉ោះ', 400, 'g'],
      ['ខ្ទឹមបារាំង', 200, 'g'],
      ['ស៊ុតមាន់', 4, 'គ្រាប់'],
      // The sauce's salt, kept as its own row because it is used in a different
      // step. It shares a name with the marinade's but not a unit, so the
      // grocery list keeps them apart — the documented behaviour for free-text
      // units, and correct here.
      ['អំបិលសមុទ្រ', 1.5, 'tbsp'],
      ['ម្រេចកំពត', 1, 'tbsp'],
      ['ទឹកក្រូចឆ្មារ', 5, 'tbsp'],
    ],
    steps: [
      'ចៀនស៊ុតឱ្យសល់ពងក្រហម រួចទុកមួយអន្លើ។ ចិញ្ច្រាំខ្ទឹមសឱ្យម៉ត់។ លាងសាឡាដ់ឱ្យស្អាត ហើយទុកឱ្យស្ងួតទឹក។ ចិតខ្ទឹមបារាំង និងប៉េងប៉ោះជាចំណិតស្ដើងៗ។',
      'ចិតសាច់គោជាដុំទំហំ ២–៣ សង់ទីម៉ែត្រ។ ត្រាំជាមួយអំបិលសមុទ្រ ស្ករត្នោត ស្រាឆាចិន ទឹកខ្យង ទឹកស៊ីអ៊ីវ និងប្រេងល្ង។',
      'ដាំខ្ទះឱ្យក្ដៅខ្លាំងជាមួយប្រេងឆា។ ដាក់ខ្ទឹមសឆាឱ្យលឿងក្រអូប។ បន្ថែមសាច់គោដែលត្រាំរួចទាំងទឹកត្រាំ ហើយឆារយៈពេល ៥–៧ នាទី តាមកម្រិតឆ្អិនដែលចង់បាន។',
      'លីងម្រេចខ្មៅកំពតក្នុងខ្ទះស្ងួតលើភ្លើងមធ្យមតិច ២–៣ នាទី រហូតក្រអូប។ បុកម្រេចឱ្យម៉ត់ ដាក់ក្នុងចាន បន្ថែមអំបិលសមុទ្រ និងទឹកក្រូចឆ្មារ រួចលាយឱ្យសព្វ។',
      'រៀបសាឡាដ់ជាគ្រឹះលើចានបម្រើ បន្ថែមប៉េងប៉ោះ រួចខ្ទឹមបារាំង។ ដួសសាច់គោដាក់ពីលើបន្លែ ហើយដាក់ស៊ុតចៀនពីលើគេ។ ញ៉ាំជាមួយទឹកជ្រលក់ម្រេចកំពត និងបាយស។',
    ],
    note: 'ឆាលើភ្លើងខ្លាំង និងរហ័ស។ ឡុកឡាក់ឆ្ងាញ់បំផុតពេលសាច់គោនៅតែទន់ និងមានទឹកក្នុងសាច់ ជាមួយទឹកជ្រលក់ជូរឆ្ងាញ់ដែលកាត់ភាពខ្លាញ់។',
    source: 'https://www.chefnak.com/beef-lok-lak',
  },
  {
    id: 'num-e',
    headline: 'ស្លឹកតើយ',
    title: 'នំអី',
    description:
      'ម្សៅដំណើបលាយឱ្យរលោង ក្រឡុកជាដុំមូលតូចៗ ស្ងោររហូតអណ្ដែតឡើង រួចដាក់ក្នុងទឹកស៊ីរ៉ូទឹកដូង ស្ករក្រហម និងខ្ញី។ ក្រអូប ផ្អែមល្មម និងធ្វើឱ្យស្រណុកចិត្ត។',
    photoUrl: photo(
      '282a6ff0-867a-4a87-8d27-6831fdd21717/Chef+Nak%27s+Num+E+%28by+Veasna%291.jpeg'
    ),
    subject: 'Sweets',
    mealtime: 'Snack',
    difficulty: 'Intermediate',
    cuisine: 'ខ្មែរ',
    totalMinutes: 50,
    servings: 6,
    tools: ['ម៉ាស៊ីនកិន', 'ចង្រឹះ', 'ឆ្នាំង'],
    ingredients: [
      ['ម្សៅដំណើប', 700, 'g'],
      ['ស្លឹកតើយ', 7, 'សន្លឹក'],
      ['ប៊ីតរូត', 0.25, 'ផ្លែ'],
      ['ល្ពៅ', 100, 'g'],
      ['ត្រាវ', 100, 'g'],
      ['មៀន', 100, 'g'],
      ['ដូងឈូស', 200, 'g'],
      ['ទឹក', 3, 'l'],
      ['អំបិល', 0.5, 'tsp'],
      ['ខ្ញី', 5, 'ចំណិត'],
      ['ទឹកដូងខាប់', 3, 'ពែង'],
      // ESTIMATE. The source page gives no quantity for the brown sugar
      // anywhere, and `Ingredient.quantity` is a non-null Float, so a row cannot
      // say "to taste". 200 g is the only number in this file that is not Chef
      // Nak's — correct it rather than trusting it.
      ['ស្ករក្រហម', 200, 'g'],
    ],
    steps: [
      'ដាក់ទឹកដូងខាប់ក្នុងឆ្នាំងលើភ្លើងតូច ជាមួយស្លឹកតើយ ៣ សន្លឹក (ចិតជាសរសៃ) ស្ករក្រហម អំបិល និងខ្ញី។ ដាំឱ្យពុះ រួចដាំបន្ត ២ នាទីទៀត។ ដកស្លឹកតើយចេញ ហើយទុកឱ្យត្រជាក់។',
      'ចិញ្ច្រាំស្លឹកតើយ ៤ សន្លឹក កិនជាមួយទឹក ១/៤ ពែង រួចត្រងយកទឹក។ លាយម្សៅដំណើប ២០០ ក្រាមជាមួយទឹកស្លឹកតើយ ហើយច្របាច់ឱ្យរលោង។',
      'ចិតសំបកប៊ីតរូតចេញ ចិញ្ច្រាំ កិនជាមួយទឹក ១/៤ ពែង រួចត្រង។ លាយម្សៅដំណើប ២០០ ក្រាមជាមួយទឹកប៊ីតរូត ហើយច្របាច់ឱ្យរលោង។',
      'ដាំទឹក ៣ លីត្រឱ្យពុះ។ ក្រឡុកម្សៅជាដុំមូលទំហំប៉ុនគ្រាប់ពីងប៉ុង រួចដាក់ចូលទឹកពុះ។ ពេលអណ្ដែតឡើង ដួសយកមកដាក់ក្នុងទឹកកក។',
      'ដួសយកដុំម្សៅចេញឱ្យស្ងួតទឹក ដាក់ចូលទឹកស៊ីរ៉ូទឹកដូងដែលត្រជាក់ រួចកូរឱ្យសព្វ។ ដួសដាក់ចាន ញ៉ាំជាមួយមៀន និងដូងឈូស។',
    ],
    note: 'ចាក់ទឹកពណ៌បន្តិចម្ដងៗ — ម្សៅនីមួយៗស្រូបទឹកមិនដូចគ្នាទេ។ ម្សៅដែលល្អគឺរលោង និងទន់ងាយក្រឡុក មិនជាប់ដៃឡើយ។',
    source: 'https://www.chefnak.com/sticky-rice-balls-in-coconut-syrup',
  },
  {
    id: 'meang-nem',
    headline: 'ក្រូចឃ្វិច',
    title: 'មៀងណែម',
    description:
      'ភ្លាជូរផ្អែមដែលមានប្រវត្តិយូរលង់នៅកម្ពុជា ធ្លាប់ត្រូវបានរៀបចំ និងបម្រើនៅព្រះបរមរាជវាំង។ ម្សៅអង្ករលីងផ្ដល់ក្លិនក្រអូប ចំណែកបន្លែក្រអូប ខ្ទឹមប្រៃ និងទឹកជ្រលក់ជូរផ្ដល់រសជាតិដែលនៅសល់។',
    photoUrl: photo(
      '203dad16-5c42-4aca-82a4-e7a9024ffe0d/Chef+Nak%27s+Meang+Nem+Recipe%28by+Lamo%29.jpg'
    ),
    subject: 'Festival',
    mealtime: 'Lunch',
    difficulty: 'Intermediate',
    cuisine: 'ខ្មែរ',
    totalMinutes: 55,
    servings: 4,
    tools: ['ខ្ទះឆា', 'ត្បាល់បុក', 'ចង្រឹះ'],
    ingredients: [
      ['បង្គាងៀត', 50, 'g'],
      ['អង្ករ', 40, 'g'],
      ['ដូងឈូស', 100, 'g'],
      ['សំបកក្រូចឃ្វិច', 20, 'g'],
      ['ម្ទេស', 3, 'គ្រាប់'],
      ['សណ្តែកដីលីង', 50, 'g'],
      ['ក្បាលខ្ទឹមប្រៃ', 100, 'g'],
      ['ទឹកខ្ទឹមប្រៃ', 30, 'ml'],
      ['រំដេង', 25, 'g'],
      ['ខ្ទឹមក្រហម', 30, 'g'],
      ['ទឹកក្រូចឃ្វិច', 20, 'ml'],
      ['ទឹកក្រូចឆ្មារ', 50, 'ml'],
      ['ទឹកត្រី', 30, 'ml'],
      ['ស្ករត្នោត', 50, 'g'],
    ],
    steps: [
      'ធ្វើម្សៅអង្ករលីង។ លាងអង្ករ ហើយត្រាំ ១០ នាទី រួចចាក់ទឹកចោល។ ដាំខ្ទះឆាលើភ្លើងមធ្យម ដាក់អង្ករចូល ហើយកូរឥតឈប់រហូតមានពណ៌ត្នោតចាស់ និងក្រអូប ប្រហែល ៥ នាទី។ ទុកឱ្យត្រជាក់ រួចបុកឱ្យម៉ត់ ហើយរែងតាមចង្រឹះ។',
      'រៀបចំគ្រឿងក្រអូប និងលីងដូង។ ចិតខ្ទឹមក្រហមជាចំណិតស្ដើងតាមបណ្ដោយ។ ចិញ្ច្រាំរំដេង ក្បាលខ្ទឹមប្រៃ ម្ទេស និងសំបកក្រូចឃ្វិចឱ្យម៉ត់។ បុកសណ្តែកដីលីងឱ្យបែកជាគ្រាប់ធំៗ។ លីងដូងឈូសក្នុងខ្ទះលើភ្លើងតូច ២–៣ នាទី ដោយកូរជាប់។',
      'ធ្វើទឹកជ្រលក់។ ក្នុងចានធំ លាយទឹកក្រូចឆ្មារ ទឹកក្រូចឃ្វិច ស្ករត្នោត ទឹកខ្ទឹមប្រៃ និងទឹកត្រី។ កូររហូតស្កររលាយអស់។',
      'លាយចូលគ្នា។ ក្នុងចានលាយ ដាក់បង្គាងៀត ដូងលីង គ្រឿងក្រអូបចិញ្ច្រាំ និងទឹកជ្រលក់។ លាយឱ្យសព្វ។ បន្ថែមម្សៅអង្ករលីង រួចលាយម្ដងទៀត។ រោយសណ្តែកដីបុកពីលើ។',
      'រៀបលើចានធំ។ ភ្ញៀវដួសដាក់ចានតូចរបស់ខ្លួន រុំជាមួយស្លឹកបន្លែស្រស់ រួចញ៉ាំម្ដងមួយចំណិតៗ។',
    ],
    note: 'សម្រាប់អ្នកបួស សូមដកបង្គាងៀត និងទឹកត្រីចេញ ហើយប្រើទឹកស៊ីអ៊ីវជាមួយអំបិលសមុទ្របន្តិច ដោយរក្សាតុល្យភាពជូរផ្អែមដដែល។',
    source: 'https://www.chefnak.com/meang-nem',
  },
  {
    id: 'grilled-stuffed-squid',
    headline: 'មឹក',
    title: 'មឹកស្នូលសាច់ជ្រូកអាំង',
    description:
      'មឹកទន់ញាត់សាច់ជ្រូកចិញ្ច្រាំលាយគ្រឿង អាំងលើរងើកភ្លើងយឺតៗរហូតខាងក្រៅក្រៀមឈ្លក់។ ជាម្ហូបពិសេសមួយដែលកម្ពុជាស្រឡាញ់ ញ៉ាំជាមួយបន្លែស្រស់ និងទឹកជ្រលក់ជូរផ្អែម។',
    photoUrl: photo(
      '578d1fa7-c64e-4194-80b6-bfd5a7ec0f2d/Grilled+Stuffed+Squid+with+Kroeung+by+Chef+Nak+1.jpg'
    ),
    subject: 'Grilled',
    mealtime: 'Dinner',
    difficulty: 'Intermediate',
    cuisine: 'ខ្មែរ',
    totalMinutes: 70,
    servings: 6,
    tools: ['ចង្ក្រានធ្យូង', 'ចានលាយ', 'ឈើចាក់ធ្មេញ'],
    ingredients: [
      ['មឹក', 1500, 'g'],
      ['សាច់ជ្រូកបីជាន់ចិញ្ច្រាំ', 500, 'g'],
      ['គ្រឿង', 50, 'g'],
      ['ម្ទេសក្រហមបុក', 30, 'g'],
      ['សណ្តែកដីលីង', 50, 'g'],
      ['ស្លឹកក្រូចសើច', 5, 'សន្លឹក'],
      ['អំបិល', 4, 'g'],
      ['ស្ករស', 40, 'g'],
      ['ម្សៅសាច់មាន់', 10, 'g'],
    ],
    steps: [
      'រៀបចំមឹក។ សម្អាតឱ្យបានល្អ បំបែកក្បាលចេញពីខ្លួន ដកគ្រឿងក្នុងចេញ រួចលាងឱ្យស្អាត។ ដកចំពុះ និងភ្នែកចេញ ដោយរក្សាជើងមឹកឱ្យនៅដដែល រួចជូតឱ្យស្ងួតទឹក។',
      'ធ្វើស្នូល។ លាយសាច់ជ្រូកបីជាន់ចិញ្ច្រាំ គ្រឿង ម្ទេសក្រហមបុក សណ្តែកដីលីង ស្លឹកក្រូចសើច អំបិល ស្ករស និងម្សៅសាច់មាន់ក្នុងចាន។ លាយថ្នមៗឱ្យសព្វ ដោយកុំលាយជ្រុល។',
      'ញាត់មឹក។ ចាក់ស្នូលចូលខ្លួនមឹកត្រឹមប្រហែល ៩០ ភាគរយ ទុកចន្លោះខាងលើ។ ដាក់ជើងមឹកភ្ជាប់នៅមាត់រន្ធ រួចចាក់ឈើចាក់ធ្មេញឱ្យជាប់។',
      'អាំងលើរងើកភ្លើងយឺតៗរហូតទន់។ រៀបលើថាស ជាមួយបន្លែស្រស់ និងទឹកជ្រលក់ជូរផ្អែម។ ស្រោចប្រេងក្រអូបពីលើដើម្បីបន្ថែមក្លិន។',
    ],
    note: 'កុំញាត់មឹកជ្រុលពេក ហើយអាំងដោយអត់ធ្មត់។ លទ្ធផលល្អបំផុតគឺមឹកនៅតែទន់ ស្នូលនៅមានទឹក ចំណែកខាងក្រៅឈ្លក់ក្លិនផ្សែងល្មម។',
    source: 'https://www.chefnak.com/grilled-stuffed-squid-with-kroeung',
  },
  {
    id: 'fish-salad-coconut',
    headline: 'ដូងឈូស',
    title: 'ភ្លាមាត់ទឹក',
    description:
      'ត្រីជ្រលក់ទឹកក្រូចឆ្មារ ជាមួយដូងលីង បន្លែក្រអូប និងសណ្តែកដី — គេច្រើនហៅវាថាសេវីឆេមាត់ទឹក។ ជាម្ហូបផ្ដើមដ៏ស្រស់ ដែលត្រូវញ៉ាំភ្លាមក្រោយពេលលាយ ហើយច្រើនប្រើក្នុងពិធីបុណ្យ។',
    photoUrl: photo(
      'f9e10a42-df52-4a17-9aed-ad00fb21af9f/Fish+Salad+With+Shredded+Coconut.jpg'
    ),
    subject: 'Festival',
    mealtime: 'Lunch',
    difficulty: 'Intermediate',
    cuisine: 'ខ្មែរ',
    totalMinutes: 55,
    servings: 4,
    tools: ['ខ្ទះ', 'ចានលាយ'],
    ingredients: [
      ['ត្រីរ៉ស់', 500, 'g'],
      ['កាពិដុត', 15, 'g'],
      ['ជីរនាងវងផ្សំ', 50, 'g'],
      ['ដូងឈូស', 250, 'g'],
      ['ជីវ៉ាន់ស៊ុយ', 50, 'g'],
      ['សណ្តែកដីលីង', 50, 'g'],
      ['ទឹកក្រូចឆ្មារ', 175, 'ml'],
      ['អំបិល', 10, 'g'],
      ['ទឹកត្រី', 15, 'ml'],
      ['ស្ករត្នោត', 25, 'g'],
    ],
    steps: [
      'បុកសណ្តែកដីលីងឱ្យម៉ត់។ ដាំខ្ទះលើភ្លើងមធ្យម ដាក់ដូងឈូសចូល ហើយឆាប្រហែល ៥ នាទីរហូតមានពណ៌មាស និងក្រអូប។ រួចទុកមួយអន្លើ។',
      'ចិតត្រីជាចំណិតស្ដើងបំផុត។ លាយជាមួយទឹកក្រូចឆ្មារ ១៥០ មីលីលីត្រ និងអំបិល ៥ ក្រាមក្នុងចាន ដោយទុកទឹកក្រូចឆ្មារ ២៥ មីលីលីត្រ និងអំបិល ៥ ក្រាមសល់។ លាយថ្នមៗ ហើយទុកឱ្យជ្រាបប្រហែល ១៥ នាទីរហូតសាច់រឹង និងស។ បន្ទាប់មកច្របាច់ត្រីថ្នមៗឱ្យចេញទឹកក្រូចប្រហែល ៨០ ភាគរយ។',
      'ដាក់ត្រីដែលច្របាច់រួចចូលចានលាយ។ បន្ថែមដូងលីង កាពិដុត ទឹកត្រី ស្ករត្នោត និងអំបិលជាមួយទឹកក្រូចឆ្មារដែលនៅសល់។ លាយឱ្យសព្វ។',
      'រៀបភ្លាលើចានធំ។ រោយសណ្តែកដីបុក បន្លែក្រអូប និងជីវ៉ាន់ស៊ុយពីលើ មុនពេលបម្រើភ្លាមៗ។',
    ],
    note: 'ចិតត្រីឱ្យស្ដើងតាមដែលអាចធ្វើបាន ហើយបម្រើភ្លាមៗ — ភ្លានេះឆ្ងាញ់បំផុតពេលវានៅស្រស់។',
    source: 'https://www.chefnak.com/fish-salad-with-shredded-coconut',
  },
  {
    id: 'chicken-emerald-soup',
    headline: 'សណ្តែកកួរ',
    title: 'សម្លមរកត',
    description:
      'ដាក់ឈ្មោះតាមពណ៌បៃតងភ្លឺដូចត្បូងនៃសណ្តែកកួរ។ សណ្តែកទន់ក្នុងទឹកដូង ដែលលាយក្លិនរំដេង ស្លឹកគ្រៃ ស្លឹកក្រូចសើច និងបន្លែក្រអូប ជាមួយកាពិ។ ជាការបង្ហាញភាពឆើតឆាយដ៏កម្រនៃម្ហូបខ្មែរ។',
    photoUrl: photo(
      'd1b2a2d1-6795-4c14-9092-0229245053d1/Chicken+Emerald+Soup+%28Samlor+Morokot%29+from+Chef+Nak%E2%80%99s+SAOY+cookbook+.jpg'
    ),
    subject: 'Soups',
    mealtime: 'Dinner',
    difficulty: 'Intermediate',
    cuisine: 'ខ្មែរ',
    totalMinutes: 60,
    servings: 4,
    tools: ['ត្បាល់បុក', 'ឆ្នាំង'],
    ingredients: [
      ['សាច់មាន់', 500, 'g'],
      ['កាពិ', 10, 'g'],
      ['ម្ទេសផ្លោកបៃតង', 225, 'g'],
      // 2 lb, converted. Everything else in this file is metric at source.
      ['សណ្តែកកួរ', 900, 'g'],
      ['ទឹកដូងខាប់', 100, 'ml'],
      ['ទឹកដូង', 500, 'ml'],
      ['ជីរនាងវង', 1, 'កណ្ដាប់'],
      ['ស្លឹកក្រូចសើច', 5, 'សន្លឹក'],
      ['សំបកក្រូចសើច', 2, 'g'],
      ['ស្លឹកគ្រៃ', 25, 'g'],
      ['ឫសជីវ៉ាន់ស៊ុយ', 5, 'g'],
      ['រំដេង', 10, 'g'],
      ['ខ្ទឹមស', 20, 'g'],
      ['ខ្ទឹមក្រហម', 40, 'g'],
      ['ស្ករត្នោត', 20, 'g'],
      ['ម្រេចខ្មៅ', 2, 'g'],
      ['អំបិល', 2, 'g'],
      ['ទឹកត្រី', 15, 'ml'],
    ],
    steps: [
      'ចិតសាច់មាន់ជាដុំតូចៗប្រហែល ១,៥ សង់ទីម៉ែត្រ។ បកសណ្តែកកួរយកគ្រាប់ចេញពីសំបក។ ចិតស្លឹកគ្រៃ ខ្ទឹមក្រហម និងខ្ទឹមសជាចំណិតស្ដើង។ ចិញ្ច្រាំឫសជីវ៉ាន់ស៊ុយ និងសំបកក្រូចសើចឱ្យម៉ត់។',
      'បុកស្លឹកគ្រៃ ខ្ទឹមក្រហម ខ្ទឹមស ឫសជីវ៉ាន់ស៊ុយ សំបកក្រូចសើច រំដេង កាពិ អំបិល និងម្រេចខ្មៅ ឱ្យទៅជាគ្រឿងម៉ត់។',
      'ដាំទឹកដូងខាប់ក្នុងឆ្នាំងមធ្យមឱ្យពុះថ្នមៗ។ ដាក់គ្រឿងចូល ហើយឆារហូតក្រអូប។ បន្ថែមសាច់មាន់ កូរឱ្យសព្វ រួចដាំបន្ត ៣ នាទី។ ចាក់ទឹកដូងចូល ហើយដាំឱ្យពុះឡើងវិញ។',
      'ដាក់សណ្តែកកួរ ទឹកត្រី និងស្ករត្នោត។ ដាំឱ្យពុះ រួចបិទភ្លើង។ បន្ថែមម្ទេសផ្លោកបៃតងចិត។ បញ្ចប់ដោយស្លឹកក្រូចសើចចិតជាសរសៃ និងជីរនាងវង។',
      'ដួសដាក់ចាន រួចលម្អដោយជីរនាងវង និងស្លឹកក្រូចសើចបន្ថែម។',
    ],
    note: 'រក្សាសណ្តែកកួរឱ្យនៅបៃតងភ្លឺ — ដាំឱ្យពុះខ្លីៗ រួចបិទភ្លើងភ្លាម ដើម្បីឱ្យសម្លនៅមានពណ៌មរកត និងស្រស់។',
    source: 'https://www.chefnak.com/chicken-emerald-soup',
  },
  {
    id: 'kroeung',
    headline: 'ស្លឹកគ្រៃ',
    title: 'គ្រឿង',
    description:
      'គ្រឿងស្លឹកគ្រៃដែលជាមូលដ្ឋាននៃម្ហូបខ្មែរស្ទើរទាំងអស់ — រំដេង រមៀត ក្រូចសើច ខ្ទឹមស និងខ្ទឹមក្រហម បុកជាមួយគ្នា។ បានប្រហែល ៣០០ ក្រាម ឬប្រើបានពី ៧ ទៅ ១០ ដង។ ម្ហូបបីក្នុងបណ្ណាល័យនេះចាប់ផ្ដើមពីវា។',
    photoUrl: photo('3f54eaf9-d4de-4dad-b06d-3a7093aef9ad/Kroeung+%28Lemongrass+Paste%29.jpg'),
    subject: null,
    mealtime: null,
    difficulty: 'Intermediate',
    cuisine: 'ខ្មែរ',
    totalMinutes: 30,
    // The source gives a yield — 300 g, 7–10 uses — and no number of people. One
    // use is the closest thing to a serving a paste has, so this is the middle
    // of that range rather than a guess about a table.
    servings: 8,
    tools: ['ត្បាល់បុក'],
    ingredients: [
      ['សំបកក្រូចសើច', 2, 'g'],
      ['ស្លឹកក្រូចសើច', 6, 'g'],
      ['រមៀតស្រស់', 15, 'g'],
      ['រំដេង', 39, 'g'],
      ['ខ្ទឹមស', 60, 'g'],
      ['ខ្ទឹមក្រហម', 90, 'g'],
      ['ស្លឹកគ្រៃ', 90, 'g'],
    ],
    steps: [
      'បុករំដេងឱ្យម៉ត់ រួចបន្ថែមសំបក និងស្លឹកក្រូចសើច បុកបន្តរហូតលាយចូលគ្នាបានល្អ។',
      'បន្ថែមស្លឹកគ្រៃចិត ហើយបុករហូតគ្រឿងម៉ត់ និងក្រអូប។',
      'បន្ថែមរមៀត ហើយបុករហូតគ្រឿងមានពណ៌លឿងមាសស្មើគ្នា។',
      'បន្ថែមខ្ទឹមស រួចខ្ទឹមក្រហម បុកឱ្យបានហ្មត់ចត់បន្ទាប់ពីដាក់នីមួយៗ រហូតគ្រឿងស្មើគ្នា។',
      'ដាក់ចូលថង់ ឬកែវបិទជិត រួចទុកក្នុងទូត្រជាក់ ឬទូកកបាំង។',
    ],
    note: 'ដើម្បីបានក្លិនក្រអូបជ្រៅបំផុត សូមបុកគ្រឿងដោយត្បាល់បុកដៃ ជាជាងប្រើម៉ាស៊ីនកិន។',
    source: 'https://www.chefnak.com/cambodian-kroeung',
  },
]

export const LIBRARY_IDS = LIBRARY.map((r) => r.id)

/**
 * The browse payload — everything Explore's list needs and nothing it doesn't.
 *
 * One language now, so there is nothing for the client to pick between; the
 * endpoint was already language-agnostic and stays that way. Ingredients and
 * steps are left out: a browse response carrying eight full methods is the
 * largest thing this API would send, and the detail route is one tap away.
 */
export function librarySummaries() {
  return LIBRARY.map(({ ingredients, steps, note, ...rest }) => rest)
}

export function libraryRecipe(id: string): LibraryRecipe | undefined {
  return LIBRARY.find((r) => r.id === id)
}

/**
 * The **read** payload — `libraryRecipe` with its ingredient tuples named.
 *
 * `[name, quantity, unit]` is a *storage* shape, inherited from
 * `starterPacks.ts` so that eight full recipes stay readable in a source file.
 * It is not a wire shape. Spreading a recipe straight into the response sent the
 * app `['ត្រីរ៉ស់', 800, 'g']` where it expected `{ name, quantity, unit }`, so
 * every read of `ingredient.name` was `undefined` and the detail screen threw on
 * the first one it folded. The copy routes already unpack the tuples on their
 * way into Prisma; this is the same unpacking for the route that only reads.
 * Nothing should serve `LIBRARY` rows unmapped.
 */
export function libraryDetail(id: string) {
  const recipe = libraryRecipe(id)
  if (!recipe) return undefined
  const { ingredients, ...rest } = recipe
  return {
    ...rest,
    ingredients: ingredients.map(([name, quantity, unit]) => ({ name, quantity, unit })),
  }
}
