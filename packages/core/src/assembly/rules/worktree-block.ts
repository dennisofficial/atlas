import { systemContext } from '../../context/envelope'
import type { Event } from '../../events/envelope'
import { EExecutionLocation } from '../../execution/location'
import {
  activeWorktreeOf,
  currentLocationOf,
  homeDirectoryOf,
  repoOf,
  type ActiveWorktree,
} from '../../workspace/worktree'
import type { Assembled, AssembledMessage } from '../assembled'
import { defineRule, type Rule } from '../rule'

const branchLineOf = (worktree: ActiveWorktree): string => {
  if (!worktree.adopted) {
    return `on branch ${worktree.branch}, branched from ${worktree.base ?? 'the default branch'}.`
  }
  const upstream =
    worktree.base === undefined ? 'which has no upstream' : `which tracks ${worktree.base}`
  return `on branch ${worktree.branch}, ${upstream}. It already existed before this session and the Atlas harness did not create it.`
}

const leavingLineOf = (worktree: ActiveWorktree): string =>
  worktree.adopted
    ? "exit_worktree returns the session to the repository's main checkout and leaves this worktree exactly where it is. It will not remove a worktree the Atlas harness did not create."
    : "exit_worktree returns the session to the repository's main checkout, keeping or removing this worktree as the operator asks."

const RESOLUTION_LINE =
  'Paths you pass to a tool resolve against it and a bash command starts there.'

const CLOUD_LOCATION_LINE =
  "Execution location: a cloud sandbox with full isolation — this filesystem, /tmp, and localhost belong to the sandbox. The operator's machine cannot see any of it. Hand files over through the thread or an exposed port."

const DOCKER_LOCATION_LINE =
  "Execution location: a Docker sandbox on the operator's machine — only the project directory and explicitly mounted paths are shared with the operator's machine. Everything else you write, /tmp included, stays inside the sandbox."

const locationLineOf = (location: EExecutionLocation): string | undefined => {
  if (location === EExecutionLocation.Cloud) return CLOUD_LOCATION_LINE
  if (location === EExecutionLocation.Docker) return DOCKER_LOCATION_LINE
  return undefined
}

export function projectDirectoryNote(args: {
  directory: string
  worktree?: ActiveWorktree | undefined
  mainCheckout: string
  location?: EExecutionLocation | undefined
}): string {
  const { worktree } = args
  const locationLine = locationLineOf(args.location ?? EExecutionLocation.Host)
  if (worktree === undefined) {
    return [`Project directory: ${args.directory}. ${RESOLUTION_LINE}`, locationLine]
      .filter((line) => line !== undefined)
      .join(' ')
  }

  return [
    `Project directory: ${worktree.path}, a git worktree ${branchLineOf(worktree)}`,
    RESOLUTION_LINE,
    `The repository's main checkout is at ${args.mainCheckout}. It stays unchanged unless the operator asks for changes there. You reach it only with absolute paths.`,
    leavingLineOf(worktree),
    locationLine,
  ]
    .filter((line) => line !== undefined)
    .join(' ')
}

const movesTheWorkspace = (event: Event): boolean =>
  event.type === 'worktree-entered' ||
  event.type === 'worktree-exited' ||
  event.type === 'directory-changed' ||
  event.type === 'location-changed'

const anchoredAfter = (args: { messages: Assembled['messages']; anchor: Event }): number =>
  args.messages.findLastIndex((entry) => entry.origin.seq <= args.anchor.seq) + 1

export function worktreeBlock({
  launchDirectory,
  repoRoot,
}: {
  launchDirectory: string
  repoRoot?: string | undefined
}): Rule {
  return defineRule({
    name: 'worktreeBlock',
    apply: (input, ctx) => {
      const first = ctx.events[0]
      if (first === undefined) return input

      const home = homeDirectoryOf({ events: ctx.events, launchDirectory })
      const worktree = activeWorktreeOf(ctx.events)
      const mainCheckout = repoOf({ events: ctx.events, launchRepo: repoRoot ?? null }) ?? home
      const location = currentLocationOf(ctx.events)
      const note = systemContext({
        slot: 'workspace',
        key: 'directory',
        content: projectDirectoryNote({ directory: home, worktree, mainCheckout, location }),
      })

      const anchor = ctx.events.findLast(movesTheWorkspace)
      const at = anchor === undefined ? 0 : anchoredAfter({ messages: input.messages, anchor })
      const message: AssembledMessage = {
        message: { role: 'user', content: [{ type: 'text', text: note }] },
        origin: { eventId: (anchor ?? first).id, seq: (anchor ?? first).seq },
      }

      return {
        system: input.system,
        messages: [...input.messages.slice(0, at), message, ...input.messages.slice(at)],
      }
    },
  })
}
