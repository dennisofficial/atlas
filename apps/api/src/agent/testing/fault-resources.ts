import { join } from 'node:path'

import { ECallStatus } from '@dltech/atlas-protocol'
import type { PodResource } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

export const FAULT_LOAD_RESOURCE = 'fault-load'

export type FaultLoad = { lines: number }

const commandOf = (args: { loads: string; gate: string }): string =>
  `echo load >> '${args.loads}'; while [ ! -f '${args.gate}' ]; do sleep 0.05; done`

const linesOf = (text: string): number => {
  const trimmed = text.trim()
  return trimmed === '' ? 0 : trimmed.split('\n').length
}

export const faultLoadResource = (): PodResource<FaultLoad> => ({
  name: FAULT_LOAD_RESOURCE,
  schema: z.object({ lines: z.number() }),
  stale: () => true,
  load: async ({ ctx, directory }) => {
    const loads = join(directory, 'loads')
    const result = await ctx.call({
      op: 'exec',
      argv: ['sh', '-c', commandOf({ loads, gate: join(directory, 'gate') })],
    })
    if (result.status !== ECallStatus.Ok || result.op !== 'exec') {
      throw new Error(`the fault load exec did not run: ${result.status}`)
    }
    const read = await ctx.call({ op: 'readFile', path: loads })
    if (read.status !== ECallStatus.Ok || read.op !== 'readFile') {
      throw new Error(`the fault load could not read its own count: ${read.status}`)
    }
    return { lines: linesOf(read.value) }
  },
})
