import { describe, expect, it } from 'bun:test'

import {
  EAgentStatus as CoreAgentStatus,
  EFinishReason as CoreFinishReason,
  EKilledBy as CoreKilledBy,
  ERetryReason as CoreRetryReason,
  EServiceStatus as CoreServiceStatus,
  EShellStatus as CoreShellStatus,
} from '@dltech/atlas-core'
import {
  EAgentStatus as WireAgentStatus,
  EFinishReason as WireFinishReason,
  EKilledBy as WireKilledBy,
  ERetryReason as WireRetryReason,
  EServiceStatus as WireServiceStatus,
  EShellStatus as WireShellStatus,
} from '@dltech/atlas-wire'

const values = (e: Record<string, string>): string[] => Object.values(e).sort()

// @dltech/atlas-wire cannot import core (core cannot build under the API's NodeNext), so wire
// re-derives the enums its schemas validate against. A value added to core but not wire would
// pass core's types and then fail wire's zod parse at the decode seam — this is the compile-time
// net the packages cannot provide for each other.
describe('wire ↔ core enum conformance', () => {
  const pairs: Array<[string, Record<string, string>, Record<string, string>]> = [
    ['EAgentStatus', CoreAgentStatus, WireAgentStatus],
    ['EFinishReason', CoreFinishReason, WireFinishReason],
    ['EKilledBy', CoreKilledBy, WireKilledBy],
    ['ERetryReason', CoreRetryReason, WireRetryReason],
    ['EServiceStatus', CoreServiceStatus, WireServiceStatus],
    ['EShellStatus', CoreShellStatus, WireShellStatus],
  ]

  for (const [name, core, wire] of pairs) {
    it(`${name} carries identical values on both sides of the seam`, () => {
      expect(values(wire)).toEqual(values(core))
    })
  }
})
