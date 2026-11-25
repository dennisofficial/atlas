# Package READMEs

Every workspace package under `packages/`, `plugins/` and `commands/` has a `README.md`. The
reader is an agent that must use the package, not change it. The README tells that agent what the
package can do, without a read of `src/`.

A README and an `AGENTS.md` have different jobs:
- `README.md` is for a consumer. It describes the public surface: entry points, capabilities and
  usage.
- `AGENTS.md` is for a contributor. It gives the rules for a change inside the package.

`bun scripts/check-package-readmes.ts` runs in `bun run lint`. It fails when a README is missing,
when its first line is not `# <package name>`, when it does not name each entry point, or when it
has more than 150 lines. A daily routine compares each README with the code and corrects drift.

## Scope

- Each package in `packages/*`, each plugin in `plugins/*`, and `commands/` must have a README.
- Apps in `apps/*` do not need one. Nothing imports an app.

## When to update a README

Update the README in the same pull request as the change to the public surface. A public-surface
change is one of these:
- You add, remove or rename an entry point in `package.json` `exports`.
- You add, remove or rename an exported function, class, type or constant that a consumer uses.
- You change what a plugin contributes: a tool, an event, a view, a command, a hook, a prompt
  fragment or a setting.
- You change a rule that a consumer must obey.

## Template

Use these sections in this order. Omit a section that has no content. Write the package name
exactly as `package.json` `name` gives it. Keep the README below 100 lines when possible. The
limit is 150 lines.

````md
# @dltech/atlas-<name>

<One to three sentences: what the package does and who uses it.>

## Owns

- <A responsibility of this package.>

## Does not own

- <A related responsibility, and the package that owns it.>

## Entry points

| Import                     | Use it for       |
| -------------------------- | ---------------- |
| `@dltech/atlas-<name>`     | <What it gives.> |
| `@dltech/atlas-<name>/pod` | <What it gives.> |

## Capabilities

### <Task group, for example "Read the event log">

- `exportName(args)`: <What it does, in one sentence.>

## Plugin contributions

<Plugins only. One table per tier: the tools (with the tool name the model sees), events, views,
commands, hooks, prompt fragments and settings that the plugin registers.>

## Usage

```ts
<The smallest real example. Copy it from a caller or a spec when you can.>
```

## Rules

- <A constraint that a consumer must obey, for example "Import only in the pod tier.">

## See also

- <Links to the docs, decisions and specs that explain why.>
````

Rules for the content:
- Name each entry point with its full import specifier, for example
  `@dltech/atlas-plugin-shells/pod`. The check looks for that exact text.
- List what a consumer uses. Do not list each internal helper.
- Make each claim true for the code on `main`. Do not describe a plan.
- Use the names from `CONTEXT.md`: a session, a thread, a sub-agent, a teammate.
- Put the reasons in `docs/` and link to them. A README gives the what and the how.

## Write in Simplified Technical English

Write each README in ASD-STE100 Simplified Technical English (STE). An agent reads STE with less
chance to misinterpret it. These are the rules that apply most to a README:
- Use one word for one meaning. Use the same term each time for the same thing.
- Use a code identifier as a technical name. Put it in backticks.
- Write a sentence of 20 words or fewer for an instruction. Write a sentence of 25 words or fewer
  for a description.
- Write one instruction in one sentence. Use the imperative: "Import the pod tier only in the pod."
- Use the active voice. Write "The host replays the log", not "The log is replayed".
- Use the simple tenses: present, simple past and future.
- Do not use an `-ing` form as a noun or an adjective, except in a technical name.
- Keep the articles "a", "an" and "the". Do not write in telegraph style.
- Write one topic in one paragraph. Use six sentences or fewer in a paragraph.
- Use a vertical list for steps and for items of the same type.
- Put a warning first, then its reason: "Do not import this in a client. It reads the filesystem."
- Do not use vague words such as "simply", "just", "easily", "etc." or "various".

Source: [ASD-STE100 Simplified Technical English](https://www.asd-ste100.org/).
