# Recipe Book API

REST API backend for a personal recipe book app, built with Node.js, Express, PostgreSQL, and Prisma.

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express
- **Database**: PostgreSQL
- **ORM**: Prisma 7 (with `@prisma/adapter-pg`)

## Data Model

A `Recipe` has many `Ingredient`s and `Step`s (one-to-many relations), plus a `tools` array of strings.

## Setup

1. Install dependencies:
npm install

2. Create a `.env` file with your local database connection:
DATABASE_URL="postgresql://YOUR_USERNAME@localhost:5432/recipe_book?schema=public"

3. Run migrations:
npx prisma migrate dev

4. Seed the database with sample recipes:
npx prisma db seed

5. Start the dev server:
npm run dev

Server runs on `http://localhost:3000`.

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/recipes` | Get all recipes |
| GET | `/recipes/:id` | Get one recipe by id |
| POST | `/recipes` | Create a new recipe |
| PUT | `/recipes/:id` | Update an existing recipe |
| DELETE | `/recipes/:id` | Delete a recipe |

### Example request body (POST/PUT)

```json
{
  "title": "Spaghetti Carbonara",
  "description": "Classic Italian pasta dish",
  "photoUrl": "https://example.com/photo.jpg",
  "difficulty": "Intermediate",
  "totalMinutes": 30,
  "servings": 4,
  "tools": ["large pot", "frying pan"],
  "ingredients": [
    { "name": "spaghetti", "quantity": 400, "unit": "g" }
  ],
  "steps": [
    { "stepNumber": 1, "instruction": "Boil pasta until al dente" }
  ]
}
```
