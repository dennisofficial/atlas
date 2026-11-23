import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common'
import { ControlPlane, type WorktreeChangesRead } from '@dltech/atlas-control'
import {
  ECallFailure,
  ECallStatus,
  EFilesRoot,
  FILES_SEARCH_LIMIT,
  LIVE_OP_MAX_BYTES,
  type CallResult,
  type FileContent,
  type FilesReadOutput,
  type FilesSearchOutput,
  type FilesTreeOutput,
} from '@dltech/atlas-protocol'
import { contextDirOf, POD_OPS, type PodOps } from '../../../agent'
import { changedPathsIn, checkoutIn, latestPerWorktree, resolveInside } from './files-checkout'
import {
  podFailureError,
  PodNotReadyError,
  reachablePodOutcome,
  type FailedResult,
} from './pod-errors'
import { SessionsService } from './sessions.service'

const filesFailureError = (result: FailedResult) =>
  result.error.code === ECallFailure.NotFound ? new PodNotReadyError() : podFailureError(result)

const HIDDEN_NAMES: ReadonlySet<string> = new Set(['.git', 'node_modules'])

type Success = Extract<CallResult, { status: ECallStatus.Ok }>
type DirectoryResult = Extract<Success, { op: 'readDirectory' }>
type StatResult = Extract<Success, { op: 'stat' }>
type ReadFileResult = Extract<Success, { op: 'readFile' }>
type GlobResult = Extract<Success, { op: 'glob' }>
type StatValue = StatResult['value']

const isHidden = (path: string): boolean =>
  path.split('/').some((segment) => HIDDEN_NAMES.has(segment))

const globEscaped = (query: string): string => query.replace(/([*?[\]{}!])/g, '\\$1')

const positionsOf = (args: { path: string; query: string }): number[] => {
  const haystack = args.path.toLowerCase()
  const needle = args.query.toLowerCase()
  const positions: number[] = []
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    positions.push(index)
    index = haystack.indexOf(needle, index + needle.length)
  }
  return positions
}

const pathWithin = (args: { directory: string; name: string }): string =>
  args.directory === '' ? args.name : `${args.directory}/${args.name}`

@Injectable()
export class FilesService {
  constructor(
    @Inject(ControlPlane) private readonly plane: ControlPlane,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Optional() @Inject(POD_OPS) private readonly ops: PodOps | null = null,
  ) {}

  private async invoke(args: {
    sessionId: string
    op: Parameters<PodOps['invoke']>[0]['op']
  }): Promise<CallResult> {
    if (this.ops === null) throw new ServiceUnavailableException('pod access is not running')
    return reachablePodOutcome(await this.ops.invoke({ ...args, waitForHolder: true })).result
  }

  private async changes(args: {
    sessionId: string
    checkoutId: string | undefined
  }): Promise<{ checkout: WorktreeChangesRead | undefined; changed: ReadonlySet<string> }> {
    const checkouts = await this.plane.readChanges({ sessionId: args.sessionId })
    if (args.checkoutId === undefined)
      return { checkout: undefined, changed: changedPathsIn(latestPerWorktree(checkouts)[0]) }
    const checkout = checkoutIn({ checkouts, checkoutId: args.checkoutId })
    return { checkout, changed: changedPathsIn(checkout) }
  }

  private async checkoutOf(args: {
    sessionId: string
    checkoutId: string | undefined
  }): Promise<WorktreeChangesRead | undefined> {
    if (args.checkoutId === undefined) return undefined
    const checkouts = await this.plane.readChanges({ sessionId: args.sessionId })
    return checkoutIn({ checkouts, checkoutId: args.checkoutId })
  }

  private async scopeOf(args: {
    sessionId: string
    checkoutId: string | undefined
    root: EFilesRoot | undefined
  }): Promise<{ base: string | undefined; changed: ReadonlySet<string> }> {
    if (args.root === EFilesRoot.Context)
      return { base: contextDirOf(args.sessionId), changed: new Set<string>() }
    const { checkout, changed } = await this.changes({
      sessionId: args.sessionId,
      checkoutId: args.checkoutId,
    })
    return { base: checkout?.worktreePath, changed }
  }

  async tree(args: {
    userId: string
    sessionId: string
    directory: string
    checkoutId?: string | undefined
    root?: EFilesRoot | undefined
  }): Promise<FilesTreeOutput> {
    await this.sessions.requireOwnedSession({ userId: args.userId, sessionId: args.sessionId })
    const { base, changed } = await this.scopeOf({
      sessionId: args.sessionId,
      checkoutId: args.checkoutId,
      root: args.root,
    })
    const relative = args.directory === '' ? '.' : args.directory
    const result = await this.invoke({
      sessionId: args.sessionId,
      op: {
        op: 'readDirectory',
        path: base === undefined ? relative : resolveInside({ root: base, path: args.directory }),
      },
    })
    if (result.status === ECallStatus.Failed) throw filesFailureError(result)
    const listing = result as DirectoryResult
    const entries = listing.value
      .filter((entry) => !HIDDEN_NAMES.has(entry.name))
      .map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory,
        changed: changed.has(pathWithin({ directory: args.directory, name: entry.name })),
      }))
      .sort((left, right) =>
        left.isDirectory === right.isDirectory
          ? left.name.localeCompare(right.name)
          : left.isDirectory
            ? -1
            : 1,
      )
    return { directory: args.directory, entries }
  }

  async search(args: {
    userId: string
    sessionId: string
    query: string
    checkoutId?: string | undefined
  }): Promise<FilesSearchOutput> {
    await this.sessions.requireOwnedSession({ userId: args.userId, sessionId: args.sessionId })
    const checkout = await this.checkoutOf({
      sessionId: args.sessionId,
      checkoutId: args.checkoutId,
    })
    const result = await this.invoke({
      sessionId: args.sessionId,
      op: {
        op: 'glob',
        pattern: `**/*${globEscaped(args.query)}*`,
        cwd: checkout?.worktreePath ?? '.',
        dot: false,
      },
    })
    if (result.status === ECallStatus.Failed) throw filesFailureError(result)
    const globbed = result as GlobResult
    const matches = globbed.value
      .map((path) => path.replace(/^\.\//, ''))
      .filter((path) => !isHidden(path))
      .sort((left, right) => left.localeCompare(right))
    const paths = matches.slice(0, FILES_SEARCH_LIMIT).map((path) => ({
      path,
      positions: positionsOf({ path, query: args.query }),
    }))
    return { paths, truncated: matches.length > FILES_SEARCH_LIMIT }
  }

  async read(args: {
    userId: string
    sessionId: string
    path: string
    checkoutId?: string | undefined
    root?: EFilesRoot | undefined
  }): Promise<FilesReadOutput> {
    await this.sessions.requireOwnedSession({ userId: args.userId, sessionId: args.sessionId })
    const { base } = await this.scopeOf({
      sessionId: args.sessionId,
      checkoutId: args.checkoutId,
      root: args.root,
    })
    const target = base === undefined ? args.path : resolveInside({ root: base, path: args.path })
    const stat = await this.invoke({
      sessionId: args.sessionId,
      op: { op: 'stat', path: target },
    })
    if (stat.status === ECallStatus.Failed)
      return { file: { type: 'refused', path: args.path, reason: stat.error.message } }
    const stats = stat as StatResult
    const refusal = refusalOf({ path: args.path, stat: stats.value })
    if (refusal !== undefined) return { file: refusal }
    const read = await this.invoke({
      sessionId: args.sessionId,
      op: { op: 'readFile', path: target },
    })
    if (read.status === ECallStatus.Failed)
      return { file: { type: 'refused', path: args.path, reason: read.error.message } }
    const file = read as ReadFileResult
    return {
      file: {
        type: 'text',
        path: args.path,
        content: file.value,
        truncated: false,
        bytes: stats.value.size,
      },
    }
  }
}

const refusalOf = (args: { path: string; stat: StatValue }): FileContent | undefined => {
  if (!args.stat.isFile) return { type: 'refused', path: args.path, reason: 'not a file' }
  if (args.stat.size > LIVE_OP_MAX_BYTES)
    return { type: 'refused', path: args.path, reason: 'this file is too large to preview' }
  return undefined
}
