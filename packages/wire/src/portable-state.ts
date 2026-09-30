import { z } from 'zod'

export const PORTABLE_STATE_PATH = '/atlas/home/bootstrap/local-state.json'

export const PORTABLE_STATE_VERSION = 1

const MAX_PORTABLE_TEXT_BYTES = 4 * 1024 * 1024
const MAX_PORTABLE_ACCOUNTS = 256
const MAX_PORTABLE_NAME_BYTES = 256

const NO_CONTROL_CHARS = /^[^\x00-\x1f\x7f]+$/

const boundedText = z.string().min(1).max(MAX_PORTABLE_TEXT_BYTES)
const boundedOptionalText = z.string().max(MAX_PORTABLE_TEXT_BYTES)

export const portableTokenSourceSchema = z.object({
  kind: z.string().min(1).max(64),
  detail: z.string().min(1).max(MAX_PORTABLE_NAME_BYTES),
})

export type PortableTokenSource = z.infer<typeof portableTokenSourceSchema>

export const portableAccountSchema = z.object({
  id: z.string().min(1).max(128),
  provider: z.string().min(1).max(64),
  kind: z.string().min(1).max(64),
  origin: z.string().min(1).max(64),
  label: z.string().min(1).max(MAX_PORTABLE_NAME_BYTES),
  status: z.string().min(1).max(64),
  createdAt: z.string().min(1).max(64),
  updatedAt: z.string().min(1).max(64),
  secret: boundedText,
  email: boundedOptionalText.optional(),
  subscription: boundedOptionalText.optional(),
  source: portableTokenSourceSchema.optional(),
})

export type PortableAccount = z.infer<typeof portableAccountSchema>

export const portableActivePointerSchema = z.object({
  provider: z.string().min(1).max(64),
  accountId: z.string().min(1).max(128),
})

export type PortableActivePointer = z.infer<typeof portableActivePointerSchema>

export const portableSecretSchema = z.object({
  name: z.string().min(1).max(MAX_PORTABLE_NAME_BYTES).regex(NO_CONTROL_CHARS),
  value: boundedText,
})

export type PortableSecret = z.infer<typeof portableSecretSchema>

export const PORTABLE_SETTINGS_NAME = 'settings.json'
export const PORTABLE_MCP_NAME = 'mcp.json'

const boundedFileContent = z.string().max(MAX_PORTABLE_TEXT_BYTES)

export const portableSettingsFileSchema = z.object({
  name: z.literal(PORTABLE_SETTINGS_NAME),
  content: boundedFileContent,
})

export const portableMcpFileSchema = z.object({
  name: z.literal(PORTABLE_MCP_NAME),
  content: boundedFileContent,
})

export const portableStateSchema = z.object({
  version: z.literal(PORTABLE_STATE_VERSION),
  vaultKeyHex: z.string().regex(/^[0-9a-f]{64}$/),
  accounts: z.array(portableAccountSchema).max(MAX_PORTABLE_ACCOUNTS),
  active: z.array(portableActivePointerSchema).max(MAX_PORTABLE_ACCOUNTS),
  secrets: z.array(portableSecretSchema).max(MAX_PORTABLE_ACCOUNTS),
  omitted: z
    .object({
      oauthAccounts: z.array(z.string().min(1).max(MAX_PORTABLE_NAME_BYTES)).max(MAX_PORTABLE_ACCOUNTS),
      mcpOauthSecrets: z
        .array(z.string().min(1).max(MAX_PORTABLE_NAME_BYTES))
        .max(MAX_PORTABLE_ACCOUNTS),
      attachmentTokens: z
        .array(z.string().min(1).max(MAX_PORTABLE_NAME_BYTES))
        .max(MAX_PORTABLE_ACCOUNTS)
        .optional(),
    })
    .optional(),
  settings: portableSettingsFileSchema.optional(),
  mcp: portableMcpFileSchema.optional(),
})

export type PortableState = z.infer<typeof portableStateSchema>

export const PORTABLE_ACCOUNT_KIND = 'api-key'
