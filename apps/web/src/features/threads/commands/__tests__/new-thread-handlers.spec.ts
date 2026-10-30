import { describe, expect, it } from 'bun:test'

import {
  ECommandGroup,
  ECommandKind,
  NOT_IN_THE_CLOUD,
  NOTHING_SAID_YET,
  NOTHING_TO_ROTATE,
  surfaceCommands,
  type CommandSpec,
} from '@dltech/atlas-core'

import { dispatchSubmission, EDispatch } from '../dispatch'
import { NO_SHELLS_YET, newThreadCommandHandlers } from '../new-thread-command-handlers'
import { mergeSkillSpecs } from '../skill-specs'
import { NOTHING_TO_COMPACT } from '../web-command-handlers'

const rig = () => {
  const log = { model: 0, search: 0, cleared: 0, navigated: [] as string[] }
  const handlers = newThreadCommandHandlers({
    openModelPicker: () => void (log.model += 1),
    openSearch: () => void (log.search += 1),
    navigate: (href) => void log.navigated.push(href),
    clearDraft: () => void (log.cleared += 1),
    reloadSkills: async () => 2,
  })
  const commands = surfaceCommands({ handlers })
  const skill: CommandSpec = {
    name: 'review',
    kind: ECommandKind.Skill,
    summary: 'review',
    group: ECommandGroup.Workspace,
  }
  const run = (text: string) =>
    dispatchSubmission({ text, handlers, commands, skills: [skill], working: false })
  return { log, run }
}

describe('new thread command handlers', () => {
  it('runs compact and shells with notices', async () => {
    const { run } = rig()
    expect(await run('/compact')).toEqual({ type: EDispatch.Ran, notice: NOTHING_TO_COMPACT })
    expect(await run('/shells')).toEqual({ type: EDispatch.Ran, notice: NO_SHELLS_YET })
  })

  it('refuses rotate, rename and wake with core copy', async () => {
    const { run } = rig()
    expect(await run('/rotate')).toEqual({ type: EDispatch.Refused, reason: NOTHING_TO_ROTATE })
    expect(await run('/rename')).toEqual({ type: EDispatch.Refused, reason: NOTHING_SAID_YET })
    expect(await run('/wake')).toEqual({ type: EDispatch.Refused, reason: NOT_IN_THE_CLOUD })
  })

  it('opens the picker, search, settings and clears the draft', async () => {
    const { run, log } = rig()
    await run('/model')
    await run('/resume')
    await run('/settings')
    await run('/new')
    expect(log).toEqual({ model: 1, search: 1, cleared: 1, navigated: ['/settings'] })
  })

  it('reports the skill count', async () => {
    expect(await rig().run('/skills')).toEqual({ type: EDispatch.Ran, notice: '2 skills' })
  })

  it('refuses unsupported commands', async () => {
    for (const name of ['cd', 'container', 'help', 'auth', 'exit', 'restart', 'rewind']) {
      expect((await rig().run(`/${name}`)).type).toBe(EDispatch.Refused)
    }
  })

  it('sends skills and prose as normal text', async () => {
    const { run } = rig()
    expect((await run('/review this')).type).toBe(EDispatch.Send)
    expect((await run('hello')).type).toBe(EDispatch.Send)
  })

  it('lets the sandbox entry win when merging by name', () => {
    const spec = (name: string, summary: string): CommandSpec => ({
      name,
      kind: ECommandKind.Skill,
      summary,
      group: ECommandGroup.Workspace,
    })
    const merged = mergeSkillSpecs({
      catalogue: [spec('a', 'api'), spec('b', 'api')],
      sandbox: [spec('b', 'sandbox'), spec('c', 'sandbox')],
    })
    expect(merged.map((s) => `${s.name}:${s.summary}`)).toEqual(['a:api', 'b:sandbox', 'c:sandbox'])
  })
})
