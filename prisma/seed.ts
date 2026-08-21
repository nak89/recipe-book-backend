import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg' 

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

// Recipes are scoped to a Supabase auth user id. Sign up a test account first,
// grab its id from the Supabase dashboard (Authentication -> Users), and set
// SEED_USER_ID before running this script.
if (!process.env.SEED_USER_ID) {
    throw new Error('Set SEED_USER_ID to a real Supabase auth user id before seeding')
}
const seedUserId: string = process.env.SEED_USER_ID

//initalise new tables for datas
async function main() {
    await prisma.recipe.create({
    data: {
        title: "Spaghetti Carbonara",
        description: "Classic Italian pasta with eggs, cheese, and pancetta",
        photoUrl: "https://images.unsplash.com/photo-1612874742237-6526221588e3",
        difficulty: "Intermediate",
        totalMinutes: 30,
        servings: 4,
        tools: ["large pot", "frying pan", "whisk"],
        userId: seedUserId,
        ingredients: {
            create: [
            { name: "spaghetti", quantity: 400, unit: "g", position: 0 },
            { name: "eggs", quantity: 4, unit: "whole", position: 1 },
            { name: "pancetta", quantity: 150, unit: "g", position: 2 },
            { name: "parmesan", quantity: 50, unit: "g", position: 3 },
            ],
        },
        steps: {
            create: [
            { stepNumber: 1, instruction: "Boil pasta in salted water until al dente" },
            { stepNumber: 2, instruction: "Fry pancetta until crispy" },
            { stepNumber: 3, instruction: "Whisk eggs and parmesan together" },
            { stepNumber: 4, instruction: "Combine everything off heat, tossing quickly" },
            ],
        },
        },
    })
    await prisma.recipe.create({
        data: {
        title: "Avocado Toast",
        description: "Simple, healthy breakfast",
        photoUrl: "https://images.unsplash.com/photo-1541519227354-08fa5d50c44d",
        difficulty: "Beginner",
        totalMinutes: 10,
        servings: 1,
        tools: ["toaster", "fork"],
        userId: seedUserId,
        ingredients: {
            create: [
            { name: "bread", quantity: 2, unit: "whole", position: 0 },
            { name: "avocado", quantity: 1, unit: "whole", position: 1 },
            { name: "lemon juice", quantity: 1, unit: "tsp", position: 2 },
            ],
        },
        steps: {
            create: [
            { stepNumber: 1, instruction: "Toast the bread" },
            { stepNumber: 2, instruction: "Mash avocado with lemon juice" },
            { stepNumber: 3, instruction: "Spread on toast" },
            ],
        },
        },
    })  
    
    console.log("Seed data created!")
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })


