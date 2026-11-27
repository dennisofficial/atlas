import { createHash } from 'node:crypto'

import { z } from 'zod'

export class JevLabelStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JevLabelStateError'
  }
}

const recordedScopeSchema = z.object({
  scope: z.object({
    before: z.string().nullable(),
    after: z.string().nullable(),
    diff: z.string(),
    dependencyContext: z.array(z.string()),
  }),
})

export type JevLabelScopeState = z.infer<typeof recordedScopeSchema>['scope']

const DOCUMENT_OPENERS = new Set(['{', '['])
const DOCUMENT_CLOSERS = new Set(['}', ']'])

export function jsonDocumentEnd({ text }: { text: string }): number {
  const start = text.search(/[{[]/)
  if (start < 0) throw new JevLabelStateError('the recorded state holds no JSON document')
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index] as string
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (DOCUMENT_OPENERS.has(char)) depth += 1
    if (DOCUMENT_CLOSERS.has(char)) {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  throw new JevLabelStateError('the recorded state JSON document never closes')
}

export function splitRequestState({ content }: { content: string }): string {
  const end = jsonDocumentEnd({ text: content })
  const state = content.slice(0, end)
  const rest = content.slice(end)
  if (rest !== '' && !rest.startsWith('\n\n'))
    throw new JevLabelStateError(
      'the classifier request content does not separate the state from the questions with a blank line',
    )
  return state
}

export function md5Hex({ text }: { text: string }): string {
  return createHash('md5').update(text, 'utf8').digest('hex')
}

export function readScopeState({ state }: { state: string }): JevLabelScopeState {
  let decoded: unknown
  try {
    decoded = JSON.parse(state)
  } catch {
    throw new JevLabelStateError('the recorded scope state is not valid JSON')
  }
  const parsed = recordedScopeSchema.safeParse(decoded)
  if (!parsed.success)
    throw new JevLabelStateError(
      `the recorded scope state misses its scope fields: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
    )
  return parsed.data.scope
}
