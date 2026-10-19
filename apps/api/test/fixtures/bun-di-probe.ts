import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../../src/api/app.module'
import { GithubSandboxWakeService } from '../../src/api/cloud/github/github-sandbox-wake.service'
import { SandboxesService } from '../../src/api/platform/sandboxes/sandboxes.service'

function injectedField({ instance, field }: { instance: object; field: string }): boolean {
  return (instance as Record<string, unknown>)[field] !== undefined
}

const context = await NestFactory.createApplicationContext(AppModule, { logger: false })

const result = {
  sandboxesArchives: injectedField({ instance: context.get(SandboxesService), field: 'archives' }),
  wakeBootAdapter: injectedField({
    instance: context.get(GithubSandboxWakeService),
    field: 'bootAdapter',
  }),
}

console.log(JSON.stringify(result))
await context.close()
process.exit(Object.values(result).every(Boolean) ? 0 : 1)
