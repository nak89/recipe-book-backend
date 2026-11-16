import type { Prisma } from '@prisma/client'
import { prisma } from './database.js'
import { HttpError } from '../httpError.js'

async function takeSlot(tx: Prisma.TransactionClient, key: string, limit: number, scope: 'user' | 'global') {
  const rows = await tx.$queryRaw<{ expiresAt: Date }[]>`
    INSERT INTO public."RecipeDraftQuota" AS quota ("key", "count", "expiresAt")
    VALUES (${key}, 1, CURRENT_TIMESTAMP + INTERVAL '24 hours')
    ON CONFLICT ("key") DO UPDATE
    SET "count" = CASE WHEN quota."expiresAt" <= CURRENT_TIMESTAMP THEN 1 ELSE quota."count" + 1 END,
        "expiresAt" = CASE WHEN quota."expiresAt" <= CURRENT_TIMESTAMP
          THEN CURRENT_TIMESTAMP + INTERVAL '24 hours' ELSE quota."expiresAt" END
    WHERE quota."expiresAt" <= CURRENT_TIMESTAMP OR quota."count" < ${limit}
    RETURNING "expiresAt"
  `
  if (rows.length) return

  // The rejected upsert locks the existing row until the transaction rolls back.
  const [bucket] = await tx.$queryRaw<{ expiresAt: Date }[]>`
    SELECT "expiresAt" AT TIME ZONE 'UTC' AS "expiresAt"
    FROM public."RecipeDraftQuota" WHERE "key" = ${key}
  `
  throw new HttpError(429, 'Recipe import limit reached. Try again later.', {
    code: scope === 'user' ? 'recipe_draft_user_limit' : 'recipe_draft_global_limit',
    retryAt: bucket?.expiresAt.toISOString(),
  })
}

export async function consumeRecipeDraftQuota(userId: string, kind: 'draft' | 'photo') {
  // Both counters advance together. PostgreSQL serializes concurrent updates to the shared row.
  await prisma.$transaction(async tx => {
    await takeSlot(tx, `${kind}:user:${userId}`, 5, 'user')
    await takeSlot(tx, `${kind}:global`, kind === 'photo' ? 20 : 40, 'global')
  })
}
