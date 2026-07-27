# Recipe Book API

REST API backend for a personal recipe book app, built with Node.js, Express, PostgreSQL (hosted on Supabase), and Prisma. Auth and photo storage are handled by Supabase; this API owns recipe CRUD.

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express
- **Database**: PostgreSQL, hosted on Supabase
- **ORM**: Prisma 7 (with `@prisma/adapter-pg`)
- **Auth**: Supabase Auth — this API verifies Supabase-issued JWTs (`middleware/auth.ts`); `routes/auth.ts` proxies signup/login to Supabase so existing clients keep the same `{ token, user }` response shape
- **Photo storage**: Supabase Storage (`routes/upload.ts`)

## Data Model

A `Recipe` has many `Ingredient`s and `Step`s (one-to-many relations), plus a `tools` array of strings. `Recipe.userId` references a Supabase `auth.users` id — that table lives outside this Prisma schema, so there's no Prisma-level relation or cascade on it.

## Setup

1. Install dependencies:
npm install

2. Create a Supabase project (supabase.com), then fill in `.env`:
   - `DATABASE_URL` — Settings -> Database -> Connection string -> URI (use the Transaction pooler entry, port 6543)
   - `SUPABASE_URL` — Settings -> API
   - `SUPABASE_SECRET_KEY` — Settings -> API. Server-only; verifies tokens and writes to Storage.
   - `SUPABASE_PUBLISHABLE_KEY` — Settings -> API. Used by the `/auth` sign-up/sign-in proxy routes.
   - `SUPABASE_STORAGE_BUCKET` — name of a public Storage bucket for recipe photos (defaults to `recipe-photos`)

3. Run migrations:
npx prisma migrate dev

4. (Optional) Seed the database with sample recipes — sign up a test account first, grab its id from Authentication -> Users in the Supabase dashboard, then:
SEED_USER_ID=<supabase-user-id> npx prisma db seed

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
