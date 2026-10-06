import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Sandbox } from '@vercel/sandbox'

import { PRIVATE_REF } from './workspace-roundtrip-live-family'
import { liveGit, liveGitRaw } from './workspace-roundtrip-live-git'

export type TreeState = {
  head: string | null
  status: string
  ls: string
  ref: string | null
  files: Record<string, string | null>
}

export type TreeProbe = { key: string; path: string; rels: readonly string[] }

const orNull = async <T>(read: () => Promise<T>): Promise<T | null> => read().catch(() => null)

export async function inspectHostTree(args: { path: string; rels: readonly string[] }): Promise<TreeState> {
  const files: Record<string, string | null> = {}
  for (const rel of args.rels) files[rel] = await orNull(() => readFile(join(args.path, rel), 'utf8'))
  return {
    head: await orNull(() => liveGit({ cwd: args.path, args: ['rev-parse', 'HEAD'] })),
    status: await liveGitRaw({ cwd: args.path, args: ['status', '--porcelain=v1', '-uall'] }),
    ls: await liveGitRaw({ cwd: args.path, args: ['ls-files', '-s'] }),
    ref: await orNull(() => liveGit({ cwd: args.path, args: ['rev-parse', '--verify', '--quiet', PRIVATE_REF] })),
    files,
  }
}

const CLOUD_INSPECT = `import json,subprocess,sys,pathlib
def git(p,*a):
    r=subprocess.run(["git","-C",p,*a],capture_output=True,text=True)
    return r.stdout if r.returncode==0 else None
def strip(v):
    return None if v is None else v.strip()
out={}
for key,probe in json.loads(sys.argv[1]).items():
    p=probe["path"]
    files={}
    for rel in probe["rels"]:
        f=pathlib.Path(p)/rel
        files[rel]=f.read_text() if f.is_file() else None
    out[key]={"head":strip(git(p,"rev-parse","HEAD")),"status":git(p,"status","--porcelain=v1","-uall") or "","ls":git(p,"ls-files","-s") or "","ref":strip(git(p,"rev-parse","--verify","--quiet",${JSON.stringify(PRIVATE_REF)})),"files":files}
print(json.dumps(out))`

export async function inspectCloudTrees(args: { sandbox: Sandbox; probes: readonly TreeProbe[] }): Promise<Record<string, TreeState>> {
  const request = Object.fromEntries(args.probes.map((probe) => [probe.key, { path: probe.path, rels: probe.rels }]))
  const run = await args.sandbox.runCommand({ cmd: 'python3', args: ['-c', CLOUD_INSPECT, JSON.stringify(request)], timeoutMs: 60000 })
  if (run.exitCode !== 0) throw new Error(`cloud tree inspection failed: ${await run.stderr()}`)
  return JSON.parse(await run.stdout()) as Record<string, TreeState>
}

export function assertSameTree(args: { label: string; actual: TreeState; expected: TreeState; withFiles?: boolean }): void {
  const fields = args.withFiles === true ? (['head', 'status', 'ls', 'ref', 'files'] as const) : (['head', 'status', 'ls', 'ref'] as const)
  const differing = fields.filter((field) => JSON.stringify(args.actual[field]) !== JSON.stringify(args.expected[field]))
  if (differing.length > 0) throw new Error(`${args.label} differs in: ${differing.join(', ')}`)
}

export function assertFiles(args: { label: string; actual: Record<string, string | null>; expected: Record<string, string | null>; ignoreAbsent?: boolean }): void {
  const wrong = Object.keys(args.expected).filter((rel) => (args.ignoreAbsent === true && args.expected[rel] === null ? false : args.actual[rel] !== args.expected[rel]))
  if (wrong.length > 0) throw new Error(`${args.label} has wrong physical files: ${wrong.join(', ')}`)
}
