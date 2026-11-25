import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MODEL_NAMES: Record<string, string> = {
  V2SessionPullRequest: 'SessionPullRequest',
  V2WorktreeChangedFile: 'WorktreeChangedFile',
  V2WorktreeChanges: 'WorktreeChanges',
  V2SessionBranch: 'SessionBranch',
  V2SessionView: 'SessionView',
  V2ComposerDraft: 'SessionDraft',
  V2DiagramRepair: 'DiagramRepair',
  V2InboxEntry: 'InboxEntry',
  V2ContextFile: 'ContextFile',
  V2SandboxRun: 'SandboxRun',
  V2ChangeBlob: 'ChangeBlob',
  V2RoutineRun: 'RoutineRun',
  V2PushDevice: 'PushDevice',
  V2Terminal: 'Terminal',
  V2Routine: 'Routine',
  V2Session: 'Session',
  V2Thread: 'Thread',
  V2Event: 'Event',
  V2Lease: 'Lease',
  V2BlobRef: 'BlobRef',
  V2Blob: 'Blob',
  V2Host: 'Host',
  MediaSigningWindow: 'MediaSigningWindow',
  Media: 'Media',
}

const MODEL = Object.keys(MODEL_NAMES).join('|')
const publicModel = (model: string) => MODEL_NAMES[model] ?? model

const REWRITES: { pattern: RegExp; replace: (...groups: string[]) => string }[] = [
  {
    pattern: new RegExp(`\\borm\\.v2\\.(${MODEL})\\b`, 'g'),
    replace: (_, model) => `orm.public.${publicModel(model)}`,
  },
  {
    pattern: new RegExp(`"v2"\\."(${MODEL})"`, 'g'),
    replace: (_, model) => `"public"."${publicModel(model)}"`,
  },
  {
    pattern: new RegExp(`\\bsql\\.v2\\.(${MODEL})\\b`, 'g'),
    replace: (_, model) => `sql.public.${publicModel(model)}`,
  },
  {
    pattern: new RegExp(`\\bv2\\."(${MODEL})"`, 'g'),
    replace: (_, model) => `public."${publicModel(model)}"`,
  },
]

const rewrite = (source: string): string => {
  let out = source
  for (const rule of REWRITES) out = out.replace(rule.pattern, rule.replace)
  return out
}

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'migrations', 'dist', 'deprecated', '.git'])

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name) ? [] : sourceFiles(path)
    }
    return /\.(ts|tsx)$/.test(entry.name) && statSync(path).isFile() ? [path] : []
  })

if (import.meta.main) {
  const roots = process.argv.slice(2)
  let changed = 0
  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      const source = readFileSync(file, 'utf8')
      const next = rewrite(source)
      if (next === source) continue
      writeFileSync(file, next)
      changed += 1
    }
  }
  console.log(`rewrote ${changed} files`)
}
