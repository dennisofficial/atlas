import { runtimeCheckpointFile, VercelDriver } from '@dltech/atlas-harness'
import {
  SANDBOX_HOME_PATH,
  SANDBOX_QUICK_TIMEOUT_MS,
  SERVE_HOME,
  SERVE_LOG_PATH,
  SERVE_PROTOCOL_PATH,
  SERVE_VERSION_PATH,
  isSandboxMissing,
  liveSdk,
  runtimeCheckpointSchema,
  sandboxSh,
  type RuntimeCheckpoint,
  type VercelCredentials,
} from '@dltech/atlas-wire'

import type { Ledger } from './rig-ledger'

export type BoxProbe = {
  provider: string
  running: boolean
  record: RuntimeCheckpoint | null
  recordError: string | null
  version: string | null
  protocol: number | null
  servePid: string | null
  logTail: string | null
}

export type Probes = {
  box: (args: { name: string; logLines?: number | undefined }) => Promise<BoxProbe>
  sh: (args: { name: string; script: string; timeoutMs?: number | undefined }) => Promise<string>
  destroy: (args: { name: string; ledger: Ledger; log: (line: string) => void }) => Promise<void>
}

enum ESection {
  Record = 'record',
  Version = 'version',
  Protocol = 'protocol',
  Pid = 'pid',
  Log = 'log',
}

type LiveSandbox = Awaited<ReturnType<typeof liveSdk.get>>

const RUNNING = 'running'
const MISSING = 'missing'
const GET_TIMEOUT_MS = 30_000
const DEFAULT_LOG_LINES = 80
const SECTION_MARKER = '@@atlas-rig-section:'
const CHECKPOINT_PATH = runtimeCheckpointFile({ atlasHome: SANDBOX_HOME_PATH })
const SERVE_PID_PATH = `${SERVE_HOME}/atlas-serve.pid`

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const readsOf = (logLines: number): readonly { section: ESection; command: string }[] => [
  { section: ESection.Record, command: `cat ${CHECKPOINT_PATH}` },
  { section: ESection.Version, command: `cat ${SERVE_VERSION_PATH}` },
  { section: ESection.Protocol, command: `cat ${SERVE_PROTOCOL_PATH}` },
  { section: ESection.Pid, command: `cat ${SERVE_PID_PATH}` },
  { section: ESection.Log, command: `tail -n ${logLines} ${SERVE_LOG_PATH}` },
]

const probeScriptOf = (logLines: number): string =>
  readsOf(logLines)
    .map(({ section, command }) => `echo '${SECTION_MARKER}${section}'; ${command} 2>/dev/null; echo`)
    .join('; ')

const sectionsOf = (stdout: string): Map<string, string> => {
  const lines = new Map<string, string[]>()
  let current: string[] | null = null
  for (const line of stdout.split('\n')) {
    if (line.startsWith(SECTION_MARKER)) {
      current = []
      lines.set(line.slice(SECTION_MARKER.length), current)
      continue
    }
    current?.push(line)
  }
  return new Map([...lines].map(([section, body]) => [section, body.join('\n').trim()]))
}

const textOf = (args: { sections: Map<string, string>; section: ESection }): string | null => {
  const text = args.sections.get(args.section)
  return text === undefined || text.length === 0 ? null : text
}

const protocolOf = (text: string | null): number | null => {
  if (text === null) return null
  const protocol = Number(text)
  return Number.isInteger(protocol) ? protocol : null
}

const recordOf = (text: string | null): { record: RuntimeCheckpoint | null; recordError: string | null } => {
  if (text === null) return { record: null, recordError: null }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    return { record: null, recordError: `the lifecycle record is not JSON: ${messageOf(error)}` }
  }
  const parsed = runtimeCheckpointSchema.safeParse(json)
  if (!parsed.success) {
    return { record: null, recordError: `the lifecycle record does not match its schema: ${parsed.error.message}` }
  }
  return { record: parsed.data, recordError: null }
}

const idleProbe = (provider: string): BoxProbe => ({
  provider,
  running: false,
  record: null,
  recordError: null,
  version: null,
  protocol: null,
  servePid: null,
  logTail: null,
})

export function createProbes(args: { credentials: VercelCredentials; cloudUrl: string }): Probes {
  const sandboxNamed = async (name: string): Promise<LiveSandbox | null> => {
    try {
      return await liveSdk.get({
        ...args.credentials,
        name,
        resume: false,
        signal: AbortSignal.timeout(GET_TIMEOUT_MS),
      })
    } catch (failure) {
      if (isSandboxMissing(failure)) return null
      throw failure
    }
  }

  const box: Probes['box'] = async ({ name, logLines }) => {
    const sandbox = await sandboxNamed(name)
    if (sandbox === null) return idleProbe(MISSING)
    if (sandbox.status !== RUNNING) return idleProbe(sandbox.status)

    const run = await sandboxSh({
      sandbox,
      script: probeScriptOf(logLines ?? DEFAULT_LOG_LINES),
      timeoutMs: SANDBOX_QUICK_TIMEOUT_MS,
    })
    const sections = sectionsOf(await run.stdout())
    return {
      provider: sandbox.status,
      running: true,
      ...recordOf(textOf({ sections, section: ESection.Record })),
      version: textOf({ sections, section: ESection.Version }),
      protocol: protocolOf(textOf({ sections, section: ESection.Protocol })),
      servePid: textOf({ sections, section: ESection.Pid }),
      logTail: textOf({ sections, section: ESection.Log }),
    }
  }

  const sh: Probes['sh'] = async ({ name, script, timeoutMs }) => {
    const sandbox = await sandboxNamed(name)
    const status = sandbox?.status ?? MISSING
    if (sandbox === null || sandbox.status !== RUNNING) {
      throw new Error(`refusing to run in a sandbox that is not running (${status})`)
    }
    const run = await sandboxSh({ sandbox, script, timeoutMs: timeoutMs ?? SANDBOX_QUICK_TIMEOUT_MS })
    return (await run.stdout()).trimEnd()
  }

  const destroy: Probes['destroy'] = async ({ name, ledger, log }) => {
    if (!(await ledger.has(name))) {
      throw new Error(`refusing to destroy ${name}: the rig ledger never recorded it`)
    }
    log(`destroying sandbox ${name}`)
    await new VercelDriver({ credentials: args.credentials, cloudUrl: args.cloudUrl }).destroy({ name })
  }

  return { box, sh, destroy }
}
