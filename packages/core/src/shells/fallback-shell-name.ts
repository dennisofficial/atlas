import { z } from 'zod'

const FALLBACK_NAME_CHARACTERS = 80

const ELLIPSIS = '…'

export function fallbackShellName(command: string): string {
  const single = command.replace(/\s+/g, ' ').trim()
  return single.length <= FALLBACK_NAME_CHARACTERS
    ? single
    : `${single.slice(0, FALLBACK_NAME_CHARACTERS)}${ELLIPSIS}`
}

export const optionalShellName = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() !== '' ? value : undefined),
  z.string().min(1).optional(),
)

type NamedShellInput = { command: string; description?: string | undefined }

export function withFallbackShellName<TInput extends NamedShellInput, TDeclared>(
  schema: z.ZodType<TInput, TDeclared>,
) {
  return schema.transform((input) => ({
    ...input,
    description: input.description ?? fallbackShellName(input.command),
  }))
}
