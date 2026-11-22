import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { seedThreadRow, USER_A } from '../../../../test/session-seed'
import { prepareSandboxes, THREAD } from '../../platform/sandboxes/sandboxes.fixture'
import {
  fakeScoped,
  launchWith,
  seedBase,
} from '../sandbox-provisioning/sandbox-provisioning.fixture'
import { ScopedSandboxCredentialsService } from './scoped-sandbox-credentials.service'

const serviceWith = () => new ScopedSandboxCredentialsService(fakeScoped())

describe('ScopedSandboxCredentialsService provenance', () => {
  useTestDatabase()

  it('gives a TUI-registered no-project thread the platform account', async () => {
    const { service } = await prepareSandboxes()
    await service.claim({
      userId: USER_A,
      threadId: THREAD,
      clientToken: 'a'.repeat(64),
      serveUrl: 'https://atlas-3000-abc.vercel.run',
    })
    expect((await db.orm.public.Session.first({ id: `ses_${THREAD}` }))?.executionLocation).toBe(
      'cloud',
    )

    const credentials = await serviceWith().forThread({ threadId: THREAD })

    expect(credentials).toMatchObject({
      token: 'ws-token',
      teamId: 'team-ws',
      projectId: 'vcl-proj',
      ownerCredential: true,
      userId: USER_A,
    })
  })

  it('gives a launched no-project thread the same platform account', async () => {
    await seedBase()
    const { service } = launchWith()
    const reply = await service.launch({
      userId: 'usr-1',
      draft: {},
      firstMessage: { sendId: 'snd-1', text: 'hi' },
    })

    const credentials = await serviceWith().forThread({ threadId: reply.thread.id ?? '' })

    expect(credentials).toMatchObject({ token: 'ws-token', ownerCredential: true })
  })

  it('gives a thread with a failed launch the platform account too', async () => {
    await seedBase()
    await seedThreadRow({ id: 'thr-gap', userId: 'usr-1' })
    await db.orm.public.SandboxBootStep.create({
      sessionId: 'ses_thr-gap',
      step: 'provision',
      state: 'error',
      error: 'no credential',
    })

    const credentials = await serviceWith().forThread({ threadId: 'thr-gap' })

    expect(credentials).toMatchObject({ token: 'ws-token', ownerCredential: true })
  })
})
