# @dltech/atlas-plugin-skills

Load a skill into a turn and manage the installed skills. A skill is a `SKILL.md` with
frontmatter. The model sees the model-invocable skills in its system prompt and loads one with the
`skill` tool. The API composes it as the `skills` plugin.

## Owns

- The `skill` and `skill_manage` tools.
- The skills catalogue: repo skills under `.agents/skills`, cloud skills from the `Skills` setting
  and the built-in skills compiled into this package.
- The listing of model-invocable skills in the system prompt, before each step.
- The skill suggestion on a turn's first step: at most one skill named to the model, scored by the
  classifier role.
- The `skills-changed` event, and the pure code that parses, validates, orders and renders skills.

## Does not own

- The cloud skill store. The `CloudSkillSource` and `CloudSkillWriter` ports reach it, and the API
  binds them.
- The parsing of a typed `/name` line. The host parses it and asks the pod's `slash` source. This plugin registers no command.
- The classifier. `ctx.classifier` reaches it, and the API binds it from the Classifier settings.

## Entry points

| Import                                  | Use it for                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `@dltech/atlas-plugin-skills/core`      | `skillsCoreSlots`, the frontmatter and spec parsers, the validator, precedence, listing.      |
| `@dltech/atlas-plugin-skills/pod`       | `skillsPodOf`: the two tools, the `skills` resource, the two step hooks and the slash source. |
| `@dltech/atlas-plugin-skills/catalogue` | The built-in skill catalogue and its lookups. No Node import, so a client can bundle it.      |
| `@dltech/atlas-plugin-skills/client`    | `skillsClient`, `latestSkillsOf` and `repoSkillsOf`.                                          |

## Capabilities

### Core, pure

- `skillFrontmatterOf({ fields: frontmatterOf(text), fallbackName })`, `frontmatterOf`, `skillBodyOf`: split and read a `SKILL.md`.
- `skillSpecOf({ text, fallbackName })`: the name, the summary and the argument hint of a `SKILL.md`, or nothing for blank text or an empty name. The API uses it to describe a stored skill.
- `validateSkill`: the names, the limits (`SKILL_NAME_MAX_LENGTH`, `SKILL_DESCRIPTION_MAX_LENGTH`) and the warnings (`ESkillWarning`).
- `resolveSkillShadowing`: which skill wins when two layers hold the same name. A repo skill beats a cloud project skill. A cloud project skill beats a cloud group skill. A cloud group skill beats a cloud user skill. A cloud user skill beats a built-in skill.
- `expandSkillBody`, `renderSkillListing`, `skillSummaryOf`, `skillListRowSchema`, `skillsChangedSchema`, `ESkillOrigin`.
- `skillSuggestionStateOf({ events })`: the last `SKILL_SUGGEST_TURNS` operator messages, each with
  the agent's last reply, and the skills already loaded. An operator message still waiting in the
  inbox counts as the latest turn, and `trigger` names it as `inbox:<id>`. Nothing when the latest
  message is answered or already has a suggestion. Rewound events are not read.
- `skillSuggestionAskOf({ input, candidates })`: a word-overlap shortlist of at most
  `SKILL_SUGGEST_SHORTLIST` skills, the classifier state and one `noul` question per skill. Nothing
  when no skill overlaps.
- `skillSuggestionOf({ answers, names })`: the winner, or nothing when the best is below
  `SKILL_SUGGEST_FITS_THRESHOLD` or the runner-up is within `SKILL_SUGGEST_MARGIN`.
  `skillSuggestionBlockOf` writes `skill: <name> — <score>`.

### Built-in skills

The source of the five built-in skills is `plugins/skills/skills`, in this package. `bun run generate` compiles it into
`src/pod/builtin.generated.ts`, `src/pod/builtin-files.generated/` and `src/catalogue/catalogue.generated.ts`.
- `BUILT_IN_SKILLS`: the `SKILL.md` text and resource files of each built-in skill. The pod tier uses it; the package does not export it.
- `BUILT_IN_SKILL_CATALOGUE`: the name, the description, the entry digest and the digested resource files of each built-in skill. The API serves it.
- `builtInSkills`, `builtInSkillEntry`, `builtInSkillNames`, `isBuiltInSkillName`: lookups over that catalogue.
- `BUILT_IN_SKILL_SPECS`: the user-invocable built-in skills, parsed from `SKILL.md` by `skillSpecOf`.
- `builtInSkillsRoot()`: the absolute directory of the source files, so a surface can read the bytes of a binary resource.

### Client

- `latestSkillsOf(events)`: the catalogue of the last `skills-changed` event.
- `repoSkillsOf(events)`: only the repo skills of that catalogue.

## Plugin contributions

### The tools the model sees

| Tool           | What it does                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `skill`        | Load the skill named `name`. `arguments` names the subject of the task; `path` reads one file the skill bundles. |
| `skill_manage` | `install`, `edit` or `delete` a skill in the `user`, `group`, `project` or `repo` layer.                         |

`install` and `edit` need `body`. A cloud `edit` also needs `baseRevision`.

`skill_manage` writes a repo skill to `<repo>/.agents/skills/<name>/SKILL.md` in the clone of this
session. The tool refuses to delete a built-in skill, because Atlas compiles that skill into the
package.

### The pod slot

`skillsPodOf({ cloud, writes, suggests })` gives the two tools, the `SKILLS_RESOURCE` resource, the
`skills-suggestion` and `skills-listing` hooks and the pod's `slash` source. `skillsResource(options)`
builds the resource alone. It watches `<project>/.agents/skills` and the cloud `Skills` setting,
and it announces `skills-changed` with the whole catalogue.

`slash(ctx).names()` is every user-invocable skill of the catalogue, including one that sets
`disable-model-invocation`, because the operator may still type it. `slash(ctx).load({name,
argumentText})` returns one `context-loaded` draft for the skill slot, with `$ARGUMENTS` and `$1`
expanded, and refuses an unknown or unreadable skill with the `skill` tool's own sentence.

`skills-suggestion` runs before each step, after the turn has drained the inbox. It reads only the
event log and the catalogue snapshot. When the classifier is on, `suggests(ctx)` is not false and
the latest operator message has no reply and no suggestion yet, it makes one classifier call with a
`SKILL_SUGGEST_DEADLINE_MS` deadline. A winner is appended as one `context-loaded` event in the
`skill-suggestion` slot, key `latest`, and the same block is added to this step's messages, so the
model sees it on the first step. Later steps of the turn find the reply and stay quiet. Any fault is
logged and the step goes on with no suggestion.

`skills-listing` runs before each step. It appends the model-invocable skills to the system prompt
within `SKILL_LISTING_BUDGET_CHARS`. A skill that sets `disable-model-invocation` stays out.

### The client hook

`skillsClient` gives one hook, `skills-list`, which applies to the `skills-changed` event.

## Usage

```ts
import { EMPTY_CONTROL, definePlugin } from '@dltech/atlas-plugin-sdk'
import { skillsClient } from '@dltech/atlas-plugin-skills/client'
import { skillsCoreSlots } from '@dltech/atlas-plugin-skills/core'
import { skillsPodOf } from '@dltech/atlas-plugin-skills/pod'

const cloudSkills = skillCloudPort()

definePlugin({
  name: 'skills',
  ...skillsCoreSlots,
  pod: skillsPodOf({
    cloud: (ctx) => cloudSkills.source(ctx.sessionId),
    writes: (ctx) => cloudSkills.writer(ctx.sessionId),
    suggests: async (ctx) => await cloudSkills.suggests(ctx.sessionId),
  }),
  control: EMPTY_CONTROL,
  client: skillsClient,
  transport: 'stream',
})
```

`skillCloudPort({ db })` is the port factory of the API. It takes an optional `db` handle from the
caller and binds the cloud skill store. Its `suggests(sessionId)` reads `skills.suggest` (user,
then group, then project; on by default).

## Rules

- Import the pod tier in a pod only. It reads files and calls the daemon.
- Pass `cloud`. Without `writes`, the tool refuses a write to a cloud layer. Without `suggests`,
  the suggestion follows the classifier alone.
- Give a cloud edit its `baseRevision`. The tool refuses a stale revision and reports the current
  one, so read the skill again and retry.

## See also

- `docs/architecture.md`
- `docs/decisions/0019-v2-package-map.md`
- `.agents/skills` in this repository for real skills.
