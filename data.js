export const recipes = [
  {
    id: "1",
    title: "Spaghetti Carbonara",
    description: "Classic Italian pasta with eggs, cheese, and pancetta",
    photoUrl: "https://images.unsplash.com/photo-1612874742237-6526221588e3",
    difficulty: "Intermediate",
    totalMinutes: 30,
    servings: 4,
    ingredients: [
      { name: "spaghetti", quantity: 400, unit: "g" },
      { name: "eggs", quantity: 4, unit: "whole" },
      { name: "pancetta", quantity: 150, unit: "g" },
      { name: "parmesan", quantity: 50, unit: "g" }
    ],
    tools: ["large pot", "frying pan", "whisk"],
    steps: [
      { stepNumber: 1, instruction: "Boil pasta in salted water until al dente" },
      { stepNumber: 2, instruction: "Fry pancetta until crispy" },
      { stepNumber: 3, instruction: "Whisk eggs and parmesan together" },
      { stepNumber: 4, instruction: "Combine everything off heat, tossing quickly" }
    ]
  }
]