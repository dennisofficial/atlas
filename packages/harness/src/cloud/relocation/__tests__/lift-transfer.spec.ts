import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'
import { EClientRequest, type GpgKeyMaterial } from '@dltech/atlas-harness'

import { useAtlasHome } from './descend-fixture'
import { fakeEventLog } from './fake-backend'
import { liftToCloud } from '../lift'
import { CLEAN_WORKSPACE, CLOUD_THREAD } from './fixture'
import { FOOTER_SELECTION, harness } from './lift-fixture'
import { seedLocalTranscript } from './lift-seed'

describe('the transcript and payload the lift transfers', () => {
  it('tells the serve to restore the late-shipped transcript before the conversation opens', async () => {
    useAtlasHome()
    const test = harness()
    await seedLocalTranscript(test)

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.channel.requests.map((r) => r.op)).toContain(
      EClientRequest.RestoreTranscript,
    )
  })

  it('carries the whole local transcript across in the session archive', async () => {
    useAtlasHome()
    const test = harness()
    await seedLocalTranscript(test)

    await liftToCloud(test.args)

    expect(test.bridge.transcriptPuts).toHaveLength(1)
    const archivePath = test.bridge.transcriptPuts[0]?.archivePath
    if (archivePath === undefined) throw new Error('the lift shipped no transcript archive')
    const archive = await readFile(archivePath)
    expect(archive.length).toBeGreaterThan(0)
    expect(archive.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]))
  })

  it('uploads no transcript for a conversation nobody has spoken in, and still attaches', async () => {
    useAtlasHome()
    const test = harness({ started: false, localLog: fakeEventLog([]) })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.transcriptPuts).toEqual([])
    expect(test.bridge.trail).toEqual(['sandbox', 'attach'])
  })

  it('records an unstarted thread as cloud, so a later boot routes its resume to the attach path', async () => {
    useAtlasHome()
    const test = harness({ started: false, localLog: fakeEventLog([]) })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    const writes = test.localThreads.chosenLocations.filter(
      (chosen) => chosen.location === EExecutionLocation.Cloud,
    )
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.at(-1)).toEqual({
      threadId: CLOUD_THREAD,
      location: EExecutionLocation.Cloud,
    })
    expect((await test.localThreads.find({ threadId: CLOUD_THREAD }))?.executionLocation).toBe(
      EExecutionLocation.Cloud,
    )
  })

  it('attaches to the sandbox the provision handed back', async () => {
    useAtlasHome()
    const test = harness()
    await seedLocalTranscript(test)

    const lifted = await liftToCloud(test.args)
    if (!lifted.ok) throw new Error('expected the lift to succeed')

    expect(test.bridge.attached).toEqual([
      {
        threadId: CLOUD_THREAD,
        url: lifted.sandbox.url,
        token: lifted.sandbox.token,
      },
    ])
  })

  it('sends the git identity and the uncommitted patch with the sandbox request', async () => {
    useAtlasHome()
    const dirty = { ...CLEAN_WORKSPACE, patch: 'diff --git a/x b/x\n' }
    const test = harness({ capture: async () => dirty })
    await seedLocalTranscript(test)

    await liftToCloud(test.args)

    expect(test.bridge.created).toEqual([
      { threadId: CLOUD_THREAD, workspace: dirty, model: FOOTER_SELECTION.ref },
    ])
  })

  it("carries the operator's gpg material to the sandbox request, stringified", async () => {
    useAtlasHome()
    const material: GpgKeyMaterial = {
      keyId: 'DEADBEEF1234',
      publicKey: 'PUBLIC BLOCK',
      secretKey: 'SECRET BLOCK',
      ownerTrust: 'TRUST',
      sign: true,
    }
    const test = harness({ captureGpg: async () => material })
    await seedLocalTranscript(test)

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.created).toEqual([
      {
        threadId: CLOUD_THREAD,
        workspace: CLEAN_WORKSPACE,
        gpgKey: JSON.stringify(material),
        model: FOOTER_SELECTION.ref,
      },
    ])
  })

  it('sends no gpg key when the operator has no signing material', async () => {
    useAtlasHome()
    const test = harness({ captureGpg: async () => null })
    await seedLocalTranscript(test)

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.created).toEqual([
      {
        threadId: CLOUD_THREAD,
        workspace: CLEAN_WORKSPACE,
        model: FOOTER_SELECTION.ref,
      },
    ])
  })

  it('carries the thread’s model to the sandbox request so the cloud session stays on it', async () => {
    useAtlasHome()
    const test = harness({})
    await seedLocalTranscript(test)

    await liftToCloud(test.args)

    expect(test.bridge.created).toEqual([
      {
        threadId: CLOUD_THREAD,
        workspace: CLEAN_WORKSPACE,
        model: FOOTER_SELECTION.ref,
      },
    ])
  })

  it("carries the operator's context archive onto the row before the sandbox boots, so serve finds it on the first poll", async () => {
    useAtlasHome()
    const archive = Buffer.from('a fake tar.gz')
    const test = harness({ captureContext: async () => archive })
    await seedLocalTranscript(test)

    await liftToCloud(test.args)

    expect(test.bridge.created).toEqual([
      {
        threadId: CLOUD_THREAD,
        workspace: CLEAN_WORKSPACE,
        model: FOOTER_SELECTION.ref,
      },
    ])
    expect(test.bridge.contextPuts).toEqual([{ threadId: CLOUD_THREAD, archive }])
    expect(test.bridge.trail).toEqual([
      'put-transcript',
      'put-context',
      'sandbox',
      'confirm-landed',
      'attach',
    ])
  })

  it('sends no context archive request when there is nothing to carry', async () => {
    useAtlasHome()
    const test = harness()
    await seedLocalTranscript(test)

    await liftToCloud(test.args)

    expect(test.bridge.contextPuts).toEqual([])
    expect(test.bridge.trail).toEqual(['put-transcript', 'sandbox', 'confirm-landed', 'attach'])
  })
})
