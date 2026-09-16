import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'

let instance: PrismaClient | undefined

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — run through the env:inject script')
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

export const db = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    instance ??= createClient()
    return Reflect.get(instance, property, receiver)
  },
})
