// Starter recipe packs, offered once during onboarding so a new account doesn't
// open onto an empty grid.
//
// Content lives here rather than in the app for one reason: the app can't send
// it. `express.json` caps a body at 100kb and fifteen full recipes is well past
// that, so the client posts pack *ids* and the server expands them. That also
// makes the whole import one transaction instead of fifteen round-trips, each
// of which would otherwise cost its own live `supabase.auth.getUser()` call.
//
// Two content rules are inherited from `prisma/seed-dummy.ts` and are not
// stylistic:
//
//   - Ingredient names must match `src/data/ingredients.ts` in the app, and
//     cuisines must match `src/data/cuisines.ts`. `emojiForIngredient` and
//     `emojiForCuisine` look up by name, so a different spelling silently
//     renders that row without its emoji.
//   - Every photoUrl is on images.unsplash.com, the one third-party host the
//     photoUrl allowlist accepts. A recipe imported from here must still be
//     editable and re-savable from the app afterwards, and a PUT re-validates
//     the photoUrl it was given.
//
// Titles here are deliberately disjoint from seed-dummy's twenty. They overlap
// conceptually but never by name, so a developer account holding the dummy set
// still exercises the real import path rather than the skip path.

/** Per serving, like every other nutrition value in this codebase. */
interface Nutrition {
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
}

export interface StarterRecipe extends Nutrition {
  title: string
  description: string
  photoUrl: string
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced'
  mealtime: 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack'
  cuisine: string
  totalMinutes: number
  servings: number
  tools: string[]
  /** [name, quantity, unit] — same tuple shape seed-dummy.ts uses. */
  ingredients: [string, number, string][]
  steps: string[]
}

export interface StarterPack {
  id: string
  name: string
  emoji: string
  blurb: string
  /**
   * Khmer card copy, sent alongside the English so the endpoint stays
   * language-agnostic and the client picks.
   *
   * Only the **card** is translated. The fifteen recipes themselves stay
   * English in both languages: the import skips by title, so shipping Khmer
   * recipe variants would let someone who imports in English and re-imports in
   * Khmer end up with thirty recipes instead of fifteen. Pairing the variants by
   * pack id would fix that, and it's the thing to do if these are ever
   * translated — but it's real work, not a one-line change.
   */
  nameKm: string
  blurbKm: string
  recipes: StarterRecipe[]
}

const photo = (id: string) => `https://images.unsplash.com/${id}?w=1200&q=80`

export const STARTER_PACKS: StarterPack[] = [
  {
    id: 'southeast-asian',
    name: 'Southeast Asian',
    emoji: '🍜',
    blurb: 'Big herbs, sharp limes and a lot of garlic.',
    nameKm: 'អាស៊ីអាគ្នេយ៍',
    blurbKm: 'គ្រឿងស្លឹកច្រើន ក្រូចឆ្មារជូរ និងខ្ទឹមសច្រើន។',
    recipes: [
      {
        title: 'Chicken Satay Skewers',
        description: 'Charred, turmeric-marinated chicken with a thick peanut sauce.',
        photoUrl: photo('photo-1567620905732-2d1ec7ab7445'),
        difficulty: 'Beginner',
        mealtime: 'Dinner',
        cuisine: 'Indonesian',
        totalMinutes: 40,
        servings: 4,
        tools: ['skewers', 'grill pan', 'blender'],
        ingredients: [
          ['Chicken thigh', 700, 'g'],
          ['Peanuts', 150, 'g'],
          ['Coconut milk', 200, 'ml'],
          ['Turmeric', 2, 'tsp'],
          ['Garlic', 4, 'cloves'],
          ['Soy sauce', 3, 'tbsp'],
          ['Lime', 1, 'whole'],
        ],
        steps: [
          'Cut the chicken into strips and toss with turmeric, half the garlic and the soy sauce.',
          'Marinate for at least 20 minutes while you soak the skewers.',
          'Blitz the peanuts with the coconut milk and remaining garlic into a loose sauce.',
          'Thread the chicken and grill hot, 3 minutes a side, until the edges catch.',
          'Warm the sauce through and serve with lime to squeeze over.',
        ],
        calories: 520,
        protein: 42,
        carbs: 14,
        fat: 33,
      },
      {
        title: 'Beef Rendang',
        description: 'Slow-cooked until the sauce dries onto the meat and turns glossy.',
        photoUrl: photo('photo-1504674900247-0877df9cc836'),
        difficulty: 'Advanced',
        mealtime: 'Dinner',
        cuisine: 'Malaysian',
        totalMinutes: 180,
        servings: 6,
        tools: ['heavy pot', 'blender'],
        ingredients: [
          ['Beef', 1200, 'g'],
          ['Coconut milk', 800, 'ml'],
          ['Lemongrass', 3, 'stalks'],
          ['Ginger', 40, 'g'],
          ['Chilli', 8, 'whole'],
          ['Garlic', 6, 'cloves'],
          ['Cinnamon', 1, 'stick'],
        ],
        steps: [
          'Blend the chilli, garlic, ginger and lemongrass into a rough paste.',
          'Fry the paste in a dry heavy pot until it darkens and smells sweet.',
          'Add the beef and turn it through the paste to coat every side.',
          'Pour in the coconut milk, add the cinnamon and bring to a bare simmer.',
          'Cook uncovered for two and a half hours, stirring more often as it thickens.',
          'It is done when the sauce has dried onto the meat and the oil separates.',
        ],
        calories: 610,
        protein: 45,
        carbs: 11,
        fat: 43,
      },
      {
        title: 'Nasi Goreng',
        description: 'Yesterday’s rice, fried hard, with a fried egg on top.',
        photoUrl: photo('photo-1498654896293-37aacf113fd9'),
        difficulty: 'Beginner',
        mealtime: 'Lunch',
        cuisine: 'Indonesian',
        totalMinutes: 20,
        servings: 2,
        tools: ['wok'],
        ingredients: [
          ['Rice', 400, 'g'],
          ['Egg', 2, 'whole'],
          ['Prawns', 150, 'g'],
          ['Garlic', 3, 'cloves'],
          ['Chilli sauce', 2, 'tbsp'],
          ['Soy sauce', 2, 'tbsp'],
          ['Spring onion', 3, 'stalks'],
        ],
        steps: [
          'Use cold rice — fresh rice steams instead of frying and turns to paste.',
          'Get the wok properly hot, then fry the garlic for a few seconds only.',
          'Add the prawns, then the rice, pressing it flat to let it catch.',
          'Season with the chilli and soy sauce and toss until every grain is coloured.',
          'Fry the eggs separately and slide one onto each bowl.',
        ],
        calories: 540,
        protein: 26,
        carbs: 78,
        fat: 14,
      },
      {
        title: 'Tom Yum Goong',
        description: 'Hot and sour prawn soup, ready in the time it takes to boil stock.',
        photoUrl: photo('photo-1585032226651-759b368d7246'),
        difficulty: 'Beginner',
        mealtime: 'Lunch',
        cuisine: 'Thai',
        totalMinutes: 25,
        servings: 4,
        tools: ['saucepan'],
        ingredients: [
          ['Prawns', 400, 'g'],
          ['Stock', 1200, 'ml'],
          ['Lemongrass', 2, 'stalks'],
          ['Mushroom', 200, 'g'],
          ['Lime', 2, 'whole'],
          ['Fish sauce', 3, 'tbsp'],
          ['Chilli', 4, 'whole'],
        ],
        steps: [
          'Bruise the lemongrass and simmer it in the stock for ten minutes.',
          'Add the mushrooms and the chillies and cook for two minutes more.',
          'Slip in the prawns and take the pan off the heat as soon as they turn.',
          'Season off the heat with fish sauce and lime — boiling lime juice makes it bitter.',
        ],
        calories: 180,
        protein: 24,
        carbs: 9,
        fat: 5,
      },
      {
        title: 'Bun Cha',
        description: 'Grilled pork patties, cold noodles and a bowl of dipping sauce.',
        photoUrl: photo('photo-1559314809-0d155014e29e'),
        difficulty: 'Intermediate',
        mealtime: 'Lunch',
        cuisine: 'Vietnamese',
        totalMinutes: 50,
        servings: 4,
        tools: ['grill pan', 'mixing bowl'],
        ingredients: [
          ['Pork', 600, 'g'],
          ['Rice noodles', 300, 'g'],
          ['Fish sauce', 4, 'tbsp'],
          ['Sugar', 3, 'tbsp'],
          ['Lime', 2, 'whole'],
          ['Garlic', 4, 'cloves'],
          ['Mint', 1, 'handful'],
          ['Lettuce', 1, 'head'],
        ],
        steps: [
          'Mince the pork with half the garlic, a spoon of fish sauce and a spoon of sugar.',
          'Shape into small flat patties and rest them while you make the sauce.',
          'Mix the remaining fish sauce, sugar, lime and garlic with warm water until balanced.',
          'Grill the patties hard so they char at the edges but stay juicy.',
          'Soak the noodles, then serve everything separately with the herbs and lettuce.',
        ],
        calories: 620,
        protein: 38,
        carbs: 62,
        fat: 24,
      },
    ],
  },
  {
    id: 'mediterranean',
    name: 'Mediterranean',
    emoji: '🍅',
    blurb: 'Olive oil, lemon and tomatoes doing most of the work.',
    nameKm: 'មេឌីទែរ៉ាណេ',
    blurbKm: 'ប្រេងអូលីវ ក្រូចឆ្មារ និងប៉េងប៉ោះ ធ្វើការភាគច្រើន។',
    recipes: [
      {
        title: 'Lemon Chicken Orzo',
        description: 'One pan, and the orzo cooks in the chicken’s own stock.',
        photoUrl: photo('photo-1476224203421-9ac39bcb3327'),
        difficulty: 'Beginner',
        mealtime: 'Dinner',
        cuisine: 'Greek',
        totalMinutes: 35,
        servings: 4,
        tools: ['deep frying pan'],
        ingredients: [
          ['Chicken thigh', 800, 'g'],
          ['Pasta', 300, 'g'],
          ['Stock', 700, 'ml'],
          ['Lemon', 2, 'whole'],
          ['Garlic', 4, 'cloves'],
          ['Olive oil', 3, 'tbsp'],
          ['Parsley', 1, 'handful'],
        ],
        steps: [
          'Brown the chicken skin-side down and leave it alone until it releases itself.',
          'Lift it out, soften the garlic in the fat, then stir in the orzo.',
          'Pour in the stock, sit the chicken back on top and simmer for 15 minutes.',
          'Finish with the juice of both lemons and a lot of parsley.',
        ],
        calories: 640,
        protein: 46,
        carbs: 58,
        fat: 24,
      },
      {
        title: 'Caponata',
        description: 'Sweet-and-sour aubergine that is better on the second day.',
        photoUrl: photo('photo-1540189549336-e6e99c3679fe'),
        difficulty: 'Intermediate',
        mealtime: 'Lunch',
        cuisine: 'Italian',
        totalMinutes: 55,
        servings: 4,
        tools: ['frying pan'],
        ingredients: [
          ['Eggplant', 700, 'g'],
          ['Tomato', 400, 'g'],
          ['Onion', 1, 'whole'],
          ['Vinegar', 3, 'tbsp'],
          ['Sugar', 2, 'tbsp'],
          ['Olive oil', 5, 'tbsp'],
          ['Basil', 1, 'handful'],
        ],
        steps: [
          'Salt the diced aubergine for twenty minutes, then pat it properly dry.',
          'Fry it in batches in plenty of oil — crowding the pan steams it.',
          'Soften the onion, add the tomatoes and cook down to a thick sauce.',
          'Return the aubergine, add the vinegar and sugar and cook five minutes more.',
          'Cool to room temperature before serving; the flavour needs the rest.',
        ],
        calories: 290,
        protein: 5,
        carbs: 26,
        fat: 19,
      },
      {
        title: 'Falafel Wraps',
        description: 'Dried chickpeas only — tinned ones fall apart in the pan.',
        photoUrl: photo('photo-1512058564366-18510be2db19'),
        difficulty: 'Intermediate',
        mealtime: 'Lunch',
        cuisine: 'Lebanese',
        totalMinutes: 45,
        servings: 4,
        tools: ['food processor', 'frying pan'],
        ingredients: [
          ['Chickpeas', 400, 'g'],
          ['Coriander', 1, 'handful'],
          ['Parsley', 1, 'handful'],
          ['Garlic', 3, 'cloves'],
          ['Cumin', 2, 'tsp'],
          ['Flour', 2, 'tbsp'],
          ['Vegetable oil', 300, 'ml'],
          ['Tortilla', 4, 'whole'],
          ['Yoghurt', 150, 'g'],
        ],
        steps: [
          'Blitz the soaked chickpeas with the herbs, garlic and cumin to a coarse rubble.',
          'Stir through the flour and chill the mix for twenty minutes so it holds.',
          'Shape into small patties — smaller ones cook through before the outside burns.',
          'Fry at a steady medium heat until deep brown, about 3 minutes a side.',
          'Warm the wraps and build with yoghurt and whatever salad you have.',
        ],
        calories: 480,
        protein: 17,
        carbs: 52,
        fat: 23,
      },
      {
        title: 'Chicken Souvlaki',
        description: 'Yoghurt and lemon marinade, hot grill, nothing else.',
        photoUrl: photo('photo-1565299624946-b28f40a0ae38'),
        difficulty: 'Beginner',
        mealtime: 'Dinner',
        cuisine: 'Greek',
        totalMinutes: 40,
        servings: 4,
        tools: ['skewers', 'grill pan'],
        ingredients: [
          ['Chicken breast', 800, 'g'],
          ['Yoghurt', 200, 'g'],
          ['Lemon', 2, 'whole'],
          ['Garlic', 4, 'cloves'],
          ['Oregano', 2, 'tsp'],
          ['Olive oil', 3, 'tbsp'],
        ],
        steps: [
          'Mix the yoghurt, lemon juice, crushed garlic and oregano into a marinade.',
          'Cube the chicken and turn it through, then leave it at least 30 minutes.',
          'Thread onto skewers, shaking off the excess so it chars rather than steams.',
          'Grill hot for 10 to 12 minutes, turning once, and rest before serving.',
        ],
        calories: 410,
        protein: 52,
        carbs: 7,
        fat: 19,
      },
      {
        title: 'Tomato and White Bean Stew',
        description: 'Storecupboard dinner that tastes like it took longer.',
        photoUrl: photo('photo-1590412200988-a436970781fa'),
        difficulty: 'Beginner',
        mealtime: 'Dinner',
        cuisine: 'Italian',
        totalMinutes: 30,
        servings: 4,
        tools: ['saucepan'],
        ingredients: [
          ['White beans', 500, 'g'],
          ['Tomato', 800, 'g'],
          ['Onion', 1, 'whole'],
          ['Garlic', 4, 'cloves'],
          ['Rosemary', 2, 'sprigs'],
          ['Olive oil', 4, 'tbsp'],
          ['Stock', 300, 'ml'],
          ['Bread', 4, 'slices'],
        ],
        steps: [
          'Soften the onion slowly in the oil — this is where the sweetness comes from.',
          'Add the garlic and rosemary and cook until fragrant, about a minute.',
          'Tip in the tomatoes and stock and simmer for fifteen minutes.',
          'Add the beans, crush a few against the side to thicken it, and season well.',
          'Serve over bread toasted in olive oil.',
        ],
        calories: 380,
        protein: 15,
        carbs: 48,
        fat: 15,
      },
    ],
  },
  {
    id: 'comfort-classics',
    name: 'Comfort Classics',
    emoji: '🍝',
    blurb: 'The ones you already half-know, written down properly.',
    nameKm: 'មុខម្ហូបធម្មតា',
    blurbKm: 'មុខម្ហូបដែលអ្នកស្គាល់ខ្លះៗរួចហើយ សរសេរទុកឱ្យបានត្រឹមត្រូវ។',
    recipes: [
      {
        title: 'Spaghetti Carbonara',
        description: 'No cream. The sauce is egg, cheese and pasta water.',
        photoUrl: photo('photo-1612874742237-6526221588e3'),
        difficulty: 'Intermediate',
        mealtime: 'Dinner',
        cuisine: 'Italian',
        totalMinutes: 25,
        servings: 2,
        tools: ['large pot', 'frying pan'],
        ingredients: [
          ['Spaghetti', 200, 'g'],
          ['Bacon', 150, 'g'],
          ['Egg', 3, 'whole'],
          ['Parmesan', 60, 'g'],
          ['Black pepper', 2, 'tsp'],
        ],
        steps: [
          'Render the bacon slowly so the fat comes out and it crisps in its own oil.',
          'Beat the eggs with the parmesan and a lot of black pepper.',
          'Cook the spaghetti and keep a mugful of the water before draining.',
          'Off the heat, toss the pasta with the bacon, then the egg mix.',
          'Loosen with the pasta water a splash at a time until it turns glossy.',
        ],
        calories: 720,
        protein: 34,
        carbs: 76,
        fat: 31,
      },
      {
        title: 'Sunday Roast Chicken',
        description: 'One chicken, one tray, and the potatoes cook in the fat.',
        photoUrl: photo('photo-1467003909585-2f8a72700288'),
        difficulty: 'Beginner',
        mealtime: 'Dinner',
        cuisine: 'British',
        totalMinutes: 100,
        servings: 4,
        tools: ['roasting tray'],
        ingredients: [
          ['Chicken', 1600, 'g'],
          ['Potato', 1000, 'g'],
          ['Lemon', 1, 'whole'],
          ['Butter', 50, 'g'],
          ['Thyme', 4, 'sprigs'],
          ['Garlic', 1, 'bulb'],
        ],
        steps: [
          'Take the chicken out of the fridge an hour early — cold meat roasts unevenly.',
          'Rub it with butter, salt it generously and put the lemon and thyme inside.',
          'Roast at 200°C for 20 minutes, then turn down to 180°C for another hour.',
          'Add the potatoes around it halfway so they cook in the rendered fat.',
          'Rest the bird for 15 minutes before carving. This is not optional.',
        ],
        calories: 780,
        protein: 62,
        carbs: 48,
        fat: 38,
      },
      {
        title: 'Beef Chilli',
        description: 'Better the next day, and it freezes well in portions.',
        photoUrl: photo('photo-1582878826629-29b7ad1cdc43'),
        difficulty: 'Beginner',
        mealtime: 'Dinner',
        cuisine: 'American',
        totalMinutes: 75,
        servings: 6,
        tools: ['heavy pot'],
        ingredients: [
          ['Minced beef', 800, 'g'],
          ['Onion', 2, 'whole'],
          ['Tomato', 800, 'g'],
          ['Paprika', 2, 'tbsp'],
          ['Cumin', 1, 'tbsp'],
          ['Chilli flakes', 2, 'tsp'],
          ['Kidney beans', 400, 'g'],
          ['Stock', 400, 'ml'],
          ['Rice', 400, 'g'],
        ],
        steps: [
          'Brown the mince properly in batches. Grey mince makes grey chilli.',
          'Soften the onions, then toast the paprika and cumin for a minute.',
          'Return the beef, add the tomatoes and stock and simmer for an hour uncovered.',
          'Add the beans for the last fifteen minutes so they keep their shape.',
          'Taste for salt and heat at the end, not the beginning.',
        ],
        calories: 560,
        protein: 38,
        carbs: 52,
        fat: 21,
      },
      {
        title: 'Macaroni Cheese',
        description: 'A proper béchamel and three cheeses, baked until it blisters.',
        photoUrl: photo('photo-1600891964092-4316c288032e'),
        difficulty: 'Beginner',
        mealtime: 'Dinner',
        cuisine: 'American',
        totalMinutes: 45,
        servings: 4,
        tools: ['saucepan', 'baking dish'],
        ingredients: [
          ['Pasta', 400, 'g'],
          ['Butter', 60, 'g'],
          ['Flour', 60, 'g'],
          ['Milk', 700, 'ml'],
          ['Cheese', 250, 'g'],
          ['Parmesan', 50, 'g'],
          ['Mustard', 1, 'tsp'],
        ],
        steps: [
          'Melt the butter, stir in the flour and cook the raw taste out for two minutes.',
          'Add the milk a little at a time, beating smooth before the next addition.',
          'Take it off the heat before the cheese goes in or the sauce will split.',
          'Undercook the pasta by two minutes — it finishes in the oven.',
          'Combine, top with parmesan and bake at 200°C for 20 minutes until blistered.',
        ],
        calories: 810,
        protein: 33,
        carbs: 82,
        fat: 39,
      },
      {
        title: 'Cottage Pie',
        description: 'Mince below, mash above, forked on top so the peaks catch.',
        photoUrl: photo('photo-1455619452474-d2be8b1e70cd'),
        difficulty: 'Intermediate',
        mealtime: 'Dinner',
        cuisine: 'British',
        totalMinutes: 90,
        servings: 6,
        tools: ['heavy pot', 'baking dish', 'potato masher'],
        ingredients: [
          ['Minced beef', 900, 'g'],
          ['Potato', 1200, 'g'],
          ['Carrot', 3, 'whole'],
          ['Onion', 2, 'whole'],
          ['Stock', 500, 'ml'],
          ['Butter', 80, 'g'],
          ['Bay leaf', 2, 'whole'],
        ],
        steps: [
          'Brown the mince hard, then set it aside and cook the carrot and onion in the fat.',
          'Return the meat with the stock and bay and simmer 40 minutes until thick.',
          'Boil the potatoes, drain them properly dry, then mash with the butter.',
          'Spoon the mash over the mince and fork the surface into ridges.',
          'Bake at 200°C for 25 minutes until the peaks are browned.',
        ],
        calories: 690,
        protein: 41,
        carbs: 58,
        fat: 31,
      },
    ],
  },
]

/** Ids as a readonly tuple, so zod's enum and the type stay in step. */
export const STARTER_PACK_IDS = STARTER_PACKS.map((p) => p.id) as [string, ...string[]]

/**
 * What the picker needs and nothing more. Recipe bodies stay on the server —
 * the client only ever sends ids back, so shipping them would be dead weight
 * on a screen shown once.
 */
export function packSummaries() {
  // Both languages go over the wire and the client picks, rather than the
  // endpoint reading an Accept-Language header or a query param. Three packs of
  // two short strings is nothing, and it keeps the route stateless about
  // language — the same reason the app's language preference never leaves the
  // device. `sampleTitles` stays English because those are recipe titles, and
  // the recipes aren't translated.
  return STARTER_PACKS.map(({ id, name, emoji, blurb, nameKm, blurbKm, recipes }) => ({
    id,
    name,
    emoji,
    blurb,
    nameKm,
    blurbKm,
    count: recipes.length,
    sampleTitles: recipes.slice(0, 3).map((r) => r.title),
  }))
}

/**
 * Flattens the chosen packs, dropping any title that appears twice. Two packs
 * can legitimately want the same dish, and without this the import would fail
 * its own uniqueness rule against a row it created moments earlier.
 */
export function recipesForPacks(packIds: string[]): StarterRecipe[] {
  const seen = new Set<string>()
  const out: StarterRecipe[] = []
  for (const id of packIds) {
    const pack = STARTER_PACKS.find((p) => p.id === id)
    if (!pack) continue
    for (const recipe of pack.recipes) {
      const key = recipe.title.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(recipe)
    }
  }
  return out
}
