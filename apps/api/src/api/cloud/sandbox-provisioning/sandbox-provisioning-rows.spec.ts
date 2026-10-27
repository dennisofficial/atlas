import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { hashSessionToken } from '../../platform/sandboxes/sandbox-tokens'
import { cipher, sandboxRows, seedSandboxRow, seedThread } from './sandbox-provisioning.fixture'
import { claimRow } from './sandbox-provisioning-rows'

const HELD_TOKEN = 'seed-token'

const threadRow = async () => {
  const thread = await db.orm.public.Thread.first({ id: 'thr-1' })
  if (thread === null) throw new Error('no thread')
  return thread
}

const heldRow = async () => {
  const held = (await sandboxRows())[0]
  if (held === undefined) throw new Error('no sandbox row')
  return held
}

describe('claimRow', () => {
  useTestDatabase()

  it('keeps the serve token an existing row already holds', async () => {
    await seedThread()
    await seedSandboxRow({ wakeClaim: null, wakeFailedAt: new Date() })
    await db.orm.public.CloudSandbox.where({ threadId: 'thr-1' }).update({
      tokenHash: hashSessionToken(HELD_TOKEN),
    })
    const before = await heldRow()

    const claim = await claimRow({
      thread: await threadRow(),
      existing: before,
      cipher,
    })

    expect(claim?.token).toBe(HELD_TOKEN)
    const after = await heldRow()
    expect(after.tokenHash).toBe(before.tokenHash)
    expect(after.sealedToken).toBe(before.sealedToken)
    expect(after.wakeClaim).not.toBeNull()
    expect(after.state).toBe('resuming')
  })

  it('mints a token for an existing row that holds none', async () => {
    await seedThread()
    await seedSandboxRow({ wakeClaim: null, wakeFailedAt: new Date() })
    await db.orm.public.CloudSandbox.where({ threadId: 'thr-1' }).update({ sealedToken: null })

    const claim = await claimRow({
      thread: await threadRow(),
      existing: await heldRow(),
      cipher,
    })

    const after = await heldRow()
    expect(claim?.token).toHaveLength(43)
    expect(after.tokenHash).toBe(hashSessionToken(claim?.token ?? ''))
    expect(cipher.decrypt(after.sealedToken ?? '')).toBe(claim?.token ?? '')
  })

  it('mints a token for a new row', async () => {
    await seedThread()

    const claim = await claimRow({ thread: await threadRow(), existing: null, cipher })

    const after = await heldRow()
    expect(claim?.token).toHaveLength(43)
    expect(cipher.decrypt(after.sealedToken ?? '')).toBe(claim?.token ?? '')
  })
})
