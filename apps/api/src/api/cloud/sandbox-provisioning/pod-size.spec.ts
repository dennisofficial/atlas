import { encodeSettingValue } from '@dltech/atlas-wire/web'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { podVcpusOf } from './pod-size'
import { seedThread } from './sandbox-provisioning.fixture'

const scope = { sessionId: 'ses_thr-1', userId: 'usr-1' }

const setPersonal = (value: string) =>
  db.orm.public.UserSetting.create({
    id: 'set-1',
    userId: 'usr-1',
    key: 'sandbox.vcpus',
    value,
  })

describe('podVcpusOf', () => {
  useTestDatabase()

  it('leaves the size to Vercel when neither the project nor the user set one', async () => {
    await seedThread()
    expect(await podVcpusOf(scope)).toBeUndefined()
  })

  it("uses the owner's sandbox.vcpus setting", async () => {
    await seedThread()
    await setPersonal(encodeSettingValue(8))
    expect(await podVcpusOf(scope)).toBe(8)
  })

  it("prefers the session project's size over the personal default", async () => {
    await seedThread()
    await setPersonal(encodeSettingValue(8))
    await db.orm.public.Project.where({ id: 'prj-1' }).update({ sandboxVcpus: 4 })
    expect(await podVcpusOf(scope)).toBe(4)
  })

  it('falls back to the personal default for a session without a project', async () => {
    await seedThread({ projectId: null })
    await setPersonal(encodeSettingValue(6))
    expect(await podVcpusOf(scope)).toBe(6)
  })

  it('ignores a stored value outside the vCPU steps', async () => {
    await seedThread()
    await setPersonal(encodeSettingValue(3))
    expect(await podVcpusOf(scope)).toBeUndefined()
  })
})
