import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  EUploadState,
  toRunId,
  toThreadId,
  type SaidUpload,
  type ThreadId,
  type UploadPlacement,
} from '@dltech/atlas-core'
import { SaidUploadsPort } from '@dltech/atlas-agent'
import { ScriptedModel } from '@dltech/atlas-agent/testing'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const UPLOAD: SaidUpload = {
  uploadId: '0b9f3c1e-5d2a-4c8e-9a41-7e6d2f8b1a30',
  pathname: 'composer-uploads/user-1/0b9f3c1e-5d2a-4c8e-9a41-7e6d2f8b1a30/a.sh',
  name: 'a.sh',
  size: 12,
  mediaType: 'text/x-shellscript',
}
const PLACED = `/atlas/home/uploads/${UPLOAD.uploadId}/a.sh`

class RecordingUploads extends SaidUploadsPort {
  readonly calls: { threadId: ThreadId; uploadIds: string[]; current: string[] }[] = []

  constructor(private readonly placement: UploadPlacement) {
    super()
  }

  async place(args: {
    threadId: ThreadId
    uploads: readonly SaidUpload[]
    currentUploadIds?: ReadonlySet<string> | undefined
  }): Promise<ReadonlyMap<string, UploadPlacement>> {
    this.calls.push({
      threadId: args.threadId,
      uploadIds: args.uploads.map((upload) => upload.uploadId),
      current: [...(args.currentUploadIds ?? [])],
    })
    return new Map(args.uploads.map((upload) => [upload.uploadId, this.placement]))
  }
}

const seedUploadMessage = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<void> => {
  const { epoch } = await rig.plane.grant({ sessionId: SESSION, hostId: 9001 })
  const outcome = await rig.plane.append({
    threadId: THREAD_ID,
    epoch,
    events: chainEvents({
      threadId: toThreadId(THREAD_ID),
      runId: toRunId('seed-run'),
      epoch,
      at: new Date(0).toISOString(),
      bodies: [{ type: 'user-said', text: 'run the attached script', uploads: [UPLOAD] }],
      from: await rig.plane.head({ threadId: THREAD_ID }),
    }),
  })
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusal))
  await rig.plane.revoke({ sessionId: SESSION, wantsHolder: false })
}

const answered = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<boolean> =>
  flushUntil({
    check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
  })

const requestText = (model: ScriptedModel): string => JSON.stringify(model.requests[0]?.assembled)

describe('SessionHolder uploads', () => {
  it('places the uploads of the turn and names the absolute path to the model', async () => {
    const uploads = new RecordingUploads({ state: EUploadState.Ready, path: PLACED })
    const model = new ScriptedModel([{ text: 'ran it' }])
    const rig = await makeRig({ uploads, model: () => model })
    await seedSession(rig)
    await seedUploadMessage(rig)
    await rig.holder.start()
    await rig.post('go')
    await rig.wake()

    expect(await answered(rig)).toBe(true)
    expect(uploads.calls[0]?.uploadIds).toEqual([UPLOAD.uploadId])
    expect(uploads.calls[0]?.current).toEqual([UPLOAD.uploadId])
    expect(requestText(model)).toContain(PLACED)
  })

  it('tells the model a missing upload is no longer available', async () => {
    const uploads = new RecordingUploads({ state: EUploadState.Missing })
    const model = new ScriptedModel([{ text: 'ok' }])
    const rig = await makeRig({ uploads, model: () => model })
    await seedSession(rig)
    await seedUploadMessage(rig)
    await rig.holder.start()
    await rig.post('go')
    await rig.wake()

    expect(await answered(rig)).toBe(true)
    expect(requestText(model)).toContain('a.sh: no longer available')
  })
})
