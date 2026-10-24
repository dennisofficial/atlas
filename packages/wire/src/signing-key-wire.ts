import { z } from 'zod'

export const sshSigningKeyLeaseSchema = z.object({
  publicKey: z.string().min(1),
  privateKey: z.string().min(1),
  userName: z.string().min(1),
  userEmail: z.string().min(1),
})
export type SshSigningKeyLease = z.infer<typeof sshSigningKeyLeaseSchema>

export enum ESshSigningKeyState {
  Absent = 'absent',
  Registered = 'registered',
}

export const sshSigningKeyStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal(ESshSigningKeyState.Absent) }),
  z.object({
    state: z.literal(ESshSigningKeyState.Registered),
    publicKey: z.string(),
    createdAt: z.string(),
  }),
])
export type SshSigningKeyStatus = z.infer<typeof sshSigningKeyStatusSchema>

export const MAX_PRIVATE_KEY_LENGTH = 8192

export const sshSigningKeyUploadSchema = z.object({
  privateKey: z.string().min(1).max(MAX_PRIVATE_KEY_LENGTH),
})
export type SshSigningKeyUpload = z.infer<typeof sshSigningKeyUploadSchema>

export const SSH_SIGNING_SCOPE_MISSING_CODE = 'github-signing-scope-missing'
export const GITHUB_NOT_CONNECTED_CODE = 'github-not-connected'
export const SSH_SIGNING_SCOPE_NOTICE = 'reconnect GitHub in settings to enable commit signing'
