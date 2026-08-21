// Fills an account with enough recipes to judge the dashboard at realistic
// volume — a grid, a favourites carousel with something in it, and every
// mealtime chip returning results.
//
//   npx tsx prisma/seed-dummy.ts            # insert, or backfill nutrition on
//                                           # rows a previous run created
//   npx tsx prisma/seed-dummy.ts --remove   # delete exactly these titles again
//
// Targets SEED_USER_ID, or the only Supabase auth user if there is exactly one.
// Writes through Prisma rather than the API: the API is rate limited to 100
// requests a minute and would need a live session token.
//
// Two things here are not arbitrary. Ingredient names are taken from the app's
// `src/data/ingredients.ts` and cuisines from `src/data/cuisines.ts`, because
// `emojiForIngredient`/`emojiForCuisine` match on the name — spell one
// differently and that row silently renders without its emoji. And every
// photoUrl is on images.unsplash.com, the one third-party host the API's
// photoUrl allowlist accepts, so these recipes can still be edited and saved
// from the app afterwards.

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { createClient } from '@supabase/supabase-js'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

const photo = (id: string) => `https://images.unsplash.com/${id}?w=1200&q=80`

interface Dummy {
  title: string
  description: string
  photoUrl: string
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced'
  mealtime: 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack'
  cuisine: string
  totalMinutes: number
  servings: number
  isFavourite?: boolean
  tools: string[]
  ingredients: [string, number, string][]
  steps: string[]
}

const RECIPES: Dummy[] = [
  {
    title: 'Fish Amok',
    description: 'Steamed coconut fish curry in banana leaf, mild and fragrant.',
    photoUrl: photo('photo-1455619452474-d2be8b1e70cd'),
    difficulty: 'Advanced',
    mealtime: 'Dinner',
    cuisine: 'Cambodian',
    totalMinutes: 70,
    servings: 4,
    isFavourite: true,
    tools: ['steamer', 'mortar and pestle'],
    ingredients: [
      ['Fish', 600, 'g'],
      ['Coconut milk', 400, 'ml'],
      ['Lemongrass', 3, 'stalks'],
      ['Turmeric', 1, 'tsp'],
      ['Egg', 1, 'whole'],
      ['Fish sauce', 2, 'tbsp'],
    ],
    steps: [
      'Pound lemongrass, turmeric and garlic into a smooth paste.',
      'Fold the paste through the coconut milk and beaten egg.',
      'Coat the fish and rest it for 15 minutes.',
      'Steam for 25 minutes until just set, then rest before serving.',
    ],
  },
  {
    title: 'Lok Lak Rice Bowl',
    description: 'Seared pepper beef over rice with a lime dipping sauce.',
    photoUrl: photo('photo-1546069901-ba9599a7e63c'),
    difficulty: 'Beginner',
    mealtime: 'Lunch',
    cuisine: 'Cambodian',
    totalMinutes: 25,
    servings: 2,
    tools: ['frying pan'],
    ingredients: [
      ['Beef', 400, 'g'],
      ['Rice', 300, 'g'],
      ['Black pepper', 2, 'tsp'],
      ['Lime', 1, 'whole'],
      ['Onion', 1, 'whole'],
      ['Lettuce', 4, 'leaves'],
    ],
    steps: [
      'Toss the beef with pepper, soy sauce and sugar; rest 10 minutes.',
      'Sear hard in a very hot pan so it colours instead of stewing.',
      'Mix lime juice, pepper and salt for the dipping sauce.',
      'Serve over rice with lettuce and the sauce alongside.',
    ],
  },
  {
    title: 'Spaghetti Aglio e Olio',
    description: 'Garlic, chilli and good olive oil. Five ingredients, ten minutes.',
    photoUrl: photo('photo-1612874742237-6526221588e3'),
    difficulty: 'Beginner',
    mealtime: 'Dinner',
    cuisine: 'Italian',
    totalMinutes: 15,
    servings: 2,
    isFavourite: true,
    tools: ['large pot', 'frying pan'],
    ingredients: [
      ['Spaghetti', 200, 'g'],
      ['Garlic', 4, 'cloves'],
      ['Chilli flakes', 1, 'tsp'],
      ['Olive oil', 60, 'ml'],
      ['Parsley', 1, 'handful'],
    ],
    steps: [
      'Boil the pasta in well-salted water and save a mug of the water.',
      'Warm sliced garlic in the oil gently — golden, never brown.',
      'Toss the pasta through with a splash of pasta water to emulsify.',
      'Finish with chilli flakes and chopped parsley.',
    ],
  },
  {
    title: 'Shakshuka',
    description: 'Eggs poached in a spiced tomato and pepper stew.',
    photoUrl: photo('photo-1590412200988-a436970781fa'),
    difficulty: 'Beginner',
    mealtime: 'Breakfast',
    cuisine: 'Lebanese',
    totalMinutes: 30,
    servings: 3,
    tools: ['frying pan'],
    ingredients: [
      ['Egg', 4, 'whole'],
      ['Tomato', 6, 'whole'],
      ['Bell pepper', 1, 'whole'],
      ['Onion', 1, 'whole'],
      ['Cumin', 1, 'tsp'],
      ['Paprika', 1, 'tsp'],
      ['Coriander', 1, 'handful'],
    ],
    steps: [
      'Soften the onion and pepper until sweet, about 10 minutes.',
      'Add spices, cook a minute, then the tomatoes; simmer to a thick sauce.',
      'Make wells and crack in the eggs.',
      'Cover and cook until the whites set but the yolks stay soft.',
    ],
  },
  {
    title: 'Avocado Toast with Chilli',
    description: 'Sourdough, smashed avocado, lime and a lot of chilli flakes.',
    photoUrl: photo('photo-1541519227354-08fa5d50c44d'),
    difficulty: 'Beginner',
    mealtime: 'Breakfast',
    cuisine: 'American',
    totalMinutes: 10,
    servings: 1,
    tools: ['toaster', 'fork'],
    ingredients: [
      ['Bread', 2, 'slices'],
      ['Avocado', 1, 'whole'],
      ['Lime', 1, 'half'],
      ['Chilli flakes', 1, 'pinch'],
      ['Olive oil', 1, 'tbsp'],
    ],
    steps: [
      'Toast the bread until properly crisp.',
      'Smash the avocado with lime, salt and pepper.',
      'Pile on and finish with oil and chilli flakes.',
    ],
  },
  {
    title: 'Pho Bo',
    description: 'Beef noodle soup with a broth that simmers most of the afternoon.',
    photoUrl: photo('photo-1585032226651-759b368d7246'),
    difficulty: 'Advanced',
    mealtime: 'Lunch',
    cuisine: 'Vietnamese',
    totalMinutes: 240,
    servings: 6,
    isFavourite: true,
    tools: ['stock pot', 'sieve'],
    ingredients: [
      ['Beef', 1000, 'g'],
      ['Rice noodles', 400, 'g'],
      ['Ginger', 1, 'thumb'],
      ['Onion', 2, 'whole'],
      ['Cinnamon', 1, 'stick'],
      ['Fish sauce', 3, 'tbsp'],
      ['Bean sprouts', 200, 'g'],
      ['Basil', 1, 'handful'],
    ],
    steps: [
      'Char the onion and ginger directly over a flame until blackened.',
      'Blanch the bones, rinse, then simmer with the aromatics for 3 hours.',
      'Strain and season the broth with fish sauce and a little sugar.',
      'Soak the noodles, slice the beef thin, and pour the boiling broth over.',
      'Serve with sprouts and herbs on the side.',
    ],
  },
  {
    title: 'Pad Thai',
    description: 'Sweet, sour and salty noodles with tamarind and peanuts.',
    photoUrl: photo('photo-1559314809-0d155014e29e'),
    difficulty: 'Intermediate',
    mealtime: 'Dinner',
    cuisine: 'Thai',
    totalMinutes: 35,
    servings: 3,
    tools: ['wok'],
    ingredients: [
      ['Rice noodles', 300, 'g'],
      ['Prawns', 250, 'g'],
      ['Egg', 2, 'whole'],
      ['Bean sprouts', 150, 'g'],
      ['Peanuts', 50, 'g'],
      ['Fish sauce', 2, 'tbsp'],
      ['Sugar', 1, 'tbsp'],
      ['Lime', 1, 'whole'],
    ],
    steps: [
      'Soak the noodles until pliable but still firm.',
      'Fry the prawns, push aside, and scramble the eggs in the same wok.',
      'Add noodles and sauce, tossing constantly so nothing sits still.',
      'Finish off the heat with sprouts, peanuts and lime.',
    ],
  },
  {
    title: 'Chicken Katsu Curry',
    description: 'Crisp panko chicken with a thick, mild Japanese curry sauce.',
    photoUrl: photo('photo-1567620905732-2d1ec7ab7445'),
    difficulty: 'Intermediate',
    mealtime: 'Dinner',
    cuisine: 'Japanese',
    totalMinutes: 50,
    servings: 4,
    isFavourite: true,
    tools: ['frying pan', 'saucepan'],
    ingredients: [
      ['Chicken breast', 4, 'whole'],
      ['Flour', 100, 'g'],
      ['Egg', 2, 'whole'],
      ['Rice', 400, 'g'],
      ['Carrot', 2, 'whole'],
      ['Curry powder', 2, 'tbsp'],
      ['Stock', 500, 'ml'],
    ],
    steps: [
      'Flatten the chicken to an even thickness so it cooks evenly.',
      'Flour, egg, then panko — press the crumbs on firmly.',
      'Soften carrot and onion, stir in curry powder and flour, then the stock.',
      'Simmer the sauce until it coats a spoon while you fry the chicken.',
      'Slice the katsu and pour the sauce beside, not over, the crust.',
    ],
  },
  {
    title: 'Bibimbap',
    description: 'Rice bowl with seasoned vegetables, beef and a fried egg.',
    photoUrl: photo('photo-1498654896293-37aacf113fd9'),
    difficulty: 'Intermediate',
    mealtime: 'Lunch',
    cuisine: 'Korean',
    totalMinutes: 45,
    servings: 2,
    tools: ['frying pan', 'mixing bowls'],
    ingredients: [
      ['Rice', 300, 'g'],
      ['Minced beef', 200, 'g'],
      ['Spinach', 150, 'g'],
      ['Carrot', 1, 'whole'],
      ['Bean sprouts', 100, 'g'],
      ['Egg', 2, 'whole'],
      ['Sesame oil', 2, 'tbsp'],
      ['Chilli sauce', 2, 'tbsp'],
    ],
    steps: [
      'Season each vegetable separately with sesame oil, garlic and salt.',
      'Brown the beef with soy sauce and sugar.',
      'Fry the eggs so the yolks stay runny.',
      'Arrange everything over rice in sections and mix at the table.',
    ],
  },
  {
    title: 'Margherita Pizza',
    description: 'Slow-risen dough, tomato, mozzarella, basil. Nothing else.',
    photoUrl: photo('photo-1600891964092-4316c288032e'),
    difficulty: 'Advanced',
    mealtime: 'Dinner',
    cuisine: 'Italian',
    totalMinutes: 180,
    servings: 2,
    tools: ['pizza stone', 'rolling pin'],
    ingredients: [
      ['Flour', 500, 'g'],
      ['Yeast', 7, 'g'],
      ['Tomato', 400, 'g'],
      ['Cheese', 250, 'g'],
      ['Basil', 1, 'handful'],
      ['Olive oil', 2, 'tbsp'],
    ],
    steps: [
      'Mix the dough and let it rise slowly — two hours minimum.',
      'Heat the oven as hot as it goes with the stone inside.',
      'Stretch by hand; a rolling pin crushes the air out of the rim.',
      'Top sparingly and bake 6–8 minutes.',
      'Add the basil after it comes out, or it burns.',
    ],
  },
  {
    title: 'Tacos al Pastor',
    description: 'Marinated pork with pineapple, charred and piled into tortillas.',
    photoUrl: photo('photo-1565299624946-b28f40a0ae38'),
    difficulty: 'Intermediate',
    mealtime: 'Dinner',
    cuisine: 'Mexican',
    totalMinutes: 90,
    servings: 4,
    tools: ['frying pan', 'blender'],
    ingredients: [
      ['Pork', 700, 'g'],
      ['Pineapple', 200, 'g'],
      ['Tortilla', 12, 'whole'],
      ['Chilli', 3, 'whole'],
      ['Onion', 1, 'whole'],
      ['Coriander', 1, 'handful'],
      ['Paprika', 1, 'tbsp'],
    ],
    steps: [
      'Blend the chillies, spices and pineapple juice into a marinade.',
      'Marinate the sliced pork for at least an hour.',
      'Sear in batches so it chars rather than steams.',
      'Warm the tortillas and top with pork, pineapple, onion and coriander.',
    ],
  },
  {
    title: 'Chicken Tikka Masala',
    description: 'Charred yoghurt-marinated chicken in a creamy tomato sauce.',
    photoUrl: photo('photo-1476224203421-9ac39bcb3327'),
    difficulty: 'Intermediate',
    mealtime: 'Dinner',
    cuisine: 'Indian',
    totalMinutes: 75,
    servings: 4,
    isFavourite: true,
    tools: ['frying pan', 'blender'],
    ingredients: [
      ['Chicken thigh', 700, 'g'],
      ['Yoghurt', 200, 'g'],
      ['Tomato', 400, 'g'],
      ['Cream', 150, 'ml'],
      ['Ginger', 1, 'thumb'],
      ['Garlic', 4, 'cloves'],
      ['Turmeric', 1, 'tsp'],
      ['Cumin', 2, 'tsp'],
    ],
    steps: [
      'Marinate the chicken in yoghurt, ginger, garlic and spices for an hour.',
      'Grill or pan-char it hard — the black edges are the point.',
      'Build the sauce from onion, tomato and the rest of the spices.',
      'Blend smooth, add cream, then return the chicken to finish.',
    ],
  },
  {
    title: 'Beef Bourguignon',
    description: 'Beef braised in red wine until it gives way to a spoon.',
    photoUrl: photo('photo-1504674900247-0877df9cc836'),
    difficulty: 'Advanced',
    mealtime: 'Dinner',
    cuisine: 'French',
    totalMinutes: 210,
    servings: 6,
    tools: ['dutch oven'],
    ingredients: [
      ['Beef', 1200, 'g'],
      ['Bacon', 150, 'g'],
      ['Wine', 500, 'ml'],
      ['Carrot', 3, 'whole'],
      ['Mushroom', 250, 'g'],
      ['Onion', 2, 'whole'],
      ['Thyme', 3, 'sprigs'],
      ['Bay leaf', 2, 'whole'],
    ],
    steps: [
      'Brown the beef in batches — crowding the pan costs you the crust.',
      'Render the bacon, soften the vegetables, deglaze with the wine.',
      'Return everything, add herbs, and braise low for three hours.',
      'Fry the mushrooms separately and add them at the end.',
    ],
  },
  {
    title: 'Greek Salad',
    description: 'Tomato, cucumber, olives and feta, dressed only in oil.',
    photoUrl: photo('photo-1540189549336-e6e99c3679fe'),
    difficulty: 'Beginner',
    mealtime: 'Lunch',
    cuisine: 'Greek',
    totalMinutes: 15,
    servings: 3,
    tools: ['knife', 'bowl'],
    ingredients: [
      ['Tomato', 4, 'whole'],
      ['Cucumber', 1, 'whole'],
      ['Cheese', 200, 'g'],
      ['Onion', 1, 'half'],
      ['Olive oil', 4, 'tbsp'],
      ['Black pepper', 1, 'tsp'],
    ],
    steps: [
      'Cut everything into large, confident chunks.',
      'Salt the tomatoes first and let them sit five minutes.',
      'Dress with oil, top with the cheese whole, and grind over pepper.',
    ],
  },
  {
    title: 'Mapo Tofu',
    description: 'Silken tofu and pork in a numbing, chilli-heavy sauce.',
    photoUrl: photo('photo-1582878826629-29b7ad1cdc43'),
    difficulty: 'Intermediate',
    mealtime: 'Dinner',
    cuisine: 'Chinese',
    totalMinutes: 30,
    servings: 3,
    tools: ['wok'],
    ingredients: [
      ['Tofu', 400, 'g'],
      ['Pork', 150, 'g'],
      ['Chilli sauce', 2, 'tbsp'],
      ['Garlic', 3, 'cloves'],
      ['Spring onion', 3, 'whole'],
      ['Soy sauce', 1, 'tbsp'],
      ['Stock', 200, 'ml'],
    ],
    steps: [
      'Cube the tofu and hold it in warm salted water so it stays intact.',
      'Fry the pork until dry, then the chilli paste until the oil reddens.',
      'Add stock, slide in the tofu, and push rather than stir it.',
      'Thicken, then finish with spring onion.',
    ],
  },
  {
    title: 'Banana Oat Pancakes',
    description: 'Three ingredients, no scales needed, ready before the kettle boils.',
    photoUrl: photo('photo-1490645935967-10de6ba17061'),
    difficulty: 'Beginner',
    mealtime: 'Breakfast',
    cuisine: 'American',
    totalMinutes: 20,
    servings: 2,
    tools: ['blender', 'frying pan'],
    ingredients: [
      ['Banana', 2, 'whole'],
      ['Oats', 100, 'g'],
      ['Egg', 2, 'whole'],
      ['Honey', 1, 'tbsp'],
      ['Butter', 1, 'tbsp'],
    ],
    steps: [
      'Blend the bananas, oats and eggs into a loose batter.',
      'Rest it five minutes so the oats swell.',
      'Cook on a medium pan — too hot and the banana burns before it sets.',
    ],
  },
  {
    title: 'Hummus and Warm Pita',
    description: 'Blended far longer than you think is necessary.',
    photoUrl: photo('photo-1512058564366-18510be2db19'),
    difficulty: 'Beginner',
    mealtime: 'Snack',
    cuisine: 'Lebanese',
    totalMinutes: 20,
    servings: 4,
    tools: ['blender'],
    ingredients: [
      ['Garlic', 2, 'cloves'],
      ['Lemon', 1, 'whole'],
      ['Olive oil', 60, 'ml'],
      ['Cumin', 1, 'tsp'],
      ['Bread', 4, 'whole'],
      ['Paprika', 1, 'pinch'],
    ],
    steps: [
      'Blend the chickpeas with lemon, garlic and a little iced water.',
      'Keep going for three full minutes — that is what makes it smooth.',
      'Pool oil on top, dust with paprika, and warm the bread before serving.',
    ],
  },
  {
    title: 'Mango Sticky Rice',
    description: 'Warm coconut rice with cold ripe mango.',
    photoUrl: photo('photo-1563379926898-05f4575a45d8'),
    difficulty: 'Beginner',
    mealtime: 'Snack',
    cuisine: 'Thai',
    totalMinutes: 60,
    servings: 4,
    isFavourite: true,
    tools: ['steamer'],
    ingredients: [
      ['Sticky rice', 300, 'g'],
      ['Coconut milk', 300, 'ml'],
      ['Mango', 2, 'whole'],
      ['Sugar', 60, 'g'],
      ['Salt', 1, 'pinch'],
    ],
    steps: [
      'Soak the rice for at least four hours, then steam 25 minutes.',
      'Warm the coconut milk with sugar and salt — do not boil it.',
      'Stir most of it through the hot rice and let it absorb.',
      'Serve with sliced mango and the rest of the sauce poured over.',
    ],
  },
  {
    title: 'Miso Salmon',
    description: 'Sweet-salty glaze under a hot grill, done in fifteen minutes.',
    photoUrl: photo('photo-1467003909585-2f8a72700288'),
    difficulty: 'Beginner',
    mealtime: 'Dinner',
    cuisine: 'Japanese',
    totalMinutes: 25,
    servings: 2,
    tools: ['baking tray'],
    ingredients: [
      ['Salmon', 2, 'fillets'],
      ['Soy sauce', 2, 'tbsp'],
      ['Honey', 1, 'tbsp'],
      ['Ginger', 1, 'thumb'],
      ['Sesame oil', 1, 'tsp'],
      ['Spring onion', 2, 'whole'],
    ],
    steps: [
      'Whisk the glaze and coat the salmon; leave it 10 minutes.',
      'Grill skin-side down close to the heat until the top caramelises.',
      'Rest two minutes and scatter with spring onion.',
    ],
  },
  {
    title: 'Chocolate Mug Cake',
    description: 'Ninety seconds from craving to spoon.',
    photoUrl: photo('photo-1499636136210-6f4ee915583e'),
    difficulty: 'Beginner',
    mealtime: 'Snack',
    cuisine: 'British',
    totalMinutes: 5,
    servings: 1,
    tools: ['mug', 'microwave'],
    ingredients: [
      ['Flour', 4, 'tbsp'],
      ['Cocoa powder', 2, 'tbsp'],
      ['Sugar', 3, 'tbsp'],
      ['Milk', 3, 'tbsp'],
      ['Vegetable oil', 2, 'tbsp'],
      ['Chocolate', 20, 'g'],
    ],
    steps: [
      'Stir the dry ingredients in the mug first, then add the wet.',
      'Push a square of chocolate into the middle.',
      'Microwave 90 seconds; stop while the top still looks slightly wet.',
    ],
  },
]

export const DUMMY_TITLES = RECIPES.map((r) => r.title)

/**
 * Nutrition, per serving, keyed by title — kept apart from the recipes so the
 * coverage is legible at a glance rather than buried across twenty literals.
 *
 * The gaps are the point. Five recipes appear here not at all and two carry
 * only calories, so the detail screen's three states — full block, partial
 * block, no section whatsoever — are all reachable without editing anything by
 * hand. Fill every row in and you'd never see the two that matter most, since
 * "no nutrition" is what a real library mostly looks like.
 *
 * The numbers are estimates from the ingredient lists divided by the serving
 * count. They're plausible, not authoritative.
 */
const NUTRITION: Record<string, { calories?: number; protein?: number; carbs?: number; fat?: number }> = {
  'Fish Amok': { calories: 430, protein: 34, carbs: 9, fat: 29 },
  'Spaghetti Aglio e Olio': { calories: 630, protein: 13, carbs: 74, fat: 31 },
  Shakshuka: { calories: 220, protein: 11, carbs: 14, fat: 13 },
  'Avocado Toast with Chilli': { calories: 520, protein: 11, carbs: 42, fat: 34 },
  'Pho Bo': { calories: 480, protein: 34, carbs: 52, fat: 13 },
  'Pad Thai': { calories: 560, protein: 28, carbs: 72, fat: 17 },
  'Chicken Katsu Curry': { calories: 740, protein: 42, carbs: 88, fat: 22 },
  Bibimbap: { calories: 700, protein: 34, carbs: 90, fat: 22 },
  'Margherita Pizza': { calories: 1350, protein: 55, carbs: 175, fat: 45 },
  'Tacos al Pastor': { calories: 610, protein: 40, carbs: 48, fat: 27 },
  'Chicken Tikka Masala': { calories: 520, protein: 42, carbs: 14, fat: 32 },
  'Mango Sticky Rice': { calories: 470, protein: 4.5, carbs: 82, fat: 14 },
  'Miso Salmon': { calories: 420, protein: 38, carbs: 12, fat: 24 },
  // Calories only — the partial case.
  'Mapo Tofu': { calories: 290 },
  'Chocolate Mug Cake': { calories: 560 },
  // Deliberately absent, so the section is missing entirely on these:
  // Lok Lak Rice Bowl, Beef Bourguignon, Greek Salad, Banana Oat Pancakes,
  // Hummus and Warm Pita.
}

/** Null, not undefined — see the note in the backend's validation.ts. */
function nutritionFor(title: string) {
  const values = NUTRITION[title] ?? {}
  return {
    calories: values.calories ?? null,
    protein: values.protein ?? null,
    carbs: values.carbs ?? null,
    fat: values.fat ?? null,
  }
}

async function resolveUserId(): Promise<string> {
  if (process.env.SEED_USER_ID) return process.env.SEED_USER_ID

  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await admin.auth.admin.listUsers()
  if (error) throw error
  if (data.users.length !== 1) {
    throw new Error(
      `Found ${data.users.length} auth users — set SEED_USER_ID to the one you mean:\n` +
        data.users.map((u) => `  ${u.id}  ${u.email}`).join('\n')
    )
  }
  console.log(`Using the only auth user: ${data.users[0].email} (${data.users[0].id})`)
  return data.users[0].id
}

async function insert(userId: string) {
  // Titles are unique per user, so an existing one is skipped rather than
  // failing the run — this stays safe to re-run after a partial insert.
  const existing = new Set(
    (await prisma.recipe.findMany({ where: { userId }, select: { title: true } })).map((r) =>
      r.title.trim().toLowerCase()
    )
  )

  let created = 0
  let patched = 0
  for (const recipe of RECIPES) {
    if (existing.has(recipe.title.toLowerCase())) {
      // Already inserted on an earlier run, so bring only the nutrition columns
      // up to date. A delete-and-recreate would hand every recipe a new id and
      // wipe whatever the user has favourited since — far too destructive for
      // what is really a backfill.
      const { count } = await prisma.recipe.updateMany({
        where: { userId, title: recipe.title },
        data: nutritionFor(recipe.title),
      })
      patched += count
      console.log(`  patch  ${recipe.title} (already there — nutrition updated)`)
      continue
    }
    const { ingredients, steps, ...rest } = recipe
    await prisma.recipe.create({
      data: {
        ...rest,
        ...nutritionFor(recipe.title),
        userId,
        ingredients: {
          create: ingredients.map(([name, quantity, unit], position) => ({
            name,
            quantity,
            unit,
            position,
          })),
        },
        steps: { create: steps.map((instruction, i) => ({ stepNumber: i + 1, instruction })) },
      },
    })
    created++
    console.log(`  added  ${recipe.title}`)
  }
  console.log(`\n${created} recipe(s) added, ${patched} updated in place.`)
}

async function remove(userId: string) {
  // Deletes by exact title and only for this user. Ingredient and step rows go
  // with them — both cascade on recipe delete.
  const { count } = await prisma.recipe.deleteMany({
    where: { userId, title: { in: DUMMY_TITLES } },
  })
  console.log(`Removed ${count} dummy recipe(s).`)
}

async function main() {
  const userId = await resolveUserId()
  const total = await prisma.recipe.count({ where: { userId } })
  console.log(`Account currently has ${total} recipe(s).\n`)

  if (process.argv.includes('--remove')) await remove(userId)
  else await insert(userId)

  console.log(`Account now has ${await prisma.recipe.count({ where: { userId } })} recipe(s).`)
}

main()
  .catch((err) => {
    console.error('\nFailed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
