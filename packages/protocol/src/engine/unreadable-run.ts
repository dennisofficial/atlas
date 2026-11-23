import { callKeySchema } from '../frames'

export type UnreadableRun = { key: string; opName: string }

const opNameOf = (frame: object): string => {
  if (!('op' in frame)) return 'the op'
  const op: unknown = frame.op
  if (typeof op !== 'object' || op === null || !('op' in op)) return 'the op'
  const name: unknown = op.op
  return typeof name === 'string' ? name : 'the op'
}

export const unreadableRunOf = (json: unknown): UnreadableRun | undefined => {
  if (typeof json !== 'object' || json === null) return undefined
  if (!('kind' in json) || json.kind !== 'run') return undefined
  if (!('key' in json)) return undefined
  const key = callKeySchema.safeParse(json.key)
  if (!key.success) return undefined
  return { key: key.data, opName: opNameOf(json) }
}
