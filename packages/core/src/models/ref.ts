export type ModelRef = {
  providerId: string
  modelId: string
}

export const refKey = (ref: ModelRef): string => `${ref.providerId}/${ref.modelId}`

export function parseRef(reference: string): ModelRef | undefined {
  const separator = reference.indexOf('/')
  if (separator < 0) return undefined

  const providerId = reference.slice(0, separator)
  const modelId = reference.slice(separator + 1)
  if (providerId.length === 0 || modelId.length === 0) return undefined

  return { providerId, modelId }
}

const REF_FORM = '"<provider>/<model>"'

const hintOf = (candidates: readonly ModelRef[]): string =>
  candidates.length === 0 ? '' : ` Did you mean ${candidates.map(refKey).join(' or ')}?`

export class UnknownModelRefError extends Error {
  readonly ref: string

  constructor(args: { ref: string; candidates?: readonly ModelRef[] }) {
    super(`Unknown model "${args.ref}". Use the form ${REF_FORM}.${hintOf(args.candidates ?? [])}`)
    this.name = 'UnknownModelRefError'
    this.ref = args.ref
  }
}
