import 'reflect-metadata'
import '@nestjs/common'
import { NestFactory } from '@nestjs/core'

function injectedField({ instance, field }: { instance: object; field: string }): boolean {
  return (instance as Record<string, unknown>)[field] !== undefined
}

// The app graph is imported only after @nestjs/common and @nestjs/core finish loading: the CJS
// @nestjs/throttler require()s them while Bun may still be fetching them as ESM, which throws
// "require() async module ... is unsupported" (https://github.com/oven-sh/bun/issues/33180).
const { AppModule } = await import('../../src/api/app.module')
const { GithubSandboxWakeService } = await import(
  '../../src/api/cloud/github/github-sandbox-wake.service'
)
const { SessionAuthGuard } = await import('../../src/_module/session/session-auth.guard')

const context = await NestFactory.createApplicationContext(AppModule, { logger: false })

const result = {
  sessionAuthVerifier: injectedField({
    instance: context.get(SessionAuthGuard),
    field: 'verifier',
  }),
  wakeBootAdapter: injectedField({
    instance: context.get(GithubSandboxWakeService),
    field: 'bootAdapter',
  }),
}

console.log(JSON.stringify(result))
await context.close()
process.exit(Object.values(result).every(Boolean) ? 0 : 1)
