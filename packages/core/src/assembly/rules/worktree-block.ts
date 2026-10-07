import { wrapInSystemReminder } from '../../context/render'
import { EExecutionLocation } from '../../execution/location'
import {
  activeWorktreeOf,
  currentLocationOf,
  homeDirectoryOf,
  repoOf,
  type ActiveWorktree,
} from '../../workspace/worktree'
import { defineRule, type Rule } from '../rule'
import { appendedAtTail } from './tail-block'

const branchLineOf = (worktree: ActiveWorktree): string => {
  if (!worktree.adopted) {
    return `on branch ${worktree.branch}, branched from ${worktree.base ?? 'the default branch'}.`
  }
  const upstream =
    worktree.base === undefined ? 'which has no upstream' : `which tracks ${worktree.base}`
  return `on branch ${worktree.branch}, ${upstream}. It already existed before this session and Atlas did not create it.`
}

const leavingLineOf = (worktree: ActiveWorktree): string =>
  worktree.adopted
    ? "exit_worktree returns the session to the repository's main checkout and leaves this worktree exactly where it is; it will not remove a worktree Atlas did not create."
    : "exit_worktree returns the session to the repository's main checkout, keeping or removing this worktree as the developer asks."

const RESOLUTION_LINE = 'Paths you pass to a tool resolve against it and a bash command starts there.'

const CLOUD_LOCATION_LINE =
  "Execution location: a cloud sandbox with full isolation — this filesystem, /tmp, and localhost belong to the sandbox; the operator's machine cannot see any of it. Hand files over through the conversation or an exposed port."

const DOCKER_LOCATION_LINE =
  'Execution location: a Docker container on the operator\'s machine — only the project directory and explicitly mounted paths are shared with the host; everything else you write, /tmp included, stays inside the container.'

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
    `The repository's main checkout is at ${args.mainCheckout}; it stays unchanged unless the developer asks for changes there, and you reach it only with absolute paths.`,
    leavingLineOf(worktree),
    locationLine,
  ]
    .filter((line) => line !== undefined)
    .join(' ')
}

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
      const lastMessage = input.messages.at(-1)
      const lastEvent = ctx.events.at(-1)
      if (lastMessage?.message.role === 'assistant' && lastMessage.origin.eventId === lastEvent?.id) return input

      const home = homeDirectoryOf({ events: ctx.events, launchDirectory })
      const worktree = activeWorktreeOf(ctx.events)
      const mainCheckout = repoOf({ events: ctx.events, launchRepo: repoRoot ?? null }) ?? home
      const location = currentLocationOf(ctx.events)
      const note = projectDirectoryNote({ directory: home, worktree, mainCheckout, location })

      return appendedAtTail({ input, ctx, text: wrapInSystemReminder(note) })
    },
  })
}
