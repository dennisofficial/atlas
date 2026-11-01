import {
  EBootStep,
  EBootStepState,
  EPodResizeApplies,
  EPodState,
  ESandboxProvisionState,
  EThreadMessageState,
  type PodStatus,
  type RecordedBootStep,
  type RuntimeCheckpoint,
  type SandboxProvisionReply,
  type ThreadMessageRequest,
} from '@dltech/atlas-wire'

import type { PodApiClient, PodStreamHandlers } from '../api-pod-client'
import { CloudError } from '../cloud-transport'

export const stepOf = (
  step: EBootStep,
  state: EBootStepState,
  extra: Partial<RecordedBootStep> = {},
): RecordedBootStep => ({
  step,
  state,
  at: '2026-10-27T10:00:00.000Z',
  ...extra,
})

export const statusOf = (
  state: EPodState,
  steps: RecordedBootStep[] = [],
  resources?: PodStatus['resources'],
): PodStatus => ({
  state,
  steps,
  ...(resources === undefined ? {} : { resources }),
})

export type ScriptedStatus = PodStatus | Error

export type FakePodApi = {
  api: PodApiClient
  calls: string[]
  sends: (ThreadMessageRequest & { threadId: string })[]
  statusReads: () => number
  streams: PodStreamHandlers[]
  unsubscribed: () => number
  setStatuses: (statuses: ScriptedStatus[]) => void
  setProvision: (reply: SandboxProvisionReply) => void
  failCreateWith: (failure: unknown) => void
  failStreamWith: (failure: unknown) => void
  failConnectWith: (failure: unknown) => void
  failSendWith: (failure: unknown) => void
  tickets: string[]
}

export const createFakePodApi = (
  initial: { statuses?: ScriptedStatus[]; checkpoint?: RuntimeCheckpoint | null } = {},
): FakePodApi => {
  const calls: string[] = []
  const streams: PodStreamHandlers[] = []
  const tickets: string[] = []
  let statuses = initial.statuses ?? [statusOf(EPodState.Running)]
  let reads = 0
  let unsubscribed = 0
  let provision: SandboxProvisionReply = {
    state: ESandboxProvisionState.Booting,
  }
  let createFailure: unknown
  let streamFailure: unknown
  let connectFailure: unknown
  let sendFailure: unknown
  let minted = 0
  const sends: (ThreadMessageRequest & { threadId: string })[] = []

  const api: PodApiClient = {
    threads: {
      create: {
        mutate: async (input) => {
          calls.push(`create:${JSON.stringify(input)}`)
          if (createFailure !== undefined) throw createFailure
          return {}
        },
      },
    },
    threadSandbox: {
      provision: {
        mutate: async ({ threadId }) => {
          calls.push(`provision:${threadId}`)
          return provision
        },
      },
    },
    threadMessages: {
      send: {
        mutate: async (input) => {
          calls.push(`message:${input.threadId}:${input.sendId}`)
          if (sendFailure !== undefined) throw sendFailure
          sends.push(input)
          return { state: EThreadMessageState.Queued }
        },
      },
    },
    threadPod: {
      status: {
        query: async ({ threadId }) => {
          calls.push(`status:${threadId}`)
          const reply = statuses[Math.min(reads, statuses.length - 1)]
          reads += 1
          if (reply === undefined) throw new Error('no status scripted')
          if (reply instanceof Error) throw reply
          return reply
        },
      },
      connect: {
        mutate: async ({ threadId }) => {
          calls.push(`connect:${threadId}`)
          if (connectFailure !== undefined) throw connectFailure
          minted += 1
          const token = `ticket-${minted}`
          tickets.push(token)
          return {
            url: 'https://pod.test',
            token,
            expiresAt: '2026-10-27T10:01:00.000Z',
            threadId,
          }
        },
      },
      resize: {
        mutate: async ({ threadId, vcpus }) => {
          calls.push(`resize:${threadId}:${vcpus}`)
          return { vcpus, appliesAt: EPodResizeApplies.Live }
        },
      },
      destroy: {
        mutate: async ({ threadId }) => {
          calls.push(`destroy:${threadId}`)
        },
      },
    },
    sandboxCheckpoint: {
      get: {
        query: async ({ threadId }) => {
          calls.push(`checkpoint:${threadId}`)
          return { checkpoint: initial.checkpoint ?? null }
        },
      },
    },
    threadEvents: {
      stream: {
        subscribe: (_input, handlers) => {
          if (streamFailure !== undefined) throw streamFailure
          streams.push(handlers)
          return {
            unsubscribe: () => {
              unsubscribed += 1
            },
          }
        },
      },
    },
  }

  return {
    api,
    calls,
    sends,
    statusReads: () => reads,
    streams,
    unsubscribed: () => unsubscribed,
    tickets,
    setStatuses: (next) => {
      statuses = next
      reads = 0
    },
    setProvision: (reply) => {
      provision = reply
    },
    failCreateWith: (failure) => {
      createFailure = failure
    },
    failStreamWith: (failure) => {
      streamFailure = failure
    },
    failConnectWith: (failure) => {
      connectFailure = failure
    },
    failSendWith: (failure) => {
      sendFailure = failure
    },
  }
}

export const cloudFailure = (status: number): CloudError =>
  new CloudError({ status, message: `answered ${status}` })
