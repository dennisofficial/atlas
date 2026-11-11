import { Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import {
  blobPathOf,
  contentTypeOf,
  exceededBy,
  type ArtifactSpec,
  type ManifestEntry,
} from '@dltech/atlas-artifacts'
import { ArtifactBlobStore } from './artifact-blob-store'
import { presentShas } from './artifact-repository'
import {
  ARTIFACT_BUILD_CLAMP_MS,
  ArtifactSandbox,
  artifactBuildEnv,
  type ArtifactSandboxCommand,
  type ArtifactSandboxFile,
  type ArtifactSandboxResult,
} from './artifact-sandbox'

export const ARTIFACT_LOG_CAP_BYTES = 64 * 1024

export type ArtifactBuildResult =
  | { status: 'ready'; manifest: ManifestEntry[]; log: string; durationMs: number }
  | { status: 'failed'; failure: string; log: string; durationMs: number }

const sha256Of = (content: Buffer): string => createHash('sha256').update(content).digest('hex')

const lastLine = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .at(-1) ?? ''

const tailOf = (text: string, bytes: number): string => {
  if (bytes <= 0) return ''
  let tail = text.slice(-bytes)
  while (Buffer.byteLength(tail) > bytes) tail = tail.slice(1)
  return tail
}

export const capArtifactLog = (args: {
  log: string
  header: string | null
  exitCode: number | null
  capBytes?: number
}): string => {
  const cap = args.capBytes ?? ARTIFACT_LOG_CAP_BYTES
  const body = args.header === null ? args.log : `${args.header}\n${args.log}`
  const total = Buffer.byteLength(body)
  if (total <= cap) return body
  const footerOf = (kept: number) =>
    `\n[log truncated: kept the last ${kept} of ${total} bytes; exit code ${args.exitCode ?? 'none'}]`
  const room = cap - Buffer.byteLength(footerOf(cap))
  const tail = tailOf(body, room)
  return `${tail}${footerOf(Buffer.byteLength(tail))}`
}

const sectionsOf = (result: ArtifactSandboxResult): string => {
  const parts: string[] = []
  const stages: [string, ArtifactSandboxCommand | null][] = [
    ['install', result.install],
    ['build', result.build],
  ]
  for (const [stage, command] of stages) {
    if (command === null) continue
    parts.push(`==> ${stage} (exit ${command.exitCode})`, `${command.stdout}${command.stderr}`)
  }
  return parts.join('\n')
}

const exitCodeOf = (result: ArtifactSandboxResult): number | null =>
  result.build?.exitCode ?? result.install?.exitCode ?? null

const commandFailure = (args: {
  stage: string
  command: ArtifactSandboxCommand
  timeoutMs: number
}): string => {
  if (args.command.timedOut) {
    return `${args.stage} timed out after ${Math.round(args.timeoutMs / 1000)}s`
  }
  const detail = lastLine(args.command.stderr)
  const head = `${args.stage} failed with exit code ${args.command.exitCode}`
  return detail.length === 0 ? head : `${head}: ${detail}`
}

const failureOf = (args: {
  result: ArtifactSandboxResult
  outDir: string
  timeoutMs: number
}): string | null => {
  const { install, build } = args.result
  if (install !== null && (install.timedOut || install.exitCode !== 0)) {
    return commandFailure({ stage: 'install', command: install, timeoutMs: args.timeoutMs })
  }
  if (build === null) return 'the build command did not run'
  if (build.timedOut || build.exitCode !== 0) {
    return commandFailure({ stage: 'build', command: build, timeoutMs: args.timeoutMs })
  }
  if (args.result.outDir.length === 0) {
    return `build.outDir ${args.outDir} is missing or empty after the build`
  }
  return null
}

const manifestOf = (files: readonly ArtifactSandboxFile[]): ManifestEntry[] =>
  [...files]
    .map((file) => ({
      path: file.path,
      tree: 'dist' as const,
      sha256: sha256Of(file.content),
      size: file.content.length,
      type: contentTypeOf(file.path),
    }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))

@Injectable()
export class ArtifactBuild {
  constructor(
    private readonly sandbox: ArtifactSandbox,
    private readonly blobs: ArtifactBlobStore,
  ) {}

  async run(args: {
    threadId: string
    spec: ArtifactSpec
    source: readonly ManifestEntry[]
  }): Promise<ArtifactBuildResult> {
    const build = args.spec.build
    if (build === undefined) throw new Error('ArtifactBuild.run needs a spec with a build block')
    const startedAt = Date.now()
    const timeoutMs = Math.min(build.timeoutSec * 1000, ARTIFACT_BUILD_CLAMP_MS)
    const header =
      build.timeoutSec * 1000 > ARTIFACT_BUILD_CLAMP_MS
        ? `artifact build clamped to ${Math.round(ARTIFACT_BUILD_CLAMP_MS / 1000)}s (spec.build.timeoutSec is ${build.timeoutSec})`
        : null
    const sources = await this.sourceFiles(args.source)
    if ('missing' in sources) {
      return {
        status: 'failed',
        failure: `the blob pool has no source for ${sources.missing}`,
        log: capArtifactLog({ log: '', header, exitCode: null }),
        durationMs: Date.now() - startedAt,
      }
    }
    const result = await this.sandbox.run({
      threadId: args.threadId,
      files: sources.files,
      install: build.install,
      cmd: build.cmd,
      outDir: build.outDir,
      env: artifactBuildEnv(),
      timeoutMs,
    })
    const log = capArtifactLog({ log: sectionsOf(result), header, exitCode: exitCodeOf(result) })
    const durationMs = Date.now() - startedAt
    const failure = failureOf({ result, outDir: build.outDir, timeoutMs })
    if (failure !== null) return { status: 'failed', failure, log, durationMs }
    const manifest = manifestOf(result.outDir)
    const exceeded = exceededBy(manifest)
    if (exceeded !== null) return { status: 'failed', failure: exceeded.reason, log, durationMs }
    await this.upload({ files: result.outDir, manifest })
    return { status: 'ready', manifest, log, durationMs }
  }

  private async sourceFiles(
    source: readonly ManifestEntry[],
  ): Promise<{ files: ArtifactSandboxFile[] } | { missing: string }> {
    const files: ArtifactSandboxFile[] = []
    for (const entry of source) {
      const content = await this.blobs.read({ pathname: blobPathOf(entry.sha256) })
      if (content === null) return { missing: `${entry.tree}/${entry.path}` }
      files.push({ path: entry.path, content })
    }
    return { files }
  }

  private async upload(args: {
    files: readonly ArtifactSandboxFile[]
    manifest: readonly ManifestEntry[]
  }): Promise<void> {
    const bySha = new Map<string, ArtifactSandboxFile>()
    for (const file of args.files) bySha.set(sha256Of(file.content), file)
    const present = await presentShas({ blobs: this.blobs, shas: [...bySha.keys()] })
    for (const [sha, file] of bySha) {
      if (present.has(sha)) continue
      await this.blobs.put({
        pathname: blobPathOf(sha),
        body: file.content,
        contentType: contentTypeOf(file.path),
        allowOverwrite: true,
      })
    }
  }
}
