import { describe, expect, it } from 'bun:test'

import { LogPort, type LogEntry } from '@dltech/atlas-core'

import { startMirrorUpload } from '../mirror-upload-start'

class RecordingLog extends LogPort {
  readonly entries: LogEntry[] = []
  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

const callsFor = async (args: {
  pods: boolean
  session: { url: string; token: string } | null
}) => {
  const urls: string[] = []
  const fetchFn = (async (input: string | URL | Request) => {
    urls.push(String(input))
    return new Response('{}', { status: 500 })
  }) as unknown as typeof fetch
  await startMirrorUpload({
    app: { pods: args.pods, cloud: { session: () => args.session } },
    home: '/nonexistent-atlas-home',
    log: new RecordingLog(),
    fetchFn,
  })
  return urls
}

describe('startMirrorUpload', () => {
  it('does nothing with the pods flag off or when signed out', async () => {
    const session = { url: 'https://api.example.com', token: 't' }
    expect(await callsFor({ pods: false, session })).toEqual([])
    expect(await callsFor({ pods: true, session: null })).toEqual([])
  })

  it('never throws when the home has nothing to upload', async () => {
    const session = { url: 'https://api.example.com', token: 't' }
    expect(await callsFor({ pods: true, session })).toEqual([])
  })
})
