import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ThreadId } from '@dltech/atlas-core'
import { sandboxNameFor } from '@dltech/atlas-harness'

import type { Scenario, ScenarioContext } from './rig-context'
import { createRedactor, type EVerdict, type ScenarioEvidence, writeEvidence } from './rig-evidence'
import type { RigEnv } from './rig-home'
import { createLedger, type Ledger } from './rig-ledger'
import type { RigApp } from './rig-mount'
import type { Probes } from './rig-probes'
import {
  API_WAKE_ID,
  FRESH_ID,
  UNGATED_TRUST,
  USAGE,
  combinedTrust,
  destroyLedgerNames,
  exitCodeOf,
  failedEvidence,
  failureTails,
  helloProtocol,
  notRunEvidence,
  notRunReasonOf,
  parseRigArgs,
  renderSummary,
  withTrust,
  type EvidenceLog,
  type RigArgs,
  type RigTrust,
  type ScenarioHead,
  type ScenarioResult,
} from './rig-runner'

type Run = {
  args: RigArgs
  env: RigEnv
  ledger: Ledger
  probes: Probes
  shared: Map<string, string>
  current: RigApp | null
  created: string[]
  results: ScenarioResult[]
  verdicts: Map<number, EVerdict>
  trust: RigTrust
  inFlight: ScenarioHead | null
  startedAt: string
}

const CLOSE_WITHIN_MS = 15_000
const USAGE_EXIT = 2
const INTERRUPT_EXIT = 130
const SIGNALS = ['SIGINT', 'SIGTERM'] as const

const redactor = createRedactor()
let liveRun: Run | null = null

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const holdKnownSecrets = (): void => {
  const token = liveRun?.current?.channel()?.attachment()?.token
  if (token !== undefined) redactor.hold(token)
}

const log = (line: string): void => {
  holdKnownSecrets()
  console.log(redactor.redact(`${new Date().toISOString()} ${line}`))
}

const headOf = (scenario: ScenarioHead): ScenarioHead => ({
  id: scenario.id,
  slug: scenario.slug,
  title: scenario.title,
})

const requireRig = (run: Run): RigApp => {
  if (run.current === null) throw new Error('the App is not mounted')
  return run.current
}

const mountWith = async (args: {
  run: Run
  resumeThreadId?: ThreadId | undefined
}): Promise<RigApp> => {
  const { mountRig } = await import('./rig-mount')
  const handleBirth = async (threadId: ThreadId): Promise<void> => {
    const name = sandboxNameFor({ threadId })
    if (!args.run.created.includes(name)) args.run.created.push(name)
    if (await args.run.ledger.has(name)) return
    await args.run.ledger.add({ name, threadId })
    log(`ledger: recorded ${name} before provisioning`)
  }
  args.run.current = await mountRig({
    workspace: args.run.env.workspace,
    settings: args.run.env.settings,
    resumeThreadId: args.resumeThreadId,
    onBirth: handleBirth,
  })
  return args.run.current
}

const closeWithin = async (rig: RigApp): Promise<void> => {
  const closed = rig.close().then(
    () => 'closed',
    (error: unknown) => `close failed: ${messageOf(error)}`,
  )
  const outcome = await Promise.race([
    closed,
    Bun.sleep(CLOSE_WITHIN_MS).then(() => 'close timed out'),
  ])
  if (outcome !== 'closed') log(`App ${outcome}`)
}

const contextOf = (run: Run): ScenarioContext => ({
  env: run.env,
  probes: run.probes,
  ledger: run.ledger,
  redactor,
  out: run.args.out,
  rig: () => requireRig(run),
  remount: async () => {
    const previous = requireRig(run)
    await closeWithin(previous)
    return mountWith({ run, resumeThreadId: previous.threadId })
  },
  sandboxName: () => sandboxNameFor({ threadId: requireRig(run).threadId }),
  log,
  shared: run.shared,
})

const attempt = async (args: { run: Run; scenario: Scenario }): Promise<ScenarioEvidence> => {
  const { run, scenario } = args
  run.inFlight = headOf(scenario)
  log(`scenario ${scenario.id} — ${scenario.title}: start`)
  try {
    if (scenario.id !== API_WAKE_ID && run.current === null) await mountWith({ run })
    return await scenario.run(contextOf(run))
  } catch (error) {
    log(`scenario ${scenario.id} failed: ${messageOf(error)}`)
    return failedEvidence({
      scenario: headOf(scenario),
      error,
      tails: await failureTails({ rig: run.current, probes: run.probes }),
    })
  } finally {
    run.inFlight = null
  }
}

const trustGate = async (run: Run): Promise<{ trust: RigTrust; log: EvidenceLog }> => {
  const rig = run.current
  const attachment = rig?.channel()?.attachment()
  const untrusted = (reason: string) => ({
    trust: { trusted: false, reason },
    log: { label: 'trust gate', text: `UNTRUSTED: ${reason}` },
  })
  if (rig === null || rig === undefined || attachment === undefined)
    return untrusted('no attached channel to read the stamps and Ready from')
  redactor.hold(attachment.token)
  try {
    const probe = await run.probes.box({
      name: sandboxNameFor({ threadId: rig.threadId }),
      logLines: 1,
    })
    const readyProtocol = await helloProtocol({
      url: attachment.url,
      token: attachment.token,
      threadId: rig.threadId,
    }).catch((error: unknown) => {
      log(`trust gate: raw hello failed: ${messageOf(error)}`)
      return null
    })
    const trust = combinedTrust({
      version: probe.version,
      boxProtocol: probe.protocol,
      readyProtocol,
    })
    const text = [
      `provider ${probe.provider}`,
      `version stamp ${probe.version ?? 'unread'}`,
      `protocol stamp ${probe.protocol ?? 'unread'}`,
      `Ready protocol ${readyProtocol ?? 'unread'}`,
      `${trust.trusted ? 'trusted' : 'UNTRUSTED'}: ${trust.reason}`,
    ].join('\n')
    return { trust, log: { label: 'trust gate', text } }
  } catch (error) {
    return untrusted(`the trust gate probe failed: ${messageOf(error)}`)
  }
}

const record = async (args: { run: Run; evidence: ScenarioEvidence }): Promise<void> => {
  holdKnownSecrets()
  const final = withTrust({ evidence: args.evidence, trust: args.run.trust })
  const path = await writeEvidence({ dir: args.run.args.out, evidence: final, redactor })
  args.run.results.push({ ...headOf(final), verdict: final.verdict, path })
  log(`scenario ${final.id}: ${final.verdict} → ${path}`)
}

const runScenario = async (args: { run: Run; scenario: Scenario }): Promise<void> => {
  const { run, scenario } = args
  const notRunReason = notRunReasonOf({ id: scenario.id, verdicts: run.verdicts })
  let evidence =
    notRunReason === null
      ? await attempt({ run, scenario })
      : notRunEvidence({ scenario: headOf(scenario), reason: notRunReason })
  run.verdicts.set(scenario.id, evidence.verdict)
  if (scenario.id === FRESH_ID) {
    const gate = await trustGate(run)
    run.trust = gate.trust
    log(`trust gate: ${gate.trust.trusted ? 'trusted' : 'UNTRUSTED'} — ${gate.trust.reason}`)
    evidence = { ...evidence, logs: [...evidence.logs, gate.log] }
  }
  await record({ run, evidence })
}

const finish = async (args: { run: Run; interruptedBy: string | null }): Promise<number> => {
  const { run } = args
  holdKnownSecrets()
  if (run.inFlight !== null && args.interruptedBy !== null) {
    const evidence = failedEvidence({
      scenario: run.inFlight,
      error: new Error(`interrupted by ${args.interruptedBy}`),
      tails: [],
    })
    await record({ run, evidence }).catch((error: unknown) =>
      log(`could not write the interrupted evidence: ${messageOf(error)}`),
    )
  }
  if (run.current !== null) await closeWithin(run.current)
  const swept = run.args.keep
    ? { destroyed: [], failures: [] }
    : await destroyLedgerNames({ ledger: run.ledger, probes: run.probes, log })
  const summary = renderSummary({
    startedAt: run.startedAt,
    finishedAt: new Date().toISOString(),
    threadId: run.current?.threadId ?? null,
    trust: run.trust,
    results: run.results,
    created: run.created,
    destroyed: swept.destroyed,
    destroyFailures: swept.failures,
    kept: run.args.keep,
    interruptedBy: args.interruptedBy,
  })
  const path = join(run.args.out, 'run-summary.md')
  await writeFile(path, redactor.redact(summary))
  log(`summary → ${path}`)
  await run.env.cleanup().catch((error: unknown) => log(`env cleanup failed: ${messageOf(error)}`))
  return args.interruptedBy === null ? exitCodeOf(run.results) : INTERRUPT_EXIT
}

let finishing: Promise<number> | null = null
const finishOnce = (args: { run: Run; interruptedBy: string | null }): Promise<number> => {
  finishing ??= finish(args)
  return finishing
}

const installSignalHandlers = (run: Run): void => {
  for (const signal of SIGNALS) {
    const handleSignal = (): void => {
      log(
        `${signal}: writing the summary and destroying ledger sandboxes${run.args.keep ? ' (kept: --keep)' : ''}`,
      )
      void finishOnce({ run, interruptedBy: signal }).then(
        (code) => process.exit(code),
        () => process.exit(INTERRUPT_EXIT),
      )
    }
    process.on(signal, handleSignal)
  }
}

const runCleanup = async (args: {
  env: RigEnv
  ledger: Ledger
  probes: Probes
}): Promise<number> => {
  const swept = await destroyLedgerNames({ ledger: args.ledger, probes: args.probes, log })
  log(`cleanup: destroyed ${swept.destroyed.length}, failed ${swept.failures.length}`)
  await args.env.cleanup()
  return swept.failures.length === 0 ? 0 : 1
}

const main = async (): Promise<number> => {
  if (process.env.ATLAS_LIVE_RIG !== '1') {
    console.log(USAGE)
    return 0
  }
  const parsed = parseRigArgs({ argv: process.argv.slice(2), env: process.env })
  if (!parsed.ok) {
    console.error(`${parsed.error}\n\n${USAGE}`)
    return USAGE_EXIT
  }
  const args = parsed.args
  await mkdir(args.out, { recursive: true })
  const { prepareRigEnv } = await import('./rig-home')
  const { createProbes } = await import('./rig-probes')
  const env = await prepareRigEnv({ repo: args.repo })
  redactor.hold(env.credentials.token)
  const ledger = createLedger({ file: join(args.out, 'ledger.json') })
  const probes = createProbes({ credentials: env.credentials, cloudUrl: env.cloudUrl })
  if (args.cleanup) return runCleanup({ env, ledger, probes })

  const { SCENARIOS } = await import('./rig-scenarios')
  const shared = new Map<string, string>()
  if (args.mismatch !== undefined) shared.set('mismatch', args.mismatch)
  shared.set('repo', args.repo)
  const run: Run = {
    args,
    env,
    ledger,
    probes,
    shared,
    current: null,
    created: [],
    results: [],
    verdicts: new Map(),
    trust: UNGATED_TRUST,
    inFlight: null,
    startedAt: new Date().toISOString(),
  }
  liveRun = run
  installSignalHandlers(run)
  try {
    for (const scenario of SCENARIOS.filter((candidate) => args.scenarios.includes(candidate.id))) {
      await runScenario({ run, scenario })
    }
  } catch (error) {
    log(`the run stopped early: ${messageOf(error)}`)
  }
  return finishOnce({ run, interruptedBy: null })
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(redactor.redact(`live rig crashed: ${messageOf(error)}`))
    process.exit(1)
  },
)
