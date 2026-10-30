import {
  interpolateServiceEnv,
  type ProcessPort,
  type ProcessHandle,
  type ThreadId,
} from '@dltech/atlas-core'

import type { DeclaredService } from './declared-services'
import { cwdOf, resolvedFromRunning, type DeclaredContext } from './declared-launch'

const SETUP_TAIL_CHARACTERS = 2_000

async function collect({ stream }: { stream: ReadableStream<Uint8Array> }): Promise<string> {
  try {
    return await new Response(stream).text()
  } catch {
    return ''
  }
}

async function runCommand({
  handle,
}: {
  handle: ProcessHandle
}): Promise<{ code: number; tail: string }> {
  const [stdout, stderr, code] = await Promise.all([
    collect({ stream: handle.stdout }),
    collect({ stream: handle.stderr }),
    handle.exited,
  ])
  return { code, tail: `${stdout}${stderr}`.trimEnd().slice(-SETUP_TAIL_CHARACTERS) }
}

export async function runSetup({
  declared,
  context,
  spawn,
  threadId,
}: {
  declared: DeclaredService
  context: DeclaredContext
  spawn: ProcessPort['spawn']
  threadId: ThreadId
}): Promise<string | undefined> {
  const env = {
    ...process.env,
    ...interpolateServiceEnv({
      env: declared.env ?? {},
      resolved: resolvedFromRunning({ services: context.services }),
    }),
  }
  for (const command of declared.setup ?? []) {
    const { code, tail } = await runCommand({
      handle: spawn.call(context.processes, {
        cmd: ['bash', '-lc', command],
        cwd: cwdOf({ declared, root: context.root }),
        env,
        threadId,
      }),
    })
    if (code === 0) continue
    return `setup "${command}" exited ${code}${tail === '' ? '' : `\n${tail}`}`
  }
  return undefined
}
