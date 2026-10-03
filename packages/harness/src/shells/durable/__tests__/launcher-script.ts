import { launchDurableShell } from '../client'

const [shellDir, command, limit] = process.argv.slice(2)
if (shellDir === undefined || command === undefined) process.exit(2)

const outcome = await launchDurableShell({
  shellDir,
  command,
  cwd: process.cwd(),
  pollMs: 20,
  ...(limit === undefined ? {} : { outputLimitBytes: Number(limit) }),
})
if (!outcome.ok) {
  process.stdout.write(`${JSON.stringify({ ok: false, reason: outcome.reason })}\n`)
  process.exit(1)
}
process.stdout.write(`${JSON.stringify({ ok: true, pid: outcome.handle.pid })}\n`)
process.exit(0)
