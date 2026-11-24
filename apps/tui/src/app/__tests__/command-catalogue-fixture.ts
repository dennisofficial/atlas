import {
  EClientAction,
  ECommandEntryKind,
  ECommandGroup,
  ECommandSource,
  type CommandEntry,
} from '@dltech/atlas-commands'

import type { SkillCatalogueReply } from '../session-api'

const command = (args: {
  name: string
  summary: string
  group: ECommandGroup
  argumentHint?: string
  opens?: EClientAction
}): CommandEntry => ({
  name: args.name,
  summary: args.summary,
  group: args.group,
  ...(args.argumentHint === undefined ? {} : { argumentHint: args.argumentHint }),
  ...(args.opens === undefined ? {} : { opens: args.opens }),
  kind: ECommandEntryKind.Command,
  source: ECommandSource.Builtin,
})

export const PRODUCTION_COMMANDS: readonly CommandEntry[] = [
  command({
    name: 'rewind',
    summary: 'rewind the conversation to one of your messages',
    group: ECommandGroup.Context,
    argumentHint: '<message>',
  }),
  command({
    name: 'rotate',
    summary: 'replace the sandbox with a fresh one',
    group: ECommandGroup.Context,
    argumentHint: '[instructions]',
  }),
  command({
    name: 'summarise',
    summary: 'summarise the conversation so far',
    group: ECommandGroup.Context,
    argumentHint: '[message]',
  }),
  command({
    name: 'agent',
    summary: 'message or stop a sub-agent',
    group: ECommandGroup.Session,
    argumentHint: '<say|stop> <id> [text]',
  }),
  command({
    name: 'cancel-resize',
    summary: 'cancel a pending resize',
    group: ECommandGroup.Session,
  }),
  command({
    name: 'help',
    summary: 'every key and command',
    group: ECommandGroup.Session,
    opens: EClientAction.CommandList,
  }),
  command({
    name: 'model',
    summary: 'pick the model this session runs',
    group: ECommandGroup.Session,
    opens: EClientAction.ModelPicker,
  }),
  command({
    name: 'rename',
    summary: 'name this session',
    group: ECommandGroup.Session,
    argumentHint: '<name>',
  }),
  command({
    name: 'resize',
    summary: 'give the sandbox more room',
    group: ECommandGroup.Session,
    argumentHint: '<vcpus> <memoryGb> [diskGb] [--idle]',
  }),
  command({
    name: 'resume',
    summary: 'pick a stopped turn back up',
    group: ECommandGroup.Session,
    argumentHint: '[--agent <id>]',
  }),
  command({
    name: 'service',
    summary: 'stop or restart a service',
    group: ECommandGroup.Session,
    argumentHint: '<stop|restart> <id>',
  }),
  command({
    name: 'shell-kill',
    summary: 'kill a background shell',
    group: ECommandGroup.Session,
    argumentHint: '<id>',
  }),
  command({
    name: 'mcp',
    summary: "the session's MCP servers, and sign in to one",
    group: ECommandGroup.Workspace,
    opens: EClientAction.Mcp,
  }),
  command({
    name: 'shells',
    summary: 'the background shells',
    group: ECommandGroup.Workspace,
    opens: EClientAction.Shells,
  }),
  command({
    name: 'skills',
    summary: 'list the skills this session can run',
    group: ECommandGroup.Workspace,
    opens: EClientAction.Skills,
  }),
]

export const PRODUCTION_SKILLS: SkillCatalogueReply['skills'] = [
  {
    name: 'atlas',
    summary:
      'Handbook to the Atlas harness: skills and agent types under .agents, MCP servers, worktrees and sandboxes.',
    argumentHint: 'what to do',
  },
  { name: 'commit', summary: 'stage the current work and write a commit message' },
]

export const withoutOpens = (entries: readonly CommandEntry[]): readonly CommandEntry[] =>
  entries.map((entry) => {
    const { opens: _opens, ...rest } = entry
    return rest
  })
