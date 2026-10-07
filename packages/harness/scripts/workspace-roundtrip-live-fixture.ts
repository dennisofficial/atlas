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
import { EXITED_RETAINED_KEY, featureSpec, GITIGNORE, hostUnrelatedSpec, seedCheckout, teammateSpecs } from './workspace-roundtrip-live-family'
import { liveGit } from './workspace-roundtrip-live-git'
import { LIVE_MODEL, seedTeammates } from './workspace-roundtrip-live-threads'

export { liveGit }

export async function liveFixture() {
  const scratch = process.env['ATLAS_SESSION_DIR'] === undefined ? tmpdir() : join(process.env['ATLAS_SESSION_DIR'], 'scratch')
  await mkdir(scratch, { recursive: true })
  const directory = await realpath(await mkdtemp(join(scratch, 'atlas-workspace-live-')))
  const repository = join(directory, 'repository')
  const home = join(directory, 'home')
  await mkdir(repository)
  await mkdir(home)
  await liveGit({ cwd: repository, args: ['init', '-b', 'main'] })
  await liveGit({ cwd: repository, args: ['config', 'user.name', 'Atlas Live Probe'] })
  await liveGit({ cwd: repository, args: ['config', 'user.email', 'probe@example.invalid'] })
  await writeFile(join(repository, '.gitignore'), GITIGNORE)
  await writeFile(join(repository, 'file.txt'), 'base\n')
  await liveGit({ cwd: repository, args: ['add', '.'] })
  await liveGit({ cwd: repository, args: ['commit', '-m', 'base fixture'] })
  const feature = featureSpec(repository)
  const teammateCheckouts = teammateSpecs(repository)
  const hostUnrelated = hostUnrelatedSpec(repository)
  for (const spec of [feature, ...teammateCheckouts, hostUnrelated]) await seedCheckout({ repository, spec })
  const ids = new RandomIds()
  const clock = new SystemClock()
  await fileAccountStore({ file: join(home, 'auth.json'), keyFile: join(home, 'key'), clock }).add({
    provider: EAuthProvider.OpenRouter,
    origin: EAccountOrigin.Login,
    label: 'Local deterministic probe model',
    secret: { kind: EAuthKind.ApiKey, apiKey: 'probe-placeholder-key' },
  })
  await writeFile(join(home, 'settings.json'), JSON.stringify({
    'model.id': LIVE_MODEL.ref,
    'model.quickModel': LIVE_MODEL.ref,
    'model.compactionModel': LIVE_MODEL.ref,
    'classifier.mode': 'off',
  }))
  const registry = new SessionRegistry(home)
  const log = new JsonlEventLog(home, registry, clock, ids)
  const threads = new JsonlThreadStore(home, registry, clock, ids, log)
  const threadId = toThreadId(`brn_live_roundtrip_${crypto.randomUUID()}`)
  await threads.createWithFirstEvents({
    threadId, runId: ids.nextRunId(), workspace: feature.path, repo: repository,
    executionLocation: EExecutionLocation.Host,
    model: LIVE_MODEL,
    drafts: [{ type: 'user-said', text: 'Prepare a workspace round trip.' }],
  })
  const teammates = await seedTeammates({ threads, log, ids, rootId: threadId, repository, home: feature.path, specs: teammateCheckouts, exitedKey: EXITED_RETAINED_KEY })
  const placement = new PlacementController(EExecutionLocation.Host)
  placement.bind({ threads, workspace: feature.path, repo: repository })
  await placement.activate({ threadId })
  const local = {
    threads, log, ids,
    workspace: { workspace: feature.path, repo: repository },
    agents: new UnstaffedAgents(), services: new UnstaffedServices(), tools: new InMemoryToolRegistry([]),
    ledger: { forThread: async () => [], forThreadTree: async () => ({ own: [], delegated: [] }), record: async () => undefined },
  }
  const threadIds = [threadId, ...teammates.map((teammate) => teammate.threadId)]
  return { directory, repository, home, worktree: feature.path, feature, hostUnrelated, teammates, threadIds, threadId, placement, local }
}

export type LiveFixture = Awaited<ReturnType<typeof liveFixture>>

export const MODEL_STUB = `const server = Bun.serve({port:3001,hostname:'127.0.0.1',async fetch(request){
const body=await request.json();const tools=body.tools??[];const bash=tools.find(tool=>tool.function?.name==='bash');
const hasTool=body.messages.some(message=>message.role==='tool');const shouldCall=bash&&!hasTool;
const delta=shouldCall?{role:'assistant',tool_calls:[{index:0,id:'probe-call',type:'function',function:{name:'bash',arguments:JSON.stringify({command:'pwd; git status --porcelain',description:'Verify live sandbox worktree execution'})}}]}:{role:'assistant',content:'Live workspace probe completed.'};
const chunk={id:'probe-response',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason:null}]};
const finish={...chunk,choices:[{index:0,delta:{},finish_reason:shouldCall?'tool_calls':'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}};
return new Response('data: '+JSON.stringify(chunk)+'\\n\\ndata: '+JSON.stringify(finish)+'\\n\\ndata: [DONE]\\n\\n',{headers:{'content-type':'text/event-stream'}});
}});console.log('MODEL_STUB_READY');` 
