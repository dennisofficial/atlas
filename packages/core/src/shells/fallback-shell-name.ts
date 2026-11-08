import { z } from 'zod'

const FALLBACK_NAME_CHARACTERS = 80

const ELLIPSIS = '…'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNamed = (input: Record<string, unknown>): boolean => {
  const name = input['description']
  return typeof name === 'string' && name.trim() !== ''
}

export function fallbackShellName(command: string): string {
  const single = command.replace(/\s+/g, ' ').trim()
  return single.length <= FALLBACK_NAME_CHARACTERS
    ? single
    : `${single.slice(0, FALLBACK_NAME_CHARACTERS)}${ELLIPSIS}`
}

function nameFromCommand(input: unknown): unknown {
  if (!isRecord(input) || isNamed(input)) return input
  const command = input['command']
  if (typeof command !== 'string' || command.trim() === '') return input
  return { ...input, description: fallbackShellName(command) }
}

export function withFallbackShellName<TSchema extends z.ZodObject>(schema: TSchema) {
  return z.preprocess(nameFromCommand, schema)
}
