import { Sandbox } from '@vercel/sandbox'

import { loadVercelCredentials } from './workspace-roundtrip-live-credentials'

const NAME = process.env['ATLAS_SWAP_LOCK_SANDBOX'] ?? ''
if (NAME === '') throw new Error('ATLAS_SWAP_LOCK_SANDBOX must name the sandbox')

const credentials = await loadVercelCredentials()
const sandbox = await Sandbox.get({ ...credentials, name: NAME })

const sh = async (script: string): Promise<{ exit: number; out: string }> => {
  const run = await sandbox.runCommand({ cmd: 'sh', args: ['-c', script], timeoutMs: 30_000 })
  return { exit: run.exitCode, out: (await run.stdout()).trim() }
}

await sh('rm -f /opt/atlas/dprobe.lock /opt/atlas/dprobe.release')

const holder = await sandbox.runCommand({
  cmd: 'sh',
  args: [
    '-c',
    'exec 9> /opt/atlas/dprobe.lock && flock -x 9 && while [ ! -f /opt/atlas/dprobe.release ]; do sleep 0.2; done',
  ],
  detached: true,
})
await new Promise((resolve) => setTimeout(resolve, 1500))

const blocked = await sh('flock -w 2 -x /opt/atlas/dprobe.lock -c "echo GOT" || echo TIMED-OUT')
console.log(JSON.stringify({ phase: 'contender-while-held', result: blocked.out }))

await sh('touch /opt/atlas/dprobe.release')
await holder.wait()
const after = await sh('flock -w 2 -x /opt/atlas/dprobe.lock -c "echo GOT" || echo TIMED-OUT')
console.log(JSON.stringify({ phase: 'contender-after-release', result: after.out }))

const proven = blocked.out.includes('TIMED-OUT') && after.out.includes('GOT')
console.log(JSON.stringify({ phase: proven ? 'DETACHED_HOLDER_PROVEN' : 'MECHANISM_FAILED' }))
await sh('rm -f /opt/atlas/dprobe.*')
