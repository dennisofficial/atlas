import { Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import {
  MAX_BYTES_PER_VERSION,
  MAX_FILES_PER_VERSION,
  type ArtifactSpec,
} from '@dltech/atlas-artifacts'
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
  | { status: 'ready'; files: ArtifactSandboxFile[]; log: string; durationMs: number }
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

const limitFailure = (files: readonly ArtifactSandboxFile[]): string | null => {
  if (files.length > MAX_FILES_PER_VERSION) {
    return `the build wrote ${files.length} files, over the ${MAX_FILES_PER_VERSION} file ceiling`
  }
  const bytes = files.reduce((total, file) => total + file.content.length, 0)
  if (bytes > MAX_BYTES_PER_VERSION) {
    return `the build wrote ${bytes} bytes, over the ${MAX_BYTES_PER_VERSION} byte ceiling`
  }
  return null
}

const sortedFiles = (files: readonly ArtifactSandboxFile[]): ArtifactSandboxFile[] =>
  [...files].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))

export const fingerprintOf = (files: readonly ArtifactSandboxFile[]): string =>
  sha256Of(
    Buffer.from(
      sortedFiles(files)
        .map((file) => `${file.path}\0${sha256Of(file.content)}`)
        .join('\n'),
    ),
  )

@Injectable()
export class ArtifactBuild {
  constructor(private readonly sandbox: ArtifactSandbox) {}

  async run(args: {
    threadId: string
    spec: ArtifactSpec
    files: readonly ArtifactSandboxFile[]
  }): Promise<ArtifactBuildResult> {
    const build = args.spec.build
    if (build === undefined) throw new Error('ArtifactBuild.run needs a spec with a build block')
    const startedAt = Date.now()
    const timeoutMs = Math.min(build.timeoutSec * 1000, ARTIFACT_BUILD_CLAMP_MS)
    const header =
      build.timeoutSec * 1000 > ARTIFACT_BUILD_CLAMP_MS
        ? `artifact build clamped to ${Math.round(ARTIFACT_BUILD_CLAMP_MS / 1000)}s (spec.build.timeoutSec is ${build.timeoutSec})`
        : null
    const result = await this.sandbox.run({
      threadId: args.threadId,
      files: args.files,
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
    const limited = limitFailure(result.outDir)
    if (limited !== null) return { status: 'failed', failure: limited, log, durationMs }
    return { status: 'ready', files: sortedFiles(result.outDir), log, durationMs }
  }
}
