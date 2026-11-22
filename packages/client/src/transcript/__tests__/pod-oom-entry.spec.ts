import { describe, expect, it } from 'bun:test'

import { EOomScope } from '@dltech/atlas-core'

import { durableEntries } from '../durable-entries'
import { EAuthor, EEntryKind } from '../transcript-model'
import { log } from './fixture'

const MEMORY = { commandLimitBytes: 2.3 * 1024 ** 3, podBytes: 4 * 1024 ** 3 }

describe('a pod-ran-out-of-memory event', () => {
  it('becomes a pod-oom transcript entry naming the command and the command limit', () => {
    const events = log([
      {
        type: 'pod-ran-out-of-memory',
        incidentId: 'incident-1',
        scope: EOomScope.Command,
        command: 'bunx turbo run typecheck',
        processes: 3,
        memory: MEMORY,
      },
    ])

    expect(durableEntries({ events })).toEqual([
      {
        kind: EEntryKind.PodOom,
        author: EAuthor.Model,
        key: events[0]?.id ?? '',
        text: "`bunx turbo run typecheck` ran out of memory (commands may use 2.3 GB of the pod's 4 GB)",
        scope: EOomScope.Command,
        processes: 3,
      },
    ])
  })

  it('keeps a pod-wide kill with the processes the kernel killed', () => {
    const events = log([
      {
        type: 'pod-ran-out-of-memory',
        incidentId: 'incident-2',
        scope: EOomScope.Pod,
        processes: 2,
        memory: MEMORY,
      },
    ])

    expect(durableEntries({ events })[0]).toEqual({
      kind: EEntryKind.PodOom,
      author: EAuthor.Model,
      key: events[0]?.id ?? '',
      text: "A process on the pod ran out of memory: the kernel killed 2 processes (commands may use 2.3 GB of the pod's 4 GB)",
      scope: EOomScope.Pod,
      processes: 2,
    })
  })
})
