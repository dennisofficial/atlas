# @dltech/atlas-plugin-skills

Load a skill into a turn and manage the installed skills. A skill is a `SKILL.md` with
frontmatter. The model sees the model-invocable skills in its system prompt and loads one with the
`skill` tool. The API composes it as the `skills` plugin.

## Owns

- The `skill` and `skill_manage` tools.
- The skills catalogue: repo skills under `.agents/skills`, cloud skills from the `Skills` setting
  and the built-in skills compiled into this package.
- The listing of model-invocable skills in the system prompt, before each step.
- The `skills-changed` event, and the pure code that parses, validates, orders and renders skills.

## Does not own

- The cloud skill store. The `CloudSkillSource` and `CloudSkillWriter` ports reach it, and the API
  binds them.
- A skill typed as `/name` at the start of a message. This plugin registers no command.

## Entry points

| Import                                  | Use it for                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| `@dltech/atlas-plugin-skills/core`      | `skillsCoreSlots`, the frontmatter and spec parsers, the validator, precedence, listing.    |
| `@dltech/atlas-plugin-skills/pod`       | `skillsPodOf`: the two tools, the `skills` resource, the listing hook and the slash source. |
| `@dltech/atlas-plugin-skills/catalogue` | The built-in skill catalogue and its lookups. No Node import, so a client can bundle it.    |
| `@dltech/atlas-plugin-skills/client`    | `skillsClient`, `latestSkillsOf` and `repoSkillsOf`.                                        |

## Capabilities

### Core, pure

- `skillFrontmatterOf({ fields: frontmatterOf(text), fallbackName })`, `frontmatterOf`, `skillBodyOf`: split and read a `SKILL.md`.
- `skillSpecOf({ text, fallbackName })`: the name, the summary and the argument hint of a `SKILL.md`, or nothing for blank text or an empty name. The API uses it to describe a stored skill.
- `validateSkill`: the names, the limits (`SKILL_NAME_MAX_LENGTH`, `SKILL_DESCRIPTION_MAX_LENGTH`) and the warnings (`ESkillWarning`).
- `resolveSkillShadowing`: which skill wins when two layers hold the same name. A repo skill beats a cloud project skill. A cloud project skill beats a cloud user skill. A cloud user skill beats a built-in skill.
- `expandSkillBody`, `renderSkillListing`, `skillSummaryOf`.
- `skillListRowSchema`, `skillsChangedSchema`, `ESkillOrigin`.

### Built-in skills

The source of the five built-in skills is `plugins/skills/skills`, in this package. `bun run
generate` compiles it into `src/pod/builtin.generated.ts` and `src/catalogue/catalogue.generated.ts`.
- `BUILT_IN_SKILLS`: the name, the `SKILL.md` text and the resource files of each built-in skill, for the pod.
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
| `skill_manage` | `install`, `edit` or `delete` a skill in the `user`, `project` or `repo` layer.                                  |

`install` and `edit` need `body`. A cloud `edit` also needs `baseRevision`.

`skill_manage` writes a repo skill to `<repo>/.agents/skills/<name>/SKILL.md` in the clone of this
session. The tool refuses to delete a built-in skill, because Atlas compiles that skill into the
package.

### The pod slot

`skillsPodOf({ cloud, writes })` gives the two tools, the `skills` resource, the
`skills-listing` hook and the pod's `slash` source. The resource watches `<project>/.agents/skills`
and the cloud `Skills` setting, and it announces `skills-changed` with the whole catalogue.

`slash(ctx).names()` is every user-invocable skill of the catalogue, including one that sets
`disable-model-invocation`, because the operator may still type it. `slash(ctx).load({name,
argumentText})` returns one `context-loaded` draft for the skill slot, with `$ARGUMENTS` and `$1`
expanded, and refuses an unknown or unreadable skill with the `skill` tool's own sentence.

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
  }),
  control: EMPTY_CONTROL,
  client: skillsClient,
  transport: 'stream',
})
```

`skillCloudPort({ db })` is the port factory of the API. It takes an optional `db` handle from the
caller and binds the cloud skill store.

## Rules

- Import the pod tier in a pod only. It reads files and calls the daemon.
- Pass `cloud`. Without `writes`, the tool refuses a write to a cloud layer.
- Give a cloud edit its `baseRevision`. The tool refuses a stale revision and reports the current
  one, so read the skill again and retry.

## See also

- `docs/v2/architecture.md`
- `docs/decisions/0019-v2-package-map.md`
- `.agents/skills` in this repository for real skills.
