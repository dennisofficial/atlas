import { randomBytes } from 'node:crypto'
import { type Tx } from '@dltech/atlas-db'

const LABEL_LENGTH = 10

export type PreviewSecretCipher = { encrypt(plain: string): string; decrypt(blob: string): string }

export function newPreviewLabel(): string {
  let label = ''
  while (label.length < LABEL_LENGTH) label += randomBytes(8).readBigUInt64BE().toString(36)
  return label.slice(0, LABEL_LENGTH)
}

export function tunnelNameOf(podSessionId: string): string {
  return `atlas-${podSessionId}`
}

export function dnsTargetOf(tunnelId: string): string {
  return `${tunnelId}.cfargotunnel.com`
}

export function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}

export async function lockPreviews(args: { tx: Tx; podSessionId: string }): Promise<void> {
  const statement = args.tx.raw
    .sql`SELECT pg_advisory_xact_lock(hashtext(${`preview:${args.podSessionId}`}))`
    .affectedCount()
    .build()
  await args.tx.query(statement)
}
