import { defineConfig as ormConfig } from '@prisma/orm-postgres/config'
import { definePrismaConfig } from 'prisma/config'

const config: ReturnType<typeof definePrismaConfig> = definePrismaConfig({
  orm: ormConfig({
    contract: './src/prisma/schema/**/*.prisma',
    db: { connection: process.env.DIRECT_URL ?? process.env.DATABASE_URL },
  }),
})

export default config
