import type { Sandbox } from '@vercel/sandbox'

import { SANDBOX_HOME_PATH } from './serve-env.js'

export const CLONE_PREFETCH_DIR = `${SANDBOX_HOME_PATH}/operational/clone-prefetch`
export const CLONE_PREFETCH_REPO_DIR = `${CLONE_PREFETCH_DIR}/repo`
export const CLONE_PREFETCH_LOCK = `${CLONE_PREFETCH_DIR}/lock`
export const CLONE_PREFETCH_RESULT = `${CLONE_PREFETCH_DIR}/result.json`
export const CLONE_PREFETCH_CLAIMED = `${CLONE_PREFETCH_DIR}/claimed`

const REASON_TAIL_BYTES = 400

export type ClonePrefetchResult = { ok: true } | { ok: false; reason: string }

const shellQuoted = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`

export const clonePrefetchScript = (args: {
  remoteUrl: string
  credentialedUrl: string
  baseBranch: string | null
}): string => {
  const branch = args.baseBranch ? ['--branch', shellQuoted(args.baseBranch)] : []
  const clone = [
    'git clone --filter=blob:none',
    ...branch,
    '--',
    shellQuoted(args.credentialedUrl),
    `"$repo"`,
  ].join(' ')
  const disarm = `git -C "$repo" remote set-url origin ${shellQuoted(args.remoteUrl)}`
  return [
    'set -eu',
    `dir=${shellQuoted(CLONE_PREFETCH_DIR)}`,
    'repo="$dir/repo"',
    'mkdir -p "$dir"',
    'exec 9>"$dir/lock"',
    'flock 9',
    'if [ -e "$dir/result.json" ] || [ -e "$dir/claimed" ]; then exit 0; fi',
    'rm -rf "$repo"',
    `if err=$(${clone} 2>&1 && ${disarm} 2>&1); then`,
    `  printf '{"ok":true}' > "$dir/result.json.tmp"`,
    'else',
    '  rm -rf "$repo"',
    `  reason=$(printf '%s' "$err" | sed 's#://[^/@ ]*@#://***@#g' | tail -c ${REASON_TAIL_BYTES} | tr -d '"\\\\' | tr '\\n\\r\\t' '   ')`,
    `  printf '{"ok":false,"reason":"%s"}' "$reason" > "$dir/result.json.tmp"`,
    'fi',
    'mv -f "$dir/result.json.tmp" "$dir/result.json"',
  ].join('\n')
}

export const clonePrefetchWaitScript = (): string =>
  `if [ -f ${shellQuoted(CLONE_PREFETCH_RESULT)} ]; then cat ${shellQuoted(CLONE_PREFETCH_RESULT)}; else touch ${shellQuoted(CLONE_PREFETCH_CLAIMED)}; fi`

export const parseClonePrefetchResult = (text: string): ClonePrefetchResult | undefined => {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || !('ok' in parsed)) return undefined
    if (parsed.ok === true) return { ok: true }
    const reason = 'reason' in parsed && typeof parsed.reason === 'string' ? parsed.reason : ''
    return { ok: false, reason }
  } catch {
    return undefined
  }
}

export async function startClonePrefetch(args: {
  sandbox: Sandbox
  remoteUrl: string
  credentialedUrl: string
  baseBranch: string | null
  log: (line: string) => void
}): Promise<void> {
  try {
    await args.sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', clonePrefetchScript(args)],
      detached: true,
    })
  } catch (failure) {
    args.log(
      `clone prefetch failed to start: ${failure instanceof Error ? failure.message : String(failure)}`,
    )
  }
}
