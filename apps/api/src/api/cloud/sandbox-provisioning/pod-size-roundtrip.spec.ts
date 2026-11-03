import { encodeSettingValue } from '@dltech/atlas-wire/web'
import { db } from '@dltech/atlas-db'
import { seedSession, useTestDatabase } from '@dltech/atlas-db/testing'
import type { INestApplication, Provider } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { createPersonalApp, trpcMutate } from '../personal-resources.router.fixture'
import { SettingsRouter } from '../settings/settings.router'
import { SettingsService } from '../settings/settings.service'
import { VercelPlanService } from '../user-vercel/vercel-credential-plan'
import { unknownPlanService } from '../user-vercel/vercel-testkit'
import { podVcpusOf } from './pod-size'

const PROVIDERS: Provider[] = [
  SettingsRouter,
  SettingsService,
  { provide: VercelPlanService, useValue: unknownPlanService() },
]

describe('podVcpusOf reads what the web personal settings save', () => {
  useTestDatabase()
  let app: INestApplication

  beforeEach(async () => {
    await seedSessionUsers()
    app = await createPersonalApp(PROVIDERS)
  })

  afterEach(() => app.close())

  it('round-trips a personal sandbox.vcpus through settings.patch', async () => {
    await seedSession({ db, id: 'ses_thr-1', userId: 'user-a' })

    await trpcMutate({
      app,
      procedure: 'settings.patch',
      token: 'session-a',
      input: { values: { 'sandbox.vcpus': encodeSettingValue(32) } },
    }).expect(200)

    expect(await podVcpusOf({ sessionId: 'ses_thr-1', userId: 'user-a' })).toBe(32)
  })
})
