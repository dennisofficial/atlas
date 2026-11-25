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

const entryOf = (row: ContextFileRow): ContextMirrorEntry => ({
  path: row.path,
  size: row.size,
  mime: row.mime,
  kind: row.kind,
  mtimeMs: row.mtimeMs,
  mirrored: row.digest !== null,
})

type ReferencedKind = Exclude<EContextFileKind, EContextFileKind.Text>

type ReferencedFile = Exclude<ContextMirrorFile, { type: 'text' } | { type: 'pending' }>

type ReferenceShape = {
  path: string
  mime: string
  bytes: number
  url: string
  downloadUrl: string
}

const REFERENCED_FILE_BY_KIND: Record<ReferencedKind, (shape: ReferenceShape) => ReferencedFile> = {
  [EContextFileKind.Image]: (shape) => ({ type: 'image', ...shape }),
  [EContextFileKind.Binary]: (shape) => ({ type: 'binary', ...shape }),
  [EContextFileKind.Video]: (shape) => ({ type: 'video', ...shape }),
  [EContextFileKind.Audio]: (shape) => ({ type: 'audio', ...shape }),
}

const fileNameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

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
    if (row.digest === null) return { type: 'pending', path: row.path }
    const { digest } = row
    if (row.kind !== EContextFileKind.Text) {
      return this.referenceOf({ row, digest, kind: row.kind })
    }
    const bytes = await this.content.read({ hash: digest })
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

  private async referenceOf(args: {
    row: ContextFileRow
    digest: string
    kind: ReferencedKind
  }): Promise<ReferencedFile> {
    const { row } = args
    const url = await this.content.presignGet({
      hash: args.digest,
      ttlMs: CONTEXT_MIRROR_URL_TTL_MS,
      contentType: row.mime,
    })
    const downloadUrl = await this.content.presignGet({
      hash: args.digest,
      ttlMs: CONTEXT_MIRROR_URL_TTL_MS,
      downloadName: fileNameOf(row.path),
    })
    const build = REFERENCED_FILE_BY_KIND[args.kind]
    return build({
      path: row.path,
      mime: row.mime,
      bytes: row.size,
      url,
      downloadUrl,
    })
  }
}
