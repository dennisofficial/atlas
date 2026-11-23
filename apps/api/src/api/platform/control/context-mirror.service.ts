import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { ContextContentStore, ControlPlane, type ContextFileRow } from '@dltech/atlas-control'
import { EContextFileKind } from '@dltech/atlas-core'
import {
  LIVE_OP_MAX_BYTES,
  type ContextMirrorEntry,
  type ContextMirrorFile,
  type ContextMirrorListOutput,
  type ContextMirrorReadOutput,
} from '@dltech/atlas-protocol'
import { SessionsService } from './sessions.service'

export const CONTEXT_MIRROR_URL_TTL_MS = 10 * 60 * 1000

const MEGABYTE = 1024 * 1024

const entryOf = (row: ContextFileRow): ContextMirrorEntry => ({
  path: row.path,
  size: row.size,
  mime: row.mime,
  kind: row.kind,
  mtimeMs: row.mtimeMs,
  mirrored: row.digest !== null,
})

const megabytesOf = (bytes: number): string => (bytes / MEGABYTE).toFixed(1)

@Injectable()
export class ContextMirrorService {
  constructor(
    @Inject(ControlPlane) private readonly plane: ControlPlane,
    @Inject(ContextContentStore) private readonly content: ContextContentStore,
    @Inject(SessionsService) private readonly sessions: SessionsService,
  ) {}

  async list(args: { userId: string; sessionId: string }): Promise<ContextMirrorListOutput> {
    await this.sessions.requireOwnedSession(args)
    const rows = await this.plane.listContextFiles({ sessionId: args.sessionId })
    return {
      files: rows
        .map(entryOf)
        .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
    }
  }

  async read(args: {
    userId: string
    sessionId: string
    path: string
  }): Promise<ContextMirrorReadOutput> {
    await this.sessions.requireOwnedSession(args)
    const row = await this.plane.contextFileOf({ sessionId: args.sessionId, path: args.path })
    if (row === null) throw new NotFoundException('context file not found')
    return { file: await this.fileOf(row) }
  }

  private async fileOf(row: ContextFileRow): Promise<ContextMirrorFile> {
    if (row.digest === null) {
      return {
        type: 'refused',
        path: row.path,
        reason: `too large to mirror (${megabytesOf(row.size)} MB)`,
      }
    }
    if (row.kind !== EContextFileKind.Text) return this.referenceOf(row, row.digest)
    const bytes = await this.content.read({ hash: row.digest })
    if (bytes === null) throw new NotFoundException('context file content not found')
    const head = bytes.subarray(0, LIVE_OP_MAX_BYTES)
    return {
      type: 'text',
      path: row.path,
      content: new TextDecoder().decode(head),
      truncated: bytes.length > LIVE_OP_MAX_BYTES,
      bytes: row.size,
    }
  }

  private async referenceOf(row: ContextFileRow, digest: string): Promise<ContextMirrorFile> {
    const url = await this.content.presignGet({ hash: digest, ttlMs: CONTEXT_MIRROR_URL_TTL_MS })
    return {
      type: row.kind === EContextFileKind.Image ? 'image' : 'binary',
      path: row.path,
      mime: row.mime,
      bytes: row.size,
      url,
    }
  }
}
