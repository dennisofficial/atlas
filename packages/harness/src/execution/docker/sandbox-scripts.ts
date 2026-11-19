import { demuxExecStream } from './frames'
import type { SandboxEngine } from './sandbox'

export type ScriptOutcome = {
  exitCode: number
  output: string
}

const collectText = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value !== undefined) chunks.push(value)
  }

  const merged = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return new TextDecoder().decode(merged)
}

const exitCodeOf = async (args: { engine: SandboxEngine; execId: string }): Promise<number> => {
  for (;;) {
    const state = await args.engine.inspectExec({ execId: args.execId })
    if (!state.running && state.exitCode !== null) return state.exitCode
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

export async function runSandboxScript(args: {
  engine: SandboxEngine
  containerId: string
  script: string
  cwd: string
  user?: string | undefined
}): Promise<ScriptOutcome> {
  const exec = await args.engine.createExec({
    containerId: args.containerId,
    cmd: ['sh', '-c', args.script],
    cwd: args.cwd,
    env: {},
    ...(args.user === undefined ? {} : { user: args.user }),
  })
  const demuxed = demuxExecStream({ stream: await args.engine.startExec({ execId: exec.id }) })
  const [stdout, stderr] = await Promise.all([
    collectText(demuxed.stdout),
    collectText(demuxed.stderr),
  ])
  await demuxed.done

  return {
    exitCode: await exitCodeOf({ engine: args.engine, execId: exec.id }),
    output: `${stdout}${stderr}`.trim(),
  }
}
