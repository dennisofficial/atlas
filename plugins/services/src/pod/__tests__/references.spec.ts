import { describe, expect, it } from 'bun:test'

import type { ServiceDeclaration } from '@dltech/atlas-core'
import type { PodControl } from '@dltech/atlas-plugin-sdk'
import { ECallStatus, type CallOp, type CallResult } from '@dltech/atlas-protocol'

import { forwardReferences } from '../references'
import { controlOf, rig } from './support'

const POSITIVE_TEST_TIMEOUT = 5_000

const WEB: ServiceDeclaration = { command: 'bun run dev', port: 3000, portal: true }

const API: ServiceDeclaration = {
  command: 'bun run api',
  env: { WEB_ORIGIN: '${services.web.publicUrl}' },
}

const DECLARED = new Map([
  ['web', WEB],
  ['api', API],
] as const)

const forward = async (exposePort?: PodControl['exposePort']) => {
  const harness = rig()
  const logged: string[] = []
  const control = controlOf({ url: 'https://3000-abc.byatlas.dev' })
  const ctx = {
    ...harness.ctx,
    control: exposePort === undefined ? control : { ...control, exposePort },
    call: async (op: CallOp): Promise<CallResult> =>
      op.op === 'previews.expose'
        ? { status: ECallStatus.Ok, op: 'previews.expose', value: { port: op.port, pid: 7 } }
        : harness.ctx.call(op),
    log: (message: string) => void logged.push(message),
  }
  const resolved = await forwardReferences({
    ctx,
    declared: {
      services: DECLARED,
      hashes: new Map([
        ['web', 'a'],
        ['api', 'b'],
      ]),
    },
    declaration: API,
    place: { root: '/work' },
  })
  return { resolved, logged }
}

describe('forwardReferences', () => {
  it(
    'publishes the public url of a declared target and stays quiet',
    async () => {
      const { resolved, logged } = await forward()
      expect(resolved.web?.publicUrl).toBe('https://3000-abc.byatlas.dev')
      expect(logged).toEqual([])
    },
    POSITIVE_TEST_TIMEOUT,
  )

  it(
    'says why a public url could not be minted instead of leaving it empty silently',
    async () => {
      const { resolved, logged } = await forward(async () => {
        throw new Error('the control plane is down')
      })
      expect(resolved.web?.publicUrl).toBeUndefined()
      expect(logged).toHaveLength(1)
      expect(logged[0]).toContain('web')
      expect(logged[0]).toContain('public url')
      expect(logged[0]).toContain('the control plane is down')
    },
    POSITIVE_TEST_TIMEOUT,
  )
})
