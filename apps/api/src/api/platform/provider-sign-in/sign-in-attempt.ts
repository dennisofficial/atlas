import { BadRequestException } from '@nestjs/common'
import { EOauthProvider } from '@dltech/atlas-wire'
import { z } from 'zod'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'

const pasteAttemptSchema = z.object({
  provider: z.literal(EOauthProvider.Anthropic),
  userId: z.string(),
  expiresAtMs: z.number(),
  verifier: z.string(),
  challenge: z.string(),
  state: z.string(),
})

const deviceAttemptSchema = z.object({
  provider: z.literal(EOauthProvider.OpenAI),
  userId: z.string(),
  expiresAtMs: z.number(),
  deviceAuthId: z.string(),
  userCode: z.string(),
})

const attemptSchema = z.discriminatedUnion('provider', [pasteAttemptSchema, deviceAttemptSchema])

export type PasteAttempt = z.infer<typeof pasteAttemptSchema>
export type DeviceAttempt = z.infer<typeof deviceAttemptSchema>
export type SignInAttempt = z.infer<typeof attemptSchema>

export const ATTEMPT_PREFIX = 'psi_'

const unknownAttempt = (): BadRequestException =>
  new BadRequestException('that sign-in attempt is not recognised — start the sign-in again')

export const sealAttempt = (args: {
  cipher: SecretCipherService
  attempt: SignInAttempt
}): string => `${ATTEMPT_PREFIX}${args.cipher.encrypt(JSON.stringify(args.attempt))}`

export function openAttempt(args: {
  cipher: SecretCipherService
  attemptId: string
  userId: string
}): SignInAttempt {
  if (!args.attemptId.startsWith(ATTEMPT_PREFIX)) throw unknownAttempt()
  let raw: unknown
  try {
    raw = JSON.parse(args.cipher.decrypt(args.attemptId.slice(ATTEMPT_PREFIX.length)))
  } catch {
    throw unknownAttempt()
  }
  const parsed = attemptSchema.safeParse(raw)
  if (!parsed.success || parsed.data.userId !== args.userId) throw unknownAttempt()
  return parsed.data
}
