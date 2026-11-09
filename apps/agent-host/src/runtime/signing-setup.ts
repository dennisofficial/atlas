import { join } from 'node:path'

import type { FileSystemPort } from '@dltech/atlas-core'
import { runInCallScope, scopeKeyOf, type RemoteCalls } from '@dltech/atlas-host'
import type { LogPort } from '@dltech/atlas-observability'

import type { SigningKey, SigningKeyReader } from '../tokens/signing-key-reader'
import { abortable } from './abortable'
import type { SigningConfig } from './shell-env'
import { ALLOWED_SIGNERS_FILE, SIGNING_KEY_FILE, stateDirOf } from './workspace-state'

const SIGNING_SCOPE = scopeKeyOf({ runId: 'setup', callId: 'signing' })

const withTrailingNewline = (text: string): string => (text.endsWith('\n') ? text : `${text}\n`)

const writeSigningFiles = async (args: {
  files: FileSystemPort
  stateDir: string
  key: SigningKey
}): Promise<SigningConfig> => {
  const { files, stateDir, key } = args
  const keyPath = join(stateDir, SIGNING_KEY_FILE)
  const allowedSignersPath = join(stateDir, ALLOWED_SIGNERS_FILE)
  await files.mkdir({ path: stateDir })
  await files.writeFile({
    path: keyPath,
    content: withTrailingNewline(key.privateKey),
    mode: 0o600,
  })
  await files.writeFile({
    path: allowedSignersPath,
    content: `${key.userEmail} ${key.publicKey.trim()}\n`,
    mode: 0o644,
  })
  return { keyPath, allowedSignersPath, userName: key.userName, userEmail: key.userEmail }
}

export const prepareSigning = async (args: {
  reader: Pick<SigningKeyReader, 'read'> | undefined
  files: FileSystemPort
  calls: Pick<RemoteCalls, 'ackScope'>
  userId: string
  launchDirectory: string
  signal: AbortSignal
  log?: LogPort | undefined
}): Promise<SigningConfig | null> => {
  if (args.reader === undefined) return null
  let wrote = false
  try {
    const key = await abortable(args.reader.read({ userId: args.userId }), args.signal)
    if (key === null) return null
    wrote = true
    return await runInCallScope({
      scopeKey: SIGNING_SCOPE,
      body: () =>
        writeSigningFiles({ files: args.files, stateDir: stateDirOf(args.launchDirectory), key }),
    })
  } catch (error) {
    if (args.signal.aborted) throw error
    args.log?.warn({
      source: 'runtime.signing-key',
      message: 'signing key unavailable; commits in this session start unsigned',
      error: error instanceof Error ? error.message : 'unknown error',
    })
    return null
  } finally {
    if (wrote) await args.calls.ackScope({ scopeKey: SIGNING_SCOPE }).catch(() => undefined)
  }
}
