import { defineConfig as ormConfig } from '@prisma/orm-postgres/config'
import { definePrismaConfig } from 'prisma/config'

const connection = process.env.DIRECT_URL ?? process.env.DATABASE_URL

const config: ReturnType<typeof definePrismaConfig> = definePrismaConfig({
  orm: ormConfig({
    contract: './src/prisma/schema/**/*.prisma',
    db: connection === undefined ? {} : { connection },
  }),
})

export default config
