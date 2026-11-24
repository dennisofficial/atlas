import { EFFORT_LADDER, EEffort } from '../models/effort-ladder'
import {
  PR_EDIT_MUTED_AUTHORS_FALLBACK,
  PR_EDIT_URGENT_AUTHORS_FALLBACK,
} from '../github/pr-edit-policy'
import { EClassifierMode } from '../policy/classifier/triage'
import { EWebSearchBackend } from '../web/search'
import {
  ESettingPage,
  ESettingStorage,
  type SettingDefinition,
  type SettingPage,
} from './definition'
import { EFFORT_OPTIONS_WITH_INHERIT, INHERIT_EFFORT } from './effort-rows'
import { ESettingsLayer } from './layers'
import { EImageModelWire } from './cloud/setting-enums'
import { compactionRoleRows, quickRoleRows, subagentFastRow } from './model-role-rows'
import { ESettingKind, type SettingOption } from './value'

export const SETTING_PAGES: readonly SettingPage[] = [
  { id: ESettingPage.General, label: 'general' },
  { id: ESettingPage.Models, label: 'models' },
  { id: ESettingPage.Appearance, label: 'appearance' },
  { id: ESettingPage.Experimental, label: 'experimental' },
  { id: ESettingPage.Cloud, label: 'cloud' },
  { id: ESettingPage.CodeQuality, label: 'quality' },
]

export enum ESettingId {
  SidebarWidth = 'sidebar.width',
  ProjectInstructions = 'context.projectInstructions',
  UserInstructions = 'context.userInstructions',
  InstructionFilenames = 'context.filenames',
  ReloadInstructions = 'context.reload',
  TrustedRepos = 'plugins.trustedRepos',
  SkillSuggest = 'skills.suggest',
  AutoCompact = 'context.autoCompact',
  AutoRotate = 'context.autoRotate',
  ImageRows = 'transcript.imageRows',
  FenceWrap = 'transcript.fenceWrap',
  TldrFooter = 'tldr.footer',
  Editor = 'files.editor',
  WorktreeDirectory = 'worktree.directory',
  Accent = 'appearance.accent',
  BlockPadding = 'appearance.blockPadding',
  ComposerEdge = 'appearance.composerEdge',
  Logo = 'appearance.logo',
  ClassifierMode = 'classifier.mode',
  ClassifierModel = 'classifier.model',
  DecisionsProvider = 'decisions.provider',
  DecisionsUrl = 'decisions.url',
  DecisionsModel = 'decisions.model',
  DecisionsToken = 'decisions.token',
  WebSearchBackend = 'web.searchBackend',
  WebSearchKey = 'web.searchKey',
  ImageModel = 'images.model',
  ModelId = 'model.id',
  ModelEffort = 'model.effort',
  ModelFast = 'model.fast',
  QuickModel = 'model.quickModel',
  QuickEffort = 'model.quickEffort',
  QuickFast = 'model.quickFast',
  CompactionModel = 'model.compactionModel',
  CompactionEffort = 'model.compactionEffort',
  CompactionFast = 'model.compactionFast',
  ModelFavourites = 'model.favourites',
  SubagentModel = 'agents.subagentModel',
  SubagentEffort = 'agents.subagentEffort',
  SubagentFast = 'agents.subagentFast',
  ExecutionLocation = 'execution.location',
  ContainerCpus = 'container.cpus',
  ContainerMemory = 'container.memory',
  ContainerIdleMinutes = 'container.idleMinutes',
  SandboxImage = 'sandbox.image',
  SandboxVcpus = 'sandbox.vcpus',
  SandboxDiskGb = 'sandbox.diskGb',
  CloudUrl = 'cloud.url',
  GrillingCeremony = 'experimental.grillingCeremony',
  PrVerdictTiming = 'github.prEvents.verdictTiming',
  PrEditMutedAuthors = 'github.prEvents.editMutedAuthors',
  PrEditUrgentAuthors = 'github.prEvents.editUrgentAuthors',
  QualityEnabled = 'quality.enabled',
  QualityRecordExamples = 'quality.recordExamples',
}

export const DEFAULT_WORKTREE_DIRECTORY = '.atlas/worktrees'

export const DEFAULT_EFFORT = EEffort.Medium

export const EFFORT_OPTIONS: readonly SettingOption[] = EFFORT_LADDER.map((effort) => ({
  value: effort,
  label: effort,
}))

export const ATLAS_SETTINGS: readonly SettingDefinition[] = [
  {
    id: ESettingId.ImageRows,
    storage: ESettingStorage.Local,
    page: ESettingPage.General,
    group: 'Transcript',
    label: 'Tallest image',
    description:
      'How many rows a picture in the transcript may fill. In a terminal that draws real pixels this is the resolution knob, not just the size one — the image is transmitted at the pixel size of the cell box it is given, so a taller box is a sharper picture. Tall images push the text around them further apart, which is the trade.',
    environmentVariable: 'ATLAS_IMAGE_ROWS',
    kind: ESettingKind.Range,
    fallback: 30,
    minimum: 8,
    maximum: 80,
    step: 2,
    unit: ' rows',
  },
  {
    id: ESettingId.FenceWrap,
    storage: ESettingStorage.Local,
    page: ESettingPage.General,
    group: 'Transcript',
    label: 'Soft-wrap fences',
    description:
      'What a fenced block does with a line that runs past the panel. Never gives every fence a sideways pan on alt+wheel, keeping each line whole. Text wraps the fences that hold prose — markdown, plain text and shell commands, the shape a quoted answer or a long one-liner takes — and leaves code alone, because a wrapped line of code reads as two lines that were never written. All wraps every fence, code included.',
    environmentVariable: 'ATLAS_FENCE_WRAP',
    kind: ESettingKind.Choice,
    fallback: 'text',
    options: [
      { value: 'text', label: 'text', detail: 'shipped' },
      { value: 'never', label: 'never', detail: 'pan instead' },
      { value: 'all', label: 'all', detail: 'code too' },
    ],
  },
  {
    id: ESettingId.SidebarWidth,
    storage: ESettingStorage.Local,
    page: ESettingPage.General,
    group: 'Layout',
    label: 'Sidebar width',
    description:
      'How many columns every side pane takes: the transcript sidebar, the model picker, and the explanation beside these settings.',
    environmentVariable: 'ATLAS_SIDEBAR_WIDTH',
    kind: ESettingKind.Range,
    fallback: 42,
    minimum: 30,
    maximum: 64,
    step: 2,
    unit: ' cols',
  },
  {
    id: ESettingId.SkillSuggest,
    page: ESettingPage.General,
    group: 'Skills',
    label: 'Suggest a skill per turn',
    description:
      'Before each turn, the classifier from the Classifier settings page reads the last three messages and replies of the thread, asks one yes/no question per likely skill, and names at most one to the agent with its score, as a hint it is free to ignore. It stays quiet when nothing scores high enough or two skills are too close. Off whenever the classifier is off: no request is made and turns cost nothing extra.',
    environmentVariable: 'ATLAS_SKILL_SUGGEST',
    kind: ESettingKind.Toggle,
    fallback: true,
  },
  {
    id: ESettingId.AutoRotate,
    page: ESettingPage.General,
    group: 'Context window',
    label: 'Rotate the context automatically at',
    description:
      'How full the context window may get before Atlas rotates the thread by itself: one model call writes a handoff brief, a marker goes into the transcript, and the next turn starts from the brief. It checks when a turn ends, so a turn is never interrupted. Set to zero to rotate only when you ask with /rotate. Rotation is the v2 safety net; a summary of the old turns is the manual /summarise.',
    environmentVariable: 'ATLAS_AUTO_ROTATE',
    kind: ESettingKind.Range,
    fallback: 85,
    minimum: 0,
    maximum: 100,
    step: 5,
    unit: '%',
  },
  {
    id: ESettingId.WorktreeDirectory,
    page: ESettingPage.General,
    group: 'Worktrees',
    label: 'Where worktrees go',
    description:
      'Which of the two supported directories, relative to the repository root, enter_worktree creates a worktree in: .atlas/worktrees or .worktrees. Atlas writes a .gitignore of its own inside it, so the checkouts never show up as untracked files however the repository is configured.',
    environmentVariable: 'ATLAS_WORKTREE_DIRECTORY',
    kind: ESettingKind.Choice,
    fallback: DEFAULT_WORKTREE_DIRECTORY,
    options: [
      { value: DEFAULT_WORKTREE_DIRECTORY, label: DEFAULT_WORKTREE_DIRECTORY, detail: 'shipped' },
      { value: '.worktrees', label: '.worktrees' },
    ],
  },
  {
    id: ESettingId.ClassifierMode,
    page: ESettingPage.General,
    group: 'Nudges',
    label: 'Nudge before damage',
    description:
      'Whether a second, cheaper model looks at a call that trips one of the deterministic probes — an irreversible removal, a reach outside the project, a write into a worktree another agent is holding — and decides whether interrupting you is warranted. Shadow watches and records without ever pausing anything, which is how the pause rate gets measured before it is trusted; nudge lets it ask.',
    environmentVariable: 'ATLAS_CLASSIFIER_MODE',
    kind: ESettingKind.Choice,
    fallback: EClassifierMode.Shadow,
    options: [
      {
        value: EClassifierMode.Off,
        label: 'off',
        detail: 'no classification',
        note: 'Nothing is derived and nothing is recorded. The call goes to the tool exactly as it would have without this feature.',
      },
      {
        value: EClassifierMode.Shadow,
        label: 'shadow',
        detail: 'watches only',
        note: 'The whole pipeline runs and writes a row saying what it would have done, and every call still runs. This is where the rate of would-be interruptions becomes a number rather than a fear.',
      },
      {
        value: EClassifierMode.Nudge,
        label: 'nudge',
        detail: 'may ask',
        note: 'The same pipeline, except that a call the judge says it cannot let pass unseen stops and asks you. Only a model that can name what would be lost is allowed to interrupt.',
      },
    ],
  },
  {
    id: ESettingId.WebSearchBackend,
    page: ESettingPage.General,
    group: 'Web',
    label: 'Search backend',
    description:
      'Which search service web_search asks. Every one of them is somebody else\u2019s, so Atlas picks none for you: Bing answers with no account at all and is the fallback, and the rest are better in exchange for a key you get yourself. The ones that return the text of each page rather than a one-line snippet are worth the setup, because a result carrying its own text saves the model a fetch per link.',
    environmentVariable: 'ATLAS_SEARCH_BACKEND',
    kind: ESettingKind.Choice,
    fallback: EWebSearchBackend.Bing,
    options: [
      {
        value: EWebSearchBackend.Bing,
        label: 'Bing',
        detail: 'no key',
        note: 'Nothing to set up, and nothing to sign up for. Returns a title and a snippet per result, so reading anything means a web_fetch after it. It throttles a burst of queries from one address, so a long research turn may meet a challenge page.',
      },
      {
        value: EWebSearchBackend.DuckDuckGo,
        label: 'DuckDuckGo',
        detail: 'no key',
        note: 'Nothing to set up either, but it now answers an automated search with a throttle more often than with results, which is why it is no longer the fallback. Kept for the case where its own address does answer.',
      },
      {
        value: EWebSearchBackend.Jina,
        label: 'Jina',
        detail: 'key needed',
        note: 'Returns the extracted text of each page, not just a snippet. Its free key allows 500 searches a minute; an anonymous search is refused now, so the key is not optional.',
      },
      {
        value: EWebSearchBackend.Tavily,
        label: 'Tavily',
        detail: 'key needed',
        note: 'Built for agents rather than for people: results come back with the full page text already extracted. A thousand searches a month are free and no card is asked for.',
      },
      {
        value: EWebSearchBackend.Exa,
        label: 'Exa',
        detail: 'key needed',
        note: 'Embedding-based search that reads queries written as sentences rather than as keywords, and returns page text with each result. Generous free tier, no card.',
      },
      {
        value: EWebSearchBackend.Brave,
        label: 'Brave',
        detail: 'key needed',
        note: 'An index of its own rather than a wrapper over somebody else\u2019s, with clean, fast results. Every key starts with $5 of free calls a month, about a thousand searches, and results also carry the page text for the top hits, which saves the fetch that a snippet-only backend costs.',
      },
      {
        value: EWebSearchBackend.SearXNG,
        label: 'SearXNG',
        detail: 'instance url',
        note: 'Your own metasearch instance, so the queries leave no account behind. Set the row below to its address. Public instances almost always disable the JSON output this needs, so in practice this means one you run.',
      },
    ],
  },
  {
    id: ESettingId.WebSearchKey,
    page: ESettingPage.General,
    group: 'Web',
    label: 'Search key',
    description:
      'What the selected backend needs before it will answer \u2014 a key for most of them, an address for a SearXNG instance of your own. It belongs to whichever backend is chosen above, so switching backend shows the one that backend needs. Atlas never reads it from the environment and never writes it to a settings file: it is sealed in the secrets file beside the account vault, and only the last four characters are ever shown again.',
    kind: ESettingKind.Secret,
    fallback: '',
    masked: true,
  },
  {
    id: ESettingId.ImageModel,
    page: ESettingPage.General,
    group: 'Images',
    label: 'Image model',
    description:
      'The model image_generate uses when the agent names none. Only models that support Zero Data Retention are listed, because the gateway refuses the rest. Nano Banana 2 is fast and cheap, Nano Banana Pro draws the most detail, MAI Image 2.7 answers at full source resolution, and Grok Imagine 2.0 has a different look. Any model can still be named in a single call, and the agent does that to compare them.',
    environmentVariable: 'ATLAS_IMAGE_MODEL',
    kind: ESettingKind.Choice,
    fallback: EImageModelWire.Gemini31FlashImage,
    options: [
      {
        value: EImageModelWire.Gemini31FlashImage,
        label: 'Nano Banana 2',
        detail: 'fast',
        note: 'Google\u2019s fast image model, and the fallback: a picture in about ten seconds at a modest resolution, cheap enough to run a few times while comparing prompts.',
      },
      {
        value: EImageModelWire.Gemini3ProImage,
        label: 'Nano Banana Pro',
        detail: 'detailed',
        note: 'The same family with more of the prompt followed and more detail in the result. Slower, and each picture costs several times what the fast model does.',
      },
      {
        value: EImageModelWire.MaiImage27,
        label: 'MAI Image 2.7',
        note: 'Microsoft\u2019s image model, which answers at the full resolution of the source image, so an edit keeps the size of the picture it started from.',
      },
      {
        value: EImageModelWire.MaiImage27Flash,
        label: 'MAI Image 2.7 Flash',
        detail: 'fast',
        note: 'The faster MAI model. Cheaper per picture and quicker to answer, with less fidelity to small details in the source.',
      },
      {
        value: EImageModelWire.GrokImagineImage20,
        label: 'Grok Imagine 2.0',
        note: 'A different stylistic family, useful when the Google and Microsoft models keep giving the same look.',
      },
    ],
  },
  {
    id: ESettingId.Accent,
    page: ESettingPage.Appearance,
    storage: ESettingStorage.Local,
    group: 'Colour',
    label: 'Accent',
    description:
      'The one hue that carries the harness through the whole app: block marks, the composer rail, the caret and inline code.',
    environmentVariable: 'ATLAS_ACCENT',
    kind: ESettingKind.Choice,
    fallback: 'clay',
    options: [
      { value: 'clay', label: 'clay', detail: 'shipped' },
      { value: 'slate', label: 'slate' },
      { value: 'moss', label: 'moss' },
      { value: 'plum', label: 'plum' },
    ],
  },
  {
    id: ESettingId.BlockPadding,
    page: ESettingPage.Appearance,
    storage: ESettingStorage.Local,
    group: 'Density',
    label: 'Block padding',
    description:
      'How much room a banded slab spends on its own chrome: code fences, diffs and failed turns. Comfort opens the band on a half row of its own and seams it off the body below; compact starts on the header row and runs straight into the content.',
    environmentVariable: 'ATLAS_BLOCK_PADDING',
    kind: ESettingKind.Choice,
    fallback: 'comfort',
    options: [
      { value: 'comfort', label: 'comfort', detail: 'shipped' },
      { value: 'compact', label: 'compact' },
    ],
  },
  {
    id: ESettingId.ComposerEdge,
    page: ESettingPage.Appearance,
    storage: ESettingStorage.Local,
    group: 'Composer',
    label: 'Composer edge',
    description:
      'How the draft separates itself from the transcript above it. Slab gives the composer a darker ground of its own and opens it on a half row, marked down the left by the accent rail. Bordered drops that second ground and draws a thin accent frame on all four sides instead, with the session title set into the top edge. Claude keeps those two rules and drops the sides, leading the draft with a prompt caret at the margin.',
    environmentVariable: 'ATLAS_COMPOSER_EDGE',
    kind: ESettingKind.Choice,
    fallback: 'slab',
    options: [
      { value: 'slab', label: 'slab', detail: 'shipped' },
      { value: 'bordered', label: 'bordered' },
      { value: 'claude', label: 'claude' },
    ],
  },
  {
    id: ESettingId.Logo,
    page: ESettingPage.Appearance,
    storage: ESettingStorage.Local,
    group: 'Logo',
    label: 'Logo',
    description:
      'Which logo the home screen and the boot curtain draw. Wordmark is the mark beside the word atlas, and falls back to a one-line ⏺ atlas on a narrow terminal. Mark draws the Λ alone, smaller, and leaves the slot empty when the terminal is too narrow for it.',
    environmentVariable: 'ATLAS_LOGO',
    kind: ESettingKind.Choice,
    fallback: 'mark',
    options: [
      { value: 'mark', label: 'mark', detail: 'shipped' },
      { value: 'wordmark', label: 'wordmark' },
    ],
  },
  {
    id: ESettingId.ModelId,
    page: ESettingPage.Models,
    group: 'Model',
    label: 'Default model',
    description:
      'The model a session starts on when it has not been given one of its own. Every session remembers the model it was last switched to, so this is only what a new one begins with — which is why the switcher no longer writes it and this row does. --model outranks it for one launch.',
    environmentVariable: 'ATLAS_MODEL',
    kind: ESettingKind.Model,
    fallback: '',
    unsetLabel: 'automatic',
  },
  {
    id: ESettingId.ModelEffort,
    page: ESettingPage.Models,
    group: 'Model',
    label: 'Default effort',
    description:
      'How much thinking a model that takes a budget is given before it answers, for a session that has not been given an effort of its own. Choosing a default model beside this sets both at once; a model that offers no budget ignores it.',
    environmentVariable: 'ATLAS_EFFORT',
    kind: ESettingKind.Choice,
    fallback: DEFAULT_EFFORT,
    options: EFFORT_OPTIONS,
  },
  {
    id: ESettingId.ModelFast,
    page: ESettingPage.Models,
    group: 'Model',
    label: 'Fast mode',
    description:
      'Start new sessions in fast mode on models that offer it: Claude Opus 5.5 and Opus 5, and the Codex models whose plan lists a fast tier. The same model answers faster at a higher price — a Claude plan pays for it from usage credits at twice the API rate, a ChatGPT plan spends its included usage 2.5 times as fast. Each session can still switch it on or off beside its effort.',
    environmentVariable: 'ATLAS_FAST',
    kind: ESettingKind.Toggle,
    fallback: false,
  },
  {
    id: ESettingId.QuickModel,
    page: ESettingPage.Models,
    group: 'Background processes',
    label: 'Quick calls',
    description:
      'The model the quick background calls run on — tl;dr footers, session titles and the nudge judge — all of which pin a low effort and never read the session\u2019s own model. Left empty, they follow the default model. One choice serves them all: it is how you move the quick tier onto a cheaper model, or onto another provider when the usual one is having a bad day.',
    environmentVariable: 'ATLAS_QUICK_MODEL',
    kind: ESettingKind.Model,
    fallback: '',
    unsetLabel: 'follow default',
  },
  ...quickRoleRows(),
  {
    id: ESettingId.CompactionModel,
    page: ESettingPage.Models,
    group: 'Background processes',
    label: 'Compaction',
    description:
      'The model that summarises older turns when the context window fills, both for the automatic compaction and for /compact. The summary is all the next turn sees of what it replaces, so a weak model here costs the thread its memory. Left empty, it follows the default model.',
    environmentVariable: 'ATLAS_COMPACTION_MODEL',
    kind: ESettingKind.Model,
    fallback: '',
    unsetLabel: 'follow default',
  },
  ...compactionRoleRows(),
  {
    id: ESettingId.SubagentModel,
    page: ESettingPage.Models,
    group: 'Background processes',
    label: 'Sub-agents',
    description:
      'The model every sub-agent runs on unless its own type is given one below or pins one in its definition. Left empty, a sub-agent runs on whatever model the thread that spawned it is on.',
    environmentVariable: 'ATLAS_SUBAGENT_MODEL',
    kind: ESettingKind.Model,
    fallback: '',
    unsetLabel: 'inherit thread',
  },
  {
    id: ESettingId.SubagentEffort,
    page: ESettingPage.Models,
    group: 'Background processes',
    label: 'Sub-agent effort',
    description:
      'How hard every sub-agent thinks before it answers, unless its own type is given an effort below. Left on inherit, a sub-agent thinks as hard as the agent that spawned it. A model that offers no budget ignores it.',
    environmentVariable: 'ATLAS_SUBAGENT_EFFORT',
    kind: ESettingKind.Choice,
    fallback: INHERIT_EFFORT,
    options: EFFORT_OPTIONS_WITH_INHERIT,
  },
  subagentFastRow(),
  {
    id: ESettingId.ClassifierModel,
    page: ESettingPage.Models,
    group: 'Classifier',
    label: 'Classifier',
    description:
      'The decision model behind skill suggestion and the Jev code review. Never a chat model. Empty means off.',
    environmentVariable: 'ATLAS_CLASSIFIER_MODEL',
    kind: ESettingKind.Model,
    fallback: '',
    unsetLabel: 'off',
  },
  {
    id: ESettingId.ModelFavourites,
    page: ESettingPage.Hidden,
    group: 'Model',
    label: 'Pinned models',
    description:
      'The models the switcher gathers into its own group at the top of the list, in the order they were pinned. Written by the switcher rather than set here. Expects a JSON array of model refs.',
    environmentVariable: 'ATLAS_MODEL_FAVOURITES',
    kind: ESettingKind.Text,
    fallback: '',
  },
  {
    id: ESettingId.GrillingCeremony,
    page: ESettingPage.Experimental,
    group: 'Planning',
    label: 'grilling ceremony',
    description:
      'With this on, a session plans feature-sized work by interviewing you first — walking the design tree one question at a time, recommending an answer with each, sharpening vague terminology, stress-testing edge cases, and checking your claims against the code, capturing every settled decision into the context folder as it goes. A localized fix with an obvious cause stays interview-free either way. Off by default while the ceremony proves itself.',
    environmentVariable: 'ATLAS_EXPERIMENTAL_GRILLING_CEREMONY',
    kind: ESettingKind.Toggle,
    fallback: false,
  },
  {
    id: ESettingId.PrVerdictTiming,
    page: ESettingPage.Experimental,
    group: 'Pull requests',
    label: 'CI verdict timing',
    description:
      'When Atlas Cloud counts a pull request\u2019s checks as a verdict worth waking a parked sandbox for. Fail fast reports the first failed check the moment it lands, so a session parked on a green-or-nothing gate wakes as early as possible; settled waits until every check has finished and reports the outcome once. Fail fast is the default and matches what a live client already sees.',
    environmentVariable: 'ATLAS_PR_VERDICT_TIMING',
    kind: ESettingKind.Choice,
    fallback: 'fail-fast',
    options: [
      { value: 'fail-fast', label: 'fail fast', detail: 'shipped' },
      { value: 'settled', label: 'settled', detail: 'wait for every check' },
    ],
  },
  {
    id: ESettingId.PrEditMutedAuthors,
    page: ESettingPage.Experimental,
    group: 'Pull requests',
    label: 'Muted edit authors',
    description:
      'Edits to pull request comments by these authors never reach a subscribed thread. Comma-separated GitHub logins; a bot\u2019s [bot] suffix is optional. Status bots that rewrite one comment on every deploy belong here.',
    writeLayer: ESettingsLayer.Project,
    kind: ESettingKind.Text,
    fallback: PR_EDIT_MUTED_AUTHORS_FALLBACK,
  },
  {
    id: ESettingId.PrEditUrgentAuthors,
    page: ESettingPage.Experimental,
    group: 'Pull requests',
    label: 'Urgent edit authors',
    description:
      'Edits to pull request comments by these authors wake a subscribed thread at once instead of arriving with the next batch of routine updates. Use it for review bots that report by editing one comment, such as chatgpt-codex-connector.',
    writeLayer: ESettingsLayer.Project,
    kind: ESettingKind.Text,
    fallback: PR_EDIT_URGENT_AUTHORS_FALLBACK,
  },
  {
    id: ESettingId.QualityEnabled,
    page: ESettingPage.CodeQuality,
    group: 'code-quality',
    label: 'Code quality review',
    description:
      'Runs whenever a classifier is set on the Classifier settings page, and is off without one. After a successful file write, the classifier reviews the changed scope against the enabled code-quality policies and may leave the agent a one-time nudge. Advisory only: it never blocks or reverts a write, and a review that is skipped, late or inconclusive says nothing.',
    kind: ESettingKind.Toggle,
    fallback: true,
  },
]

const NON_CHAT_MODEL_SETTING_IDS: ReadonlySet<string> = new Set([ESettingId.ClassifierModel])

export const isChatModelSetting = (definition: SettingDefinition): boolean =>
  definition.kind === ESettingKind.Model && !NON_CHAT_MODEL_SETTING_IDS.has(definition.id)
