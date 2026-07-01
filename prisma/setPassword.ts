import 'dotenv/config'
import bcrypt from 'bcrypt'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  const plainPassword = 'test123'
  const hashedPassword = await bcrypt.hash(plainPassword, 10)

  await prisma.user.update({
    where: { email: 'test@gmail.com' },
    data: { password: hashedPassword },
  })

  console.log('Password updated successfully')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })