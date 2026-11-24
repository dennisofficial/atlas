import {
  choiceValueOf,
  DECISIONS_PRESETS,
  DEFAULT_DECISIONS_MODEL,
  DEFAULT_DECISIONS_PROVIDER,
  EDecisionsProvider,
  EExecutionLocation,
  ESettingId,
  ESettingKind,
  ESettingPage,
  type SettingDefinition,
  type SettingsResolution,
} from '@dltech/atlas-core'

export const DEFAULT_CONTAINER_IDLE_MINUTES = 30

const onCustomDecisions = (args: { resolution: SettingsResolution }): boolean =>
  choiceValueOf({
    resolution: args.resolution,
    id: ESettingId.DecisionsProvider,
    fallback: DEFAULT_DECISIONS_PROVIDER,
  }) === EDecisionsProvider.Custom

/**
 * The rows only v1 reads. v2, the web app and the new TUI never show them; the v1 deletion
 * (`packages/harness`) takes this list with it.
 */
export const V1_ONLY_SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  {
    id: ESettingId.TldrFooter,
    page: ESettingPage.General,
    group: 'Transcript',
    label: 'tl;dr footer',
    description:
      'When a turn ends, a second, cheaper model writes a one-to-two-line summary of it — from your last message to the end — and the transcript shows it as a tl;dr divider under the answer. The summary is for you alone: the agent never reads it. Turning this off stops new footers being written; ones already on the log stay.',
    environmentVariable: 'ATLAS_TLDR_FOOTER',
    kind: ESettingKind.Toggle,
    fallback: true,
  },
  {
    id: ESettingId.Editor,
    page: ESettingPage.General,
    group: 'Transcript',
    label: 'Editor',
    description:
      'Which editor a clicked file path in the transcript opens in. Default hands the path to the operating system\u2019s own handler, as if you had double-clicked it.',
    environmentVariable: 'ATLAS_EDITOR',
    kind: ESettingKind.Choice,
    fallback: 'default',
    options: [
      { value: 'default', label: 'default', detail: 'shipped' },
      { value: 'cursor', label: 'cursor' },
      { value: 'code', label: 'code' },
      { value: 'zed', label: 'zed' },
      { value: 'warp', label: 'warp' },
    ],
  },
  {
    id: ESettingId.ProjectInstructions,
    page: ESettingPage.General,
    group: 'Project context',
    label: 'Project instructions',
    description:
      'Load the instruction files a repository carries for its agents, walking the workspace root down to the working directory so that a deeper file overrides a shallower one.',
    environmentVariable: 'ATLAS_PROJECT_INSTRUCTIONS',
    kind: ESettingKind.Toggle,
    fallback: true,
  },
  {
    id: ESettingId.UserInstructions,
    page: ESettingPage.General,
    group: 'Project context',
    label: 'Personal instructions',
    description:
      'Also load ATLAS.md from your Atlas home directory, which applies to every project. It is read before the repository, so anything the repository says wins.',
    environmentVariable: 'ATLAS_USER_INSTRUCTIONS',
    kind: ESettingKind.Toggle,
    fallback: true,
  },
  {
    id: ESettingId.InstructionFilenames,
    page: ESettingPage.General,
    group: 'Project context',
    label: 'Borrowed instruction files',
    description:
      'Which instruction files borrowed from another harness a repository is read for. ATLAS.md is always read and is loaded last, so it wins a disagreement with either borrowed file; AGENTS.md is the cross-vendor convention and CLAUDE.md the Claude-specific one, and when both are read CLAUDE.md is loaded second. A .local.md sibling of any of the three is read after all of them and is never checked in.',
    environmentVariable: 'ATLAS_INSTRUCTION_FILENAMES',
    kind: ESettingKind.Choice,
    fallback: 'both',
    options: [
      { value: 'both', label: 'AGENTS.md + CLAUDE.md', detail: 'shipped' },
      { value: 'claude', label: 'CLAUDE.md' },
      { value: 'agents', label: 'AGENTS.md' },
      { value: 'none', label: 'neither', detail: 'ATLAS.md only' },
    ],
  },
  {
    id: ESettingId.ReloadInstructions,
    page: ESettingPage.General,
    group: 'Project context',
    label: 'Reload on change',
    description:
      'Re-read the instruction files at every turn, so editing one takes effect in the thread you are already in. Unchanged files cost nothing; a changed one is appended again and supersedes what the model was reading. Turning this off freezes the instructions as they were when the thread opened.',
    environmentVariable: 'ATLAS_RELOAD_INSTRUCTIONS',
    kind: ESettingKind.Toggle,
    fallback: true,
  },
  {
    id: ESettingId.TrustedRepos,
    page: ESettingPage.General,
    group: 'Plugins',
    label: 'Trusted repositories',
    description:
      'Repositories whose .atlas/plugins may run, comma separated, written as host/owner/repo, for example github.com/acme/widget. A repository without a remote is trusted by its absolute path. Stored in your own settings, never in a repository, and read when a session starts.',
    kind: ESettingKind.Text,
    fallback: '',
  },
  {
    id: ESettingId.AutoCompact,
    page: ESettingPage.General,
    group: 'Context window',
    label: 'Compact automatically at',
    description:
      'How full the context window may get before Atlas summarises the older turns without being asked. It checks when a turn ends, so a turn is never interrupted to do it, and it compacts mid-turn only when a step would otherwise overflow the window outright. Set to zero to compact only when you ask with /compact.',
    environmentVariable: 'ATLAS_AUTO_COMPACT',
    kind: ESettingKind.Range,
    fallback: 90,
    minimum: 0,
    maximum: 100,
    step: 5,
    unit: '%',
  },
  {
    id: ESettingId.DecisionsProvider,
    page: ESettingPage.Models,
    group: 'Decisions',
    label: 'Decision provider',
    description:
      'Who answers typed decisions — the System-1 questions behind the tool-call classifier, skill suggestion and the code-quality review, each judged by calibrated probability instead of a generative model reading a brief. A preset pins the endpoint and model; custom lets you point at your own. Without a key for the chosen provider, the classifier judge stays the generative one and skill suggestion stays off.',
    environmentVariable: 'ATLAS_DECISIONS_PROVIDER',
    kind: ESettingKind.Choice,
    fallback: DEFAULT_DECISIONS_PROVIDER,
    options: [
      {
        value: EDecisionsProvider.Typesafe,
        label: 'typesafe',
        detail: 'Typesafe AI',
        note: `Hosted Jev at ${DECISIONS_PRESETS[EDecisionsProvider.Typesafe].url}, speaking the Jev /v1/systemone protocol on ${DECISIONS_PRESETS[EDecisionsProvider.Typesafe].model}. Takes the key from your Jev account.`,
      },
      {
        value: EDecisionsProvider.Vercel,
        label: 'vercel',
        detail: 'Vercel AI Gateway',
        note: `Jev through the Vercel AI Gateway at ${DECISIONS_PRESETS[EDecisionsProvider.Vercel].url}, speaking the Jev /v1/systemone protocol on ${DECISIONS_PRESETS[EDecisionsProvider.Vercel].model}. Takes an AI Gateway key.`,
      },
      {
        value: EDecisionsProvider.OpenAi,
        label: 'openai',
        detail: 'OpenAI Decisions API',
        note: `OpenAI's Decisions API at ${DECISIONS_PRESETS[EDecisionsProvider.OpenAi].url} on ${DECISIONS_PRESETS[EDecisionsProvider.OpenAi].model}. Takes an OpenAI API key.`,
      },
      {
        value: EDecisionsProvider.Custom,
        label: 'custom',
        detail: 'your own endpoint',
        note: 'An endpoint and model you name below, speaking the Jev /v1/systemone protocol — hosted Jev, a gateway route, or a self-hosted Laya server.',
      },
    ],
  },
  {
    id: ESettingId.DecisionsUrl,
    page: ESettingPage.Models,
    group: 'Decisions',
    label: 'Decision endpoint',
    description:
      'Where a custom provider answers — the origin of hosted Jev (https://api.typesafe.ai), a gateway route, or a Laya server of your own, with or without the /v1/systemone route. It speaks the Jev /v1/systemone protocol. Left empty, nothing is configured and the judge stays the generative one.',
    environmentVariable: 'ATLAS_DECISIONS_URL',
    kind: ESettingKind.Text,
    fallback: '',
    visibleWhen: onCustomDecisions,
  },
  {
    id: ESettingId.DecisionsModel,
    page: ESettingPage.Models,
    group: 'Decisions',
    label: 'Decision model',
    description:
      'The model a custom endpoint is asked for. A preset pins its own model, so this row only appears for a custom provider.',
    environmentVariable: 'ATLAS_DECISIONS_MODEL',
    kind: ESettingKind.Text,
    fallback: DEFAULT_DECISIONS_MODEL,
    visibleWhen: onCustomDecisions,
  },
  {
    id: ESettingId.ExecutionLocation,
    page: ESettingPage.General,
    group: 'Execution',
    label: 'Where sessions run',
    description:
      'Where a session that has not been given a location of its own executes its tools. Every session remembers the location it was last switched to, so this is only what a new one begins with — /container writes the session, and --execution-location outranks this row for one launch.',
    environmentVariable: 'ATLAS_EXECUTION_LOCATION',
    kind: ESettingKind.Choice,
    fallback: EExecutionLocation.Host,
    options: [
      { value: EExecutionLocation.Host, label: 'host', detail: 'shipped' },
      { value: EExecutionLocation.Docker, label: 'docker' },
    ],
  },
  {
    id: ESettingId.ContainerCpus,
    page: ESettingPage.General,
    group: 'Execution',
    label: 'Container CPUs',
    description:
      'How many cores each sandboxed session may use, as a ceiling the daemon enforces rather than a reservation. Every container gets this many, so a machine running several sandboxes at once can be oversubscribed — Atlas warns when the running total outruns the machine rather than pretending the limit is a guarantee. Set to zero for no ceiling at all, and the container shares the daemon like any other workload on it.',
    environmentVariable: 'ATLAS_CONTAINER_CPUS',
    kind: ESettingKind.Range,
    fallback: 4,
    minimum: 0,
    maximum: 32,
    step: 1,
    unit: ' cpus',
    zeroLabel: 'no limit',
  },
  {
    id: ESettingId.ContainerMemory,
    page: ESettingPage.General,
    group: 'Execution',
    label: 'Container memory',
    description:
      'How much memory each sandboxed session may use, in gigabytes, as a hard ceiling — a container that crosses it is killed by the daemon, which looks like a stack dying for no reason. Every container gets this much, and stopped containers keep their disk but hold no memory, so the number only competes with the sandboxes actually running. Set to zero for no ceiling — a runaway process can then take the whole daemon down, other sandboxes included.',
    environmentVariable: 'ATLAS_CONTAINER_MEMORY',
    kind: ESettingKind.Range,
    fallback: 8,
    minimum: 0,
    maximum: 128,
    step: 1,
    unit: ' GB',
    zeroLabel: 'no limit',
  },
  {
    id: ESettingId.ContainerIdleMinutes,
    page: ESettingPage.General,
    group: 'Execution',
    label: 'Stop an idle container after',
    description:
      'How many minutes a sandboxed session may go without a bash call before Atlas stops its container. Stopping keeps the container\u2019s disk — the installed dependencies and build caches — so the next session brings it back in about a second, and a background shell that is still running always holds the stop off, so a dev server is never taken down by this.',
    environmentVariable: 'ATLAS_CONTAINER_IDLE_MINUTES',
    kind: ESettingKind.Range,
    fallback: DEFAULT_CONTAINER_IDLE_MINUTES,
    minimum: 5,
    maximum: 240,
    step: 5,
    unit: ' min',
  },
]
