import type { Prisma } from '@prisma/client'
import { prisma } from './database.js'
import { HttpError } from '../httpError.js'

async function takeSlot(tx: Prisma.TransactionClient, key: string, limit: number) {
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
  if (!rows.length) throw new HttpError(429, 'Recipe import limit reached. Try again later.')
}

export async function consumeRecipeDraftQuota(userId: string, kind: 'draft' | 'photo') {
  // Both counters advance together. PostgreSQL serializes concurrent updates to the shared row.
  await prisma.$transaction(async tx => {
    await takeSlot(tx, `${kind}:user:${userId}`, 5)
    await takeSlot(tx, `${kind}:global`, kind === 'photo' ? 20 : 40)
  })
}
