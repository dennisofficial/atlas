import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const HARDENED = /flags=0x[0-9a-f]+\(runtime\)/
const DEVELOPER_ID = /^Authority=Developer ID Application/m

export function signatureProblems({
  codesign,
  entitlements,
}: {
  codesign: string
  entitlements: string
}): readonly string[] {
  const problems: string[] = []
  if (!HARDENED.test(codesign)) {
    problems.push('the bun runtime is not signed with the hardened runtime')
  }
  if (!DEVELOPER_ID.test(codesign)) {
    problems.push('the bun runtime is not Developer ID signed')
  }
  if (!entitlements.includes('com.apple.security.cs.allow-jit')) {
    problems.push('the bun runtime cannot use the JIT')
  }
  return problems
}

export function addonSignatureProblems({ codesign }: { codesign: string }): readonly string[] {
  const problems: string[] = []
  if (!HARDENED.test(codesign)) {
    problems.push('the native picker addon is not signed with the hardened runtime')
  }
  if (!DEVELOPER_ID.test(codesign)) {
    problems.push('the native picker addon is not Developer ID signed')
  }
  return problems
}

function display(cmd: readonly string[]): string {
  const result = spawnSync(cmd[0] ?? '', cmd.slice(1), { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`\`${cmd.join(' ')}\` exited ${result.status ?? 'on a signal'}`)
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

if (import.meta.main) {
  const app = process.argv[2]
  if (app === undefined) throw new Error('usage: verify-signature.ts <Atlas.app>')
  const runtime = join(app, 'Contents', 'Resources', 'bin', 'bun')
  const addon = join(app, 'Contents', 'Resources', 'native', 'atlas_native.node')
  const problems = [
    ...signatureProblems({
      codesign: display(['codesign', '-dvv', runtime]),
      entitlements: display(['codesign', '-d', '--entitlements', ':-', runtime]),
    }),
    ...addonSignatureProblems({ codesign: display(['codesign', '-dvv', addon]) }),
  ]
  for (const problem of problems) console.error(`::error::${problem}`)
  if (problems.length > 0) process.exit(1)
  console.log(`${runtime} is Developer ID signed, hardened and JIT-entitled`)
  console.log(`${addon} is Developer ID signed and hardened`)
}
