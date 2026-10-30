import { encodeSettingValue } from '@dltech/atlas-wire/web'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { runPodProvision } from './pod-provision-run'
import {
  fakeBoot,
  runDepsWith,
  sandboxRows,
  seedSandboxRow,
  seedThread,
} from './sandbox-provisioning.fixture'

const payloadOf = async () => {
  const [row] = await sandboxRows()
  return { threadId: 'thr-1', wakeClaim: row?.wakeClaim?.toISOString() ?? '' }
}

describe('runPodProvision size', () => {
  useTestDatabase()

  it("boots with the owner's sandbox.vcpus setting", async () => {
    await seedThread()
    await seedSandboxRow()
    await db.orm.public.UserSetting.create({
      id: 'set-1',
      userId: 'usr-1',
      key: 'sandbox.vcpus',
      value: encodeSettingValue(8),
    })
    const { boot, calls } = fakeBoot()

    await runPodProvision({ payload: await payloadOf(), deps: runDepsWith({ boot }) })

    expect(calls[0]?.vcpus).toBe(8)
  })

  it("boots with the session project's size over the personal default", async () => {
    await seedThread()
    await seedSandboxRow()
    await db.orm.public.Project.where({ id: 'prj-1' }).update({ sandboxVcpus: 4 })
    const { boot, calls } = fakeBoot()

    await runPodProvision({ payload: await payloadOf(), deps: runDepsWith({ boot }) })

    expect(calls[0]?.vcpus).toBe(4)
  })
})
