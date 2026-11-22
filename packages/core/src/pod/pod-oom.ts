export enum EOomScope {
  Command = 'command',
  Pod = 'pod',
}

export type OomMemory = {
  commandLimitBytes: number
  podBytes: number
}

const BYTES_PER_GB = 2 ** 30

const tenthsOf = (bytes: number): string => {
  const tenths = Math.round((bytes / BYTES_PER_GB) * 10) / 10
  return Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1)
}

export const podSizeGbOf = (podBytes: number): number => Math.ceil(podBytes / BYTES_PER_GB - 0.05)

export const memoryLimitPhrase = (memory: OomMemory): string =>
  `commands may use ${tenthsOf(memory.commandLimitBytes)} GB of the pod's ${podSizeGbOf(memory.podBytes)} GB`

export const memoryLimitNote = (memory: OomMemory | undefined): string =>
  memory === undefined ? '' : ` (${memoryLimitPhrase(memory)})`

export const OOM_ADVICE =
  'A retry with no change fails the same way. Reduce its memory use: smaller inputs, streaming or batching, fewer parallel workers.'

export const ONLY_OPERATOR_RAISES_MEMORY =
  'Only the operator can give the pod more memory; do not change the pod size yourself.'

export const outOfMemoryNote = (memory: OomMemory | undefined): string =>
  `The kernel killed it for running out of memory${memoryLimitNote(memory)}. ${OOM_ADVICE} ${ONLY_OPERATOR_RAISES_MEMORY}`

export type PodOomRecord = {
  scope: EOomScope
  command?: string | undefined
  processes: number
  memory: OomMemory
}

const processCount = (processes: number): string =>
  processes === 1 ? '1 process' : `${processes} processes`

export const podOomLine = (record: PodOomRecord): string => {
  const limit = `(${memoryLimitPhrase(record.memory)})`
  if (record.scope === EOomScope.Command && record.command !== undefined) {
    return `\`${record.command}\` ran out of memory ${limit}`
  }
  return `A process on the pod ran out of memory: the kernel killed ${processCount(record.processes)} ${limit}`
}
