// Everyday home-style examples, not claims of an authoritative regional version.
// Stock photos illustrate the dishes; nutrition is deliberately not estimated.
const photo = (id: string) => `https://images.unsplash.com/${id}?w=1200&q=80`
const ricePhoto = photo('photo-1546069901-ba9599a7e63c')
const soupPhoto = photo('photo-1547592180-85f173990554')
const stirFryPhoto = photo('photo-1512058564366-18510be2db19')

interface HomeRecipe {
  title: string
  description: string
  photoUrl: string
  mealtime: 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack'
  cuisine: string
  totalMinutes: number
  servings: number
  ingredients: [string, number, string][]
  steps: string[]
}

export const ASIAN_HOUSEHOLD: HomeRecipe[] = [
  {
    title: 'Ginger Chicken Rice Porridge',
    description: 'A gentle home-style rice porridge for breakfast. Add pepper or chilli at the table. Photo is illustrative.',
    photoUrl: soupPhoto, mealtime: 'Breakfast', cuisine: 'Cambodian', totalMinutes: 50, servings: 4,
    ingredients: [['Rice', 180, 'g'], ['Chicken', 350, 'g'], ['Water', 1800, 'ml'], ['Ginger', 25, 'g'], ['Garlic', 3, 'cloves'], ['Fish sauce', 1, 'tbsp'], ['Spring onion', 2, 'stalks'], ['Black pepper', 0.25, 'tsp']],
    steps: ['Rinse the rice. Slice the ginger, mince the garlic and cut the chicken into small pieces.', 'Bring the rice, water, ginger and garlic to a boil. Lower to a gentle simmer and cook for 25 minutes, stirring occasionally.', 'Add the chicken and simmer for 15 minutes, until it is cooked through and the rice is soft. Add water if you prefer a thinner porridge.', 'Season with fish sauce and pepper. Slice the spring onions and scatter over each bowl.'],
  },
  {
    title: 'Egg Fried Rice with Spring Onion',
    description: 'A quick lunch using chilled leftover rice. Cool cooked rice promptly, refrigerate it, and reheat until steaming hot. Photo is illustrative.',
    photoUrl: stirFryPhoto, mealtime: 'Lunch', cuisine: 'Chinese', totalMinutes: 20, servings: 3,
    ingredients: [['Cooked rice', 600, 'g'], ['Egg', 3, 'pcs'], ['Carrot', 1, 'pcs'], ['Spring onion', 3, 'stalks'], ['Garlic', 2, 'cloves'], ['Soy sauce', 1.5, 'tbsp'], ['Vegetable oil', 2, 'tbsp']],
    steps: ['Break up the chilled cooked rice. Finely dice the carrot, slice the spring onions, mince the garlic and beat the eggs.', 'Heat half the oil in a wok. Scramble the eggs just until set and transfer them to a plate.', 'Add the remaining oil, carrot and garlic. Stir-fry for 3–4 minutes, then add the rice and stir-fry until steaming hot throughout.', 'Fold in the eggs, spring onions and soy sauce. Stir-fry for another minute and serve immediately.'],
  },
  {
    title: 'Tomato and Egg Rice Bowls',
    description: 'Soft scrambled eggs and juicy tomatoes over fresh rice, an easy everyday family lunch. Photo is illustrative.',
    photoUrl: ricePhoto, mealtime: 'Lunch', cuisine: 'Chinese', totalMinutes: 30, servings: 3,
    ingredients: [['Rice', 240, 'g'], ['Water', 450, 'ml'], ['Egg', 5, 'pcs'], ['Tomato', 4, 'pcs'], ['Spring onion', 2, 'stalks'], ['Vegetable oil', 2, 'tbsp'], ['Soy sauce', 1, 'tbsp'], ['Sugar', 0.5, 'tsp']],
    steps: ['Rinse the rice and cook it with 400 ml water, adjusting to your rice cooker or rice variety. Reserve the other 50 ml for the tomatoes.', 'Beat the eggs, chop the tomatoes and slice the spring onions. Heat half the oil and scramble the eggs until just set. Remove to a plate.', 'Add the remaining oil and tomatoes. Cook for 5 minutes, then add the soy sauce, sugar and reserved water. Simmer until saucy.', 'Fold the cooked eggs into the tomatoes and heat through. Serve over rice, topped with spring onion.'],
  },
  {
    title: 'Garlic Bok Choy with Tofu and Rice',
    description: 'A simple vegetable and tofu dinner with a light soy sauce. Photo is illustrative.',
    photoUrl: stirFryPhoto, mealtime: 'Dinner', cuisine: 'Chinese', totalMinutes: 30, servings: 4,
    ingredients: [['Rice', 300, 'g'], ['Water', 550, 'ml'], ['Bok choy', 500, 'g'], ['Tofu', 400, 'g'], ['Garlic', 5, 'cloves'], ['Soy sauce', 2, 'tbsp'], ['Vegetable oil', 2, 'tbsp']],
    steps: ['Rinse the rice and cook it with 500 ml water, adjusting for your rice variety. Reserve 50 ml for the stir-fry.', 'Drain and cube the firm tofu. Wash the bok choy thoroughly, separating thicker stems from leaves. Mince the garlic.', 'Heat the oil and pan-fry the tofu until golden on two sides. Add garlic and bok choy stems and stir-fry for 2 minutes.', 'Add the leaves, soy sauce and reserved water. Cover for 2–3 minutes, until the greens are tender. Serve with the rice.'],
  },
  {
    title: 'Pork and Cabbage Soup with Rice',
    description: 'A light family soup with minced pork, cabbage and ginger. Serve broth and rice separately. Photo is illustrative.',
    photoUrl: soupPhoto, mealtime: 'Dinner', cuisine: 'Cambodian', totalMinutes: 35, servings: 4,
    ingredients: [['Rice', 300, 'g'], ['Water', 1700, 'ml'], ['Pork mince', 350, 'g'], ['Cabbage', 400, 'g'], ['Ginger', 20, 'g'], ['Garlic', 3, 'cloves'], ['Fish sauce', 1.5, 'tbsp'], ['Spring onion', 2, 'stalks'], ['Black pepper', 0.25, 'tsp']],
    steps: ['Cook the rinsed rice with 500 ml of the water, adjusting for your rice variety. Reserve 1200 ml for the soup.', 'Chop the cabbage, slice the ginger and mince the garlic. Bring the reserved water, ginger and garlic to a boil.', 'Add small pieces of minced pork, breaking them apart gently. Simmer for 10 minutes, until the pork is cooked through.', 'Add cabbage and simmer for another 5–8 minutes until tender. Season with fish sauce and pepper, add sliced spring onion and serve with rice.'],
  },
  {
    title: 'Thai Basil Chicken with Rice',
    description: 'A weeknight basil stir-fry. Adjust the chilli for your household; Thai basil makes a useful home-style substitute for holy basil. Photo is illustrative.',
    photoUrl: stirFryPhoto, mealtime: 'Dinner', cuisine: 'Thai', totalMinutes: 30, servings: 4,
    ingredients: [['Rice', 300, 'g'], ['Water', 550, 'ml'], ['Chicken mince', 500, 'g'], ['Garlic', 4, 'cloves'], ['Chilli', 1, 'pcs'], ['Basil', 25, 'g'], ['Soy sauce', 1, 'tbsp'], ['Fish sauce', 1, 'tbsp'], ['Sugar', 1, 'tsp'], ['Vegetable oil', 1.5, 'tbsp']],
    steps: ['Cook the rinsed rice with 500 ml water, adjusting for your rice variety. Reserve 50 ml for the sauce.', 'Mince the garlic and chilli. Mix soy sauce, fish sauce, sugar and the reserved water.', 'Heat the oil in a wok, briefly fry garlic and chilli, then add the chicken. Stir-fry for 6–8 minutes, breaking it apart, until cooked through.', 'Add the sauce and simmer for a minute. Fold in the basil until wilted and serve over rice.'],
  },
  {
    title: 'Soy-Braised Tofu and Mushrooms',
    description: 'An affordable meat-free rice dinner with mushrooms and a savoury soy sauce. Photo is illustrative.',
    photoUrl: stirFryPhoto, mealtime: 'Dinner', cuisine: 'Chinese', totalMinutes: 35, servings: 4,
    ingredients: [['Rice', 300, 'g'], ['Water', 650, 'ml'], ['Tofu', 500, 'g'], ['Mushroom', 250, 'g'], ['Garlic', 3, 'cloves'], ['Ginger', 15, 'g'], ['Soy sauce', 2, 'tbsp'], ['Sugar', 1, 'tsp'], ['Vegetable oil', 2, 'tbsp'], ['Spring onion', 2, 'stalks']],
    steps: ['Cook the rinsed rice with 500 ml water, adjusting for your rice variety. Reserve 150 ml for braising.', 'Drain and cube firm tofu, slice the mushrooms, mince the garlic and slice the ginger.', 'Heat the oil and pan-fry tofu until lightly golden. Add mushrooms, garlic and ginger and cook for 3 minutes.', 'Add soy sauce, sugar and the reserved water. Simmer uncovered for 8–10 minutes, turning the tofu gently. Finish with sliced spring onion and serve with rice.'],
  },
  {
    title: 'Chicken Adobo Rice Plates',
    description: 'A home-style chicken adobo with soy, vinegar and garlic. Serve its sauce spooned over rice. Photo is illustrative.',
    photoUrl: ricePhoto, mealtime: 'Lunch', cuisine: 'Filipino', totalMinutes: 55, servings: 4,
    ingredients: [['Rice', 300, 'g'], ['Water', 650, 'ml'], ['Chicken', 800, 'g'], ['Soy sauce', 3, 'tbsp'], ['Vinegar', 3, 'tbsp'], ['Garlic', 6, 'cloves'], ['Bay leaf', 2, 'pcs'], ['Black pepper', 0.5, 'tsp'], ['Vegetable oil', 1, 'tbsp']],
    steps: ['Cook the rinsed rice with 500 ml water, adjusting for your rice variety. Reserve 150 ml for the chicken.', 'Cut the chicken thighs into large pieces and crush the garlic. Heat the oil and brown the chicken on both sides.', 'Add garlic, soy sauce, vinegar, bay leaves, pepper and reserved water. Bring to a boil, then cover and simmer gently for 25–30 minutes, until the chicken is fully cooked and tender.', 'Uncover and simmer for 5–10 minutes to reduce the sauce. Remove bay leaves and serve the chicken and sauce with rice.'],
  },
  {
    title: 'Chicken and Egg Donburi',
    description: 'A home-style oyakodon-inspired bowl with chicken, onion and softly set egg. This version uses water and soy sauce instead of dashi. Photo is illustrative.',
    photoUrl: ricePhoto, mealtime: 'Breakfast', cuisine: 'Japanese', totalMinutes: 30, servings: 3,
    ingredients: [['Rice', 240, 'g'], ['Water', 550, 'ml'], ['Chicken', 350, 'g'], ['Egg', 4, 'pcs'], ['Onion', 1, 'pcs'], ['Soy sauce', 2, 'tbsp'], ['Sugar', 2, 'tsp'], ['Spring onion', 1, 'stalks']],
    steps: ['Cook the rinsed rice with 400 ml water, adjusting for your rice variety. Reserve 150 ml for the topping.', 'Slice the onion thinly and cut chicken into small pieces. Bring reserved water, soy sauce and sugar to a simmer in a wide pan.', 'Add onion and chicken. Cover and simmer for 8–10 minutes, until the chicken is cooked through.', 'Beat the eggs and pour evenly over the chicken. Cover and cook gently until the eggs are set. Spoon onto rice and top with sliced spring onion.'],
  },
  {
    title: 'Simple Scallion Pancakes',
    description: 'Crisp pan-fried spring onion pancakes for a savoury snack. A simple home-style dough with a soy-vinegar dip. Photo is illustrative.',
    photoUrl: photo('photo-1528207776546-365bb710ee93'), mealtime: 'Snack', cuisine: 'Chinese', totalMinutes: 55, servings: 4,
    ingredients: [['Flour', 250, 'g'], ['Water', 160, 'ml'], ['Spring onion', 4, 'stalks'], ['Salt', 0.5, 'tsp'], ['Vegetable oil', 4, 'tbsp'], ['Soy sauce', 1, 'tbsp'], ['Vinegar', 1, 'tbsp']],
    steps: ['Mix flour and salt. Gradually stir in warm water to make a soft dough, then knead for 5 minutes. Cover and rest for 20 minutes.', 'Finely slice the spring onions. Divide dough into four pieces and roll each into a thin round. Brush the rounds with 2 tbsp oil in total and scatter with spring onion.', 'Roll each round into a rope, coil into a spiral, then gently flatten and roll into a pancake.', 'Heat the remaining oil in a frying pan in batches. Fry each pancake over medium heat for 3–4 minutes per side, until golden and cooked through. Mix soy sauce and vinegar for dipping.'],
  },
]
