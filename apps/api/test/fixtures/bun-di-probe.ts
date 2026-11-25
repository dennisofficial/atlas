import 'reflect-metadata'
import '@nestjs/common'
import { NestFactory } from '@nestjs/core'

function injectedField({ instance, field }: { instance: object; field: string }): boolean {
  return (instance as Record<string, unknown>)[field] !== undefined
}

// The app graph is imported only after @nestjs/common and @nestjs/core finish loading: the CJS
// @nestjs/throttler require()s them while Bun may still be fetching them as ESM, which throws
// "require() async module ... is unsupported" (https://github.com/oven-sh/bun/issues/33180).
const { ApiModule } = await import('../../src/api/api.module')
const { SessionMiddleware } = await import('../../src/_module/session/session.middleware')

const context = await NestFactory.createApplicationContext(ApiModule, { logger: false })

const result = {
  sessionMiddlewareVerifier: injectedField({
    instance: context.get(SessionMiddleware),
    field: 'verifier',
  }),
}

console.log(JSON.stringify(result))
await context.close()
process.exit(Object.values(result).every(Boolean) ? 0 : 1)
