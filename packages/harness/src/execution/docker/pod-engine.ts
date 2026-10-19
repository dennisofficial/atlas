import { posix } from 'node:path'

import { tarEntries } from '../image/tar'
import {
  asLabels,
  asRecord,
  asString,
  EngineRequestFailed,
  raw,
  request,
} from './engine-http'
import { demuxExecStream } from './frames'

export type PodResources = { nanoCpus: number; memoryReservationBytes: number }

export type PodMount = { source: string; target: string }

export type VolumeSummary = { name: string; labels: Record<string, string> }

export type PodExecResult = {
  exitCode: number
  stdout(): Promise<string>
  stderr(): Promise<string>
}

const EXEC_POLL_MS = 25
const DEFAULT_FILE_MODE = 0o600

const labelFilters = (labels: Record<string, string | undefined>): string =>
  JSON.stringify({
    label: Object.entries(labels).map(([key, value]) => (value === undefined ? key : `${key}=${value}`)),
  })

export class DockerPodEngine {
  private readonly socketPath: string

  constructor(args: { socketPath: string }) {
    this.socketPath = args.socketPath
  }

  async updateContainer(args: { id: string; resources: PodResources }): Promise<void> {
    await request({
      socketPath: this.socketPath,
      method: 'POST',
      path: `/containers/${args.id}/update`,
      body: {
        NanoCpus: args.resources.nanoCpus,
        MemoryReservation: args.resources.memoryReservationBytes,
      },
    })
  }

  async createVolume(args: { name: string; labels: Record<string, string> }): Promise<void> {
    await request({
      socketPath: this.socketPath,
      method: 'POST',
      path: '/volumes/create',
      body: { Name: args.name, Labels: args.labels },
    })
  }

  async listVolumes(args: { labels: Record<string, string | undefined> }): Promise<VolumeSummary[]> {
    const body = asRecord(
      await request({
        socketPath: this.socketPath,
        method: 'GET',
        path: '/volumes',
        query: { filters: labelFilters(args.labels) },
      }),
    )
    if (body.Volumes === null || body.Volumes === undefined) return []
    if (!Array.isArray(body.Volumes)) throw new Error('the daemon answered out of shape')

    return body.Volumes.map((entry) => {
      const record = asRecord(entry)
      return { name: asString(record.Name), labels: asLabels(record.Labels) }
    })
  }

  async removeVolume(args: { name: string }): Promise<void> {
    await request({
      socketPath: this.socketPath,
      method: 'DELETE',
      path: `/volumes/${encodeURIComponent(args.name)}`,
    }).catch((error: unknown) => {
      if (error instanceof EngineRequestFailed && error.status === 404) return
      throw error
    })
  }

  async writeFile(args: {
    id: string
    path: string
    content: Uint8Array | string
    mode?: number | undefined
  }): Promise<void> {
    const body = typeof args.content === 'string' ? new TextEncoder().encode(args.content) : args.content
    const tarBody = tarEntries({
      entries: [{ name: posix.basename(args.path), mode: args.mode ?? DEFAULT_FILE_MODE, body }],
    })
    await raw({
      socketPath: this.socketPath,
      method: 'PUT',
      path: `/containers/${args.id}/archive`,
      query: { path: posix.dirname(args.path) },
      tarBody,
    })
  }

  async execSh(args: { id: string; script: string; timeoutMs: number }): Promise<PodExecResult> {
    const deadline = new AbortController()
    const timedOut = new Error(`exec timed out after ${args.timeoutMs}ms`)
    const timer = setTimeout(() => deadline.abort(timedOut), args.timeoutMs)
    try {
      return await this.runSh({ id: args.id, script: args.script, signal: deadline.signal })
    } catch (failure) {
      if (deadline.signal.aborted) throw timedOut
      throw failure
    } finally {
      clearTimeout(timer)
    }
  }

  private async runSh(args: { id: string; script: string; signal: AbortSignal }): Promise<PodExecResult> {
    const created = asRecord(
      await request({
        socketPath: this.socketPath,
        method: 'POST',
        path: `/containers/${args.id}/exec`,
        body: { AttachStdout: true, AttachStderr: true, Cmd: ['sh', '-c', args.script] },
        signal: args.signal,
      }),
    )
    const execId = asString(created.Id)
    args.signal.throwIfAborted()

    const response = await raw({
      socketPath: this.socketPath,
      method: 'POST',
      path: `/exec/${execId}/start`,
      body: { Detach: false, Tty: false },
      signal: args.signal,
    })
    if (response.body === null) throw new Error('the exec stream had no body')

    const demuxed = demuxExecStream({ stream: response.body })
    const [stdout, stderr] = await Promise.all([
      new Response(demuxed.stdout).text(),
      new Response(demuxed.stderr).text(),
      demuxed.done,
    ])
    const exitCode = await this.awaitExitCode({ execId, signal: args.signal })

    return { exitCode, stdout: async () => stdout, stderr: async () => stderr }
  }

  private async awaitExitCode(args: { execId: string; signal: AbortSignal }): Promise<number> {
    for (;;) {
      args.signal.throwIfAborted()
      const state = asRecord(
        await request({
          socketPath: this.socketPath,
          method: 'GET',
          path: `/exec/${args.execId}/json`,
          signal: args.signal,
        }),
      )
      if (state.Running !== true && typeof state.ExitCode === 'number') return state.ExitCode
      await Bun.sleep(EXEC_POLL_MS)
    }
  }
}
