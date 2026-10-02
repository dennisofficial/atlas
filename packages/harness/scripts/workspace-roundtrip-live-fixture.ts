import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EAccountOrigin, EAuthKind, EAuthProvider, EExecutionLocation, toThreadId } from '@dltech/atlas-core'
import { fileAccountStore } from '../src/credentials/account-store'

import { SystemClock } from '../src/store/clock'
import { RandomIds } from '../src/store/ids'
import { JsonlEventLog } from '../src/store/sessions/event-log'
import { JsonlThreadStore } from '../src/store/sessions/thread-store'
import { SessionRegistry } from '../src/store/sessions/registry'
import { UnstaffedAgents, UnstaffedServices } from '../src/store/__tests__/harness'
import { InMemoryToolRegistry } from '../src/tools/registry'
import { PlacementController } from '../src/composition/placement-controller'

export async function liveGit(args: { cwd: string; args: readonly string[] }): Promise<string> {
  const process = Bun.spawn(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args.args], {
    cwd: args.cwd,
    env: { ...globalThis.process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TRACE2: '0', GIT_TRACE2_EVENT: '0', GIT_TRACE2_PERF: '0' },
    stdout: 'pipe', stderr: 'pipe', stdin: 'ignore',
  })
  const [stdout, stderr, exit] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited])
  if (exit !== 0) throw new Error(`git ${args.args.join(' ')} failed: ${stderr}`)
  return stdout.trim()
}

export async function liveFixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'atlas-workspace-live-')))
  const repository = join(directory, 'repository')
  const home = join(directory, 'home')
  const worktree = join(repository, '.atlas', 'worktrees', 'feature')
  await mkdir(repository)
  await mkdir(home)
  await liveGit({ cwd: repository, args: ['init', '-b', 'main'] })
  await liveGit({ cwd: repository, args: ['config', 'user.name', 'Atlas Live Probe'] })
  await liveGit({ cwd: repository, args: ['config', 'user.email', 'probe@example.invalid'] })
  await writeFile(join(repository, '.gitignore'), '.atlas/\nignored.txt\n')
  await writeFile(join(repository, 'file.txt'), 'base\n')
  await liveGit({ cwd: repository, args: ['add', '.'] })
  await liveGit({ cwd: repository, args: ['commit', '-m', 'base fixture'] })
  await liveGit({ cwd: repository, args: ['worktree', 'add', '-b', 'feature', worktree] })
  await writeFile(join(worktree, 'file.txt'), 'staged local\n')
  await liveGit({ cwd: worktree, args: ['add', 'file.txt'] })
  await writeFile(join(worktree, 'file.txt'), 'unstaged local\n')
  await writeFile(join(worktree, 'untracked.txt'), 'untracked local\n')
  await writeFile(join(worktree, 'ignored.txt'), 'ignored local\n')
  const ids = new RandomIds()
  const clock = new SystemClock()
  await fileAccountStore({ file: join(home, 'auth.json'), keyFile: join(home, 'key'), clock }).add({
    provider: EAuthProvider.OpenRouter,
    origin: EAccountOrigin.Login,
    label: 'Local deterministic probe model',
    secret: { kind: EAuthKind.ApiKey, apiKey: 'probe-placeholder-key' },
  })
  await writeFile(join(home, 'settings.json'), JSON.stringify({
    'model.id': 'openrouter/openai/gpt-4o-mini',
    'model.quickModel': 'openrouter/openai/gpt-4o-mini',
    'model.compactionModel': 'openrouter/openai/gpt-4o-mini',
    'classifier.mode': 'off',
  }))
  const registry = new SessionRegistry(home)
  const log = new JsonlEventLog(home, registry, clock, ids)
  const threads = new JsonlThreadStore(home, registry, clock, ids, log)
  const threadId = toThreadId(`brn_live_roundtrip_${crypto.randomUUID()}`)
  await threads.createWithFirstEvents({
    threadId, runId: ids.nextRunId(), workspace: worktree, repo: repository,
    executionLocation: EExecutionLocation.Host,
    model: { ref: 'openrouter/openai/gpt-4o-mini', effort: 'medium' },
    drafts: [{ type: 'user-said', text: 'Prepare a workspace round trip.' }],
  })
  const placement = new PlacementController(EExecutionLocation.Host)
  placement.bind({ threads, workspace: worktree, repo: repository })
  await placement.activate({ threadId })
  const local = {
    threads, log, ids,
    workspace: { workspace: worktree, repo: repository },
    agents: new UnstaffedAgents(), services: new UnstaffedServices(), tools: new InMemoryToolRegistry([]),
    ledger: { forThread: async () => [], forThreadTree: async () => ({ own: [], delegated: [] }), record: async () => undefined },
  }
  return { directory, repository, home, worktree, threadId, placement, local }
}

export const MODEL_STUB = `const server = Bun.serve({port:3001,hostname:'127.0.0.1',async fetch(request){
const body=await request.json();const tools=body.tools??[];const bash=tools.find(tool=>tool.function?.name==='bash');
const hasTool=body.messages.some(message=>message.role==='tool');const shouldCall=bash&&!hasTool;
const delta=shouldCall?{role:'assistant',tool_calls:[{index:0,id:'probe-call',type:'function',function:{name:'bash',arguments:JSON.stringify({command:'pwd; git status --porcelain',description:'Verify live sandbox worktree execution'})}}]}:{role:'assistant',content:'Live workspace probe completed.'};
const chunk={id:'probe-response',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason:null}]};
const finish={...chunk,choices:[{index:0,delta:{},finish_reason:shouldCall?'tool_calls':'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}};
return new Response('data: '+JSON.stringify(chunk)+'\\n\\ndata: '+JSON.stringify(finish)+'\\n\\ndata: [DONE]\\n\\n',{headers:{'content-type':'text/event-stream'}});
}});console.log('MODEL_STUB_READY');` 
