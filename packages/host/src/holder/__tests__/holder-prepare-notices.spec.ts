import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, seedSession, THREAD_ID } from './holder-rig'

const typesOf = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<string[]> =>
  (await rig.events()).map((event) => event.type)

describe('SessionHolder prepare notices', () => {
  it('records a boot notice as a context-loaded event before workspace-prepared', async () => {
    const rig = await makeRig({
      prepare: async () => ({
        ok: true,
        notices: [
          { slot: 'project-file-mounts', content: 'Atlas wrote the project files: .env.keys.' },
        ],
      }),
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.wake()
    const prepared = await flushUntil({
      check: async () => (await typesOf(rig)).includes('workspace-prepared'),
    })

    expect(prepared).toBe(true)
    expect(await typesOf(rig)).toEqual([
      'workspace-attempt-started',
      'context-loaded',
      'workspace-prepared',
    ])
    const page = await rig.plane.readEvents({
      threadId: THREAD_ID,
      afterSeq: 0,
      limit: 10,
      visible: true,
    })
    const noticed = page.events.find((event) => event.type === 'context-loaded')
    expect(noticed).toMatchObject({
      slot: 'project-file-mounts',
      key: 'boot',
      content: 'Atlas wrote the project files: .env.keys.',
    })
  })

  it('records the boot notice beside a setup warning', async () => {
    const rig = await makeRig({
      prepare: async () => ({
        ok: true,
        warnings: ['the setup script failed'],
        notices: [{ slot: 'project-file-mounts', content: 'Atlas wrote the project files: .env.' }],
      }),
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.wake()
    await flushUntil({
      check: async () => (await typesOf(rig)).includes('workspace-prepared'),
    })

    expect(await typesOf(rig)).toEqual([
      'workspace-attempt-started',
      'context-loaded',
      'sandbox-setup-reported',
      'workspace-prepared',
    ])
  })
})
