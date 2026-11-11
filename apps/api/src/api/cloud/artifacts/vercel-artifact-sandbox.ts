import { Injectable } from '@nestjs/common'
import { Sandbox } from '@vercel/sandbox'
import { SandboxCredentials } from '../../../_core/ports/sandbox-credentials'
import {
  ARTIFACT_SANDBOX_STOP_TIMEOUT_MS,
  ARTIFACT_WORKSPACE,
  ArtifactSandbox,
  type ArtifactSandboxCommand,
  type ArtifactSandboxFile,
  type ArtifactSandboxRequest,
  type ArtifactSandboxResult,
} from './artifact-sandbox'

const SANDBOX_TERMINATE_SLACK_MS = 60_000

const OUTPUT_SLACK_MS = 10_000

const outputOf = async (command: {
  stdout(): Promise<string>
  stderr(): Promise<string>
}): Promise<{ stdout: string; stderr: string }> => {
  try {
    return { stdout: await command.stdout(), stderr: await command.stderr() }
  } catch {
    return { stdout: '', stderr: '' }
  }
}

const filesUnder = async (args: {
  sandbox: Sandbox
  dir: string
  base: string
}): Promise<ArtifactSandboxFile[]> => {
  const found: ArtifactSandboxFile[] = []
  let entries
  try {
    entries = await args.sandbox.fs.readdir(args.dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const path = `${args.dir}/${entry.name}`
    if (entry.isDirectory()) {
      found.push(...(await filesUnder({ ...args, dir: path })))
      continue
    }
    const content = await args.sandbox.readFileToBuffer({ path })
    if (content === null) continue
    found.push({ path: path.slice(args.base.length + 1), content })
  }
  return found
}

@Injectable()
export class VercelArtifactSandbox extends ArtifactSandbox {
  constructor(private readonly credentials: SandboxCredentials) {
    super()
  }

  async run(request: ArtifactSandboxRequest): Promise<ArtifactSandboxResult> {
    const { token, teamId, projectId } = await this.credentials.forThread({
      threadId: request.threadId,
    })
    const sandbox = await Sandbox.create({
      token,
      teamId,
      projectId,
      runtime: 'node22',
      timeout: request.timeoutMs + SANDBOX_TERMINATE_SLACK_MS,
    })
    try {
      await sandbox.mkDir(ARTIFACT_WORKSPACE)
      await sandbox.writeFiles(
        request.files.map((file) => ({
          path: `${ARTIFACT_WORKSPACE}/${file.path}`,
          content: file.content,
        })),
      )
      const deadline = Date.now() + request.timeoutMs
      const install =
        request.install === undefined
          ? null
          : await this.command({ sandbox, request, line: request.install, deadline })
      if (install !== null && (install.timedOut || install.exitCode !== 0)) {
        return { install, build: null, outDir: [] }
      }
      const build = await this.command({ sandbox, request, line: request.cmd, deadline })
      if (build.timedOut || build.exitCode !== 0) return { install, build, outDir: [] }
      const outDir = await filesUnder({
        sandbox,
        dir: `${ARTIFACT_WORKSPACE}/${request.outDir}`,
        base: ARTIFACT_WORKSPACE,
      })
      return { install, build, outDir }
    } finally {
      await sandbox
        .stop({ signal: AbortSignal.timeout(ARTIFACT_SANDBOX_STOP_TIMEOUT_MS) })
        .catch(() => undefined)
    }
  }

  // The sandbox SIGKILLs at `timeoutMs`, so the deadline is the only thing that separates a
  // timeout from a program that chose exit 137.

  private async command(args: {
    sandbox: Sandbox
    request: ArtifactSandboxRequest
    line: string
    deadline: number
  }): Promise<ArtifactSandboxCommand> {
    const remaining = Math.max(args.deadline - Date.now(), 1)
    const finished = await args.sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', args.line],
      cwd: ARTIFACT_WORKSPACE,
      env: args.request.env,
      timeoutMs: remaining,
      signal: AbortSignal.timeout(remaining + OUTPUT_SLACK_MS),
    })
    const output = await outputOf(finished)
    return {
      exitCode: finished.exitCode,
      ...output,
      timedOut: Date.now() >= args.deadline,
    }
  }
}
