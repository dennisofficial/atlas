import type { EventDraft, RunId, ThreadId } from '@dltech/atlas-core'
import type { OomIncident } from '@dltech/atlas-protocol'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import { newKey, type EventFrame, type RemoteCalls } from '../calls/remote-calls'
import type { HeldSessionDeps } from './held-session-deps'
import type { SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'

export type OomRecorder = {
  append(args: {
    threadId: ThreadId
    runId: RunId
    drafts: readonly EventDraft[]
  }): Promise<unknown>
  recorded(incidentId: string): boolean
}

export type OomObserverArgs = {
  record: OomRecorder
  remoteCalls: Pick<RemoteCalls, 'onEvent' | 'invoke' | 'ack'>
  threadId: ThreadId
  runId(): RunId
  signal: AbortSignal
  log?: LogPort | undefined
}

const draftOf = (incident: OomIncident): EventDraft => ({
  type: 'pod-ran-out-of-memory',
  incidentId: incident.incidentId,
  scope: incident.scope,
  ...(incident.command === undefined ? {} : { command: incident.command }),
  processes: incident.processes,
  memory: incident.memory,
})

export class OomObserver {
  private unsubscribe: (() => void) | undefined
  private tail: Promise<void> = Promise.resolve()
  private readonly seen = new Set<string>()

  constructor(private readonly args: OomObserverArgs) {}

  start(): void {
    this.unsubscribe = this.args.remoteCalls.onEvent((frame) => this.received(frame))
    this.queue(() => this.readIncidents())
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  async settled(): Promise<void> {
    for (;;) {
      const current = this.tail
      await current
      if (current === this.tail) return
    }
  }

  private received(frame: EventFrame): void {
    if (frame.event.type !== 'pod.oom') return
    const incident = frame.event.incident
    this.queue(() => this.write(incident))
  }

  private queue(task: () => Promise<void>): void {
    this.tail = this.tail.then(() => this.guarded(task))
  }

  private async readIncidents(): Promise<void> {
    const key = newKey()
    const result = await this.args.remoteCalls.invoke({ key, op: { op: 'oom.list' } })
    await this.ackQuietly(key)
    if (result.status !== 'ok' || result.op !== 'oom.list') return

    for (const incident of result.value.incidents) this.queue(() => this.write(incident))
  }

  private async write(incident: OomIncident): Promise<void> {
    if (this.args.signal.aborted) return
    if (this.seen.has(incident.incidentId)) return
    if (this.args.record.recorded(incident.incidentId)) {
      this.seen.add(incident.incidentId)
      return
    }

    await this.args.record.append({
      threadId: this.args.threadId,
      runId: this.args.runId(),
      drafts: [draftOf(incident)],
    })
    this.seen.add(incident.incidentId)
  }

  private async guarded(task: () => Promise<void>): Promise<void> {
    try {
      await task()
    } catch (error) {
      this.args.log?.error({
        source: 'holder.oom',
        message: 'recording a pod out-of-memory incident failed',
        ...logFieldsOf({ error }),
      })
    }
  }

  private async ackQuietly(key: string): Promise<void> {
    try {
      await this.args.remoteCalls.ack({ key })
    } catch (error) {
      this.args.log?.error({
        source: 'holder.oom',
        message: `ack for ${key} failed`,
        ...logFieldsOf({ error }),
      })
    }
  }
}

export const oomObserverOf = (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  record: SessionRecord
  threadId: ThreadId
  signal: AbortSignal
}): OomObserver =>
  new OomObserver({
    record: {
      append: ({ threadId: to, runId: id, drafts }) =>
        args.record.append({ threadId: to, runId: id, drafts }),
      recorded: (incidentId) =>
        args.record
          .eventCache()
          .eventsAfter(0)
          .some(
            (event) => event.type === 'pod-ran-out-of-memory' && event.incidentId === incidentId,
          ),
    },
    remoteCalls: args.runtime.remoteCalls,
    threadId: args.threadId,
    runId: () => args.deps.ids.nextRunId(),
    signal: args.signal,
    ...(args.deps.log === undefined ? {} : { log: args.deps.log }),
  })
