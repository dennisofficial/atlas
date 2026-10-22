import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../../src/api/app.module'
import { GithubSandboxWakeService } from '../../src/api/cloud/github/github-sandbox-wake.service'
import { SessionAuthGuard } from '../../src/_module/session/session-auth.guard'

function injectedField({ instance, field }: { instance: object; field: string }): boolean {
  return (instance as Record<string, unknown>)[field] !== undefined
}

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
