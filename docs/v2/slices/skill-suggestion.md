# Spec: a skill suggestion that stays on topic (v2)

> **Approved by Dennis 2026-11-23.** The reason line shows the score. Built after the classifier role's slice 2.

Status: **draft for Dennis**, 2026-11-23. Owner: `plugins/skills`. One PR, after the classifier role
(`classifier.md`) lands. Anchors read at `ee5fdfdef` (repo `/atlas/workspaces/atlas`).

---

## 1. Product contract

Before a turn, Atlas may name **one** skill that fits the work in hand. The hint tells the model
which procedure to load. The model may ignore the hint. The hint never loads a skill.
- It reads the **thread**, not one sentence: the last three operator messages, each with the
  agent's last reply to it, plus the skills already loaded in this session and the skill summaries.
- The decision is a **classifier score**, not a generated sentence: one `classify` call on the
  classifier role asks one yes/no question per shortlisted candidate and one gate question.
- It stays **quiet** when nothing fits, when the score is not high enough, when two skills are too
  close to separate, when a skill is already loaded, and when this message already has a
  suggestion. Silence is the normal case.
- The model sees one short block in the `system-context` lane. The operator sees the same line in
  the transcript as `skill suggestion · <name>`.
- **Off when the classifier is off.** No classifier model, or its provider not connected: the hook
  does nothing, no request is made, and the settings row says why. The per-turn toggle
  (`ESettingId.SkillSuggest`) stays and defaults on, which now means "on when the classifier is
  available".

---

## 2. Why v1 went off topic

v1 is `packages/harness/src/hooks/skill-suggestion.ts` and `packages/harness/src/skills/suggest.ts`.
Four causes, from the code:
1. **It read one message and nothing else.** `latestSaid` (`skill-suggestion.ts:25-26`) takes the
   last `user-said` event; the hook passes only `said.text` (`:58`) and `suggestSkill` sends only
   that string, cut at 4 000 chars (`suggest.ts:24`). A follow-up like "yes, do that" or "same for
   the API" carries no domain words, so the pick came from the shape of the sentence.
2. **Every skill was a flat choice with a one-line summary.** `skillWideQuestions` puts up to 255
   names into one `choice` question (`packages/core/src/skills/suggestion.ts:49-64`), each with
   `skillSummaryOf` as its only description. A name that shares one word with the message looked as
   good as the right one.
3. **The gate was deliberately weak.** `SKILL_SUGGEST_GATE_THRESHOLD = 0.3` and
   `SKILL_SUGGEST_FITS_THRESHOLD = 0.3` (`suggestion.ts:8-13`) on the mean of three generic
   questions (`:88-98`, `:116-131`). One partly-true gate answer passed.
4. **The dedupe lived in memory.** `private readonly suggested = new Map<string, string>()`
   (`skill-suggestion.ts:34`, `:60`, `:76`) forgets on a host restart, and a second host knows
   nothing.

v1 knew the picks were weak: the block ends with "if it does not, ignore this entirely"
(`suggestion.ts:133-140`), and #1220 exists because a "no skill relevant" verdict still produced an
injected block.

**Cause in two lines:** v1 scored every skill against the latest message alone with a 0.3 gate. The
pick followed the message's vocabulary, not the work. The fix is a richer input, one yes/no
question per real candidate, and a threshold that means what it says.

---

## 3. Design

### 3.1 Where it runs

The hook is a `beforeTurn` hook in `plugins/skills`, registered beside the listing hook
(`plugins/skills/src/pod/index.ts:18-24`). Pod hooks run inside the agent host process, never in
the sandbox. The sandbox is read only through the catalogue the `skills` resource already snapshots
(`plugins/skills/src/pod/resources.ts`), so the hook does no file IO. `beforeTurn` drafts are
appended before assembly (`packages/agent/src/loop/tracked-turn.ts:64-80`), and the resource hook
is `Guard` stage (`packages/host/src/holder/plugin-resources.ts:27-35`), so an `Observe` hook with
`nudge: 10` runs after the catalogue snapshot exists.

### 3.2 The input: a tail of the thread

```ts
export type SkillSuggestionTurn = {
  operator: string
  agent: string | undefined
}

export type SkillSuggestionInput = {
  turns: readonly SkillSuggestionTurn[] // oldest first, at most 3
  loaded: readonly string[] // skill names already loaded this thread
}

export const SKILL_SUGGEST_TURNS = 3
export const SKILL_SUGGEST_OPERATOR_CHARS = 1_200
export const SKILL_SUGGEST_AGENT_CHARS = 800
```

**Three turns, and why.** A skill decision is about the work, and the work is rarely in one message:
"make a demo clip of this PR" → "keep it under 30 seconds" → "yes, go" needs the first message to
make sense. Three turns covers the ask → clarify → confirm shape, which is what a follow-up looks
like in a real thread. Each turn costs tokens at the classifier's input price; three turns at the
caps above are about 1 500 tokens, and a fourth and fifth add cost while the model's attention
stays on the last two. The caps keep a pasted stack trace from eating the whole state.

**The task list and the touched paths are dropped.** Both were in the earlier draft and neither
earns its place:
- The task list is the agent's own paraphrase of the operator's request. It adds no independent
  evidence about what procedure fits, and it changes mid-turn, so the same operator message could
  score differently before and after a `task_write` — a per-message decision must not depend on the
  agent's later bookkeeping.
- Touched paths are a weak proxy: a `read` of a docs file says nothing about the work, and the
  order of tool calls would leak into the state. They also make the input depend on step order, so
  a retry or a rewind could change the answer to the same message.

What replaces them is the agent's **reply per turn**, which already says in prose what the work
turned out to be, in the agent's own words and without a second derivation.

**`loaded` stays.** It is the only way to avoid naming a skill the model already has in context.

### 3.3 The candidates: a lexical pre-filter, then one question each

```ts
export const SKILL_SUGGEST_SHORTLIST = 12
export const SKILL_SUGGEST_CANDIDATE_CHARS = 3_000
```

- The candidates are the model-invocable entries of the catalogue snapshot, minus `loaded`, rendered
  with the existing `renderSkillListing` at `SKILL_SUGGEST_CANDIDATE_CHARS`
  (`plugins/skills/src/core/listing.ts:78-95`). The classifier sees the same words the system
  prompt lists.
- A word-overlap pre-filter keeps at most `SKILL_SUGGEST_SHORTLIST` = 12: lowercased tokens of each
  entry's name and `skillSummaryOf`, minus a small stopword list, matched against the state text;
  entries with no overlap are dropped; ties broken by catalogue order. No candidates → quiet, no
  call.
- **Why the pre-filter is kept.** Jev ingests the state once and fans questions out in parallel
  ([docs.typesafe.ai/models](https://docs.typesafe.ai/models)), so cost does not multiply by the
  question count; the request size does. 255 questions with their own instructions is a ~15 000
  token request whose answer is spread across near-identical questions, which is exactly the flat
  choice v1 got wrong. Twelve shortlisted candidates is one screen of state and a decision the
  classifier can separate. The listing still goes into the **state** once, so each question is one
  short line naming its skill.

### 3.4 The classifier call

```ts
// plugins/skills/src/core/suggestion.ts
export const SKILL_SUGGESTION_SLOT = 'skill-suggestion'
export const SKILL_SUGGESTION_KEY = 'latest'
export const SKILL_SUGGEST_DEADLINE_MS = 1_200

export const SKILL_SUGGEST_GATE_KEY = 'needsProcedure'
export const SKILL_SUGGEST_GATE_THRESHOLD = 0.7
export const SKILL_SUGGEST_FITS_THRESHOLD = 0.75
export const SKILL_SUGGEST_MARGIN = 0.15

export const skillSuggestionAskOf = (args: {
  input: SkillSuggestionInput
  candidates: readonly SkillListingEntry[]
  budgetChars?: number
}): { state: string; questions: Record<string, ClassifierQuestion>; names: readonly string[] } | undefined

export const skillSuggestionOf = (args: {
  answers: Readonly<Record<string, DecisionAnswer>>
  names: readonly string[]
}): { name: string; probability: number } | undefined
```

- **State** is labelled plain text: `Operator:` / `Agent:` per turn, oldest first, then
  `Skills the agent can load:` and the rendered listing. Empty sections are left out.
- **Questions** are `noul`:
  - `needsProcedure` — "Does this work need a documented procedure or a set of commands that an
    agent should follow, rather than prose?" The gate, asked in the state's own words.
  - `fits:<name>` — "Does the procedure in the skill `<name>` cover the work above?" One per
    shortlisted candidate.
- **No `choice` question and no rerank.** v1's two-stage wide-then-rerank existed because one
  question could not rank 255 names. With twelve candidates, one yes/no each is the same decision
  with a probability the code can threshold and a per-question answer that cannot be confused with
  its neighbour.
- **Winner rule**, in order: gate `< 0.7` → quiet; take the highest `fits`; below `0.75` → quiet;
  the runner-up within `0.15` → quiet. One winner, or none.

**Why these three numbers.** Jev's `noul` is the probability of yes
([docs.typesafe.ai/api/system-one](https://docs.typesafe.ai/api/system-one)), so 0.75 is a claim
that the procedure fits about three times out of four. v1's 0.3 sat inside coin-flip range and
needed an ignore clause in the block to survive. A gate at 0.7 stops the "does any skill apply"
question from being answered by the shape of the request. The margin exists because the common
failure is two skills that share words ("video", "review"); when they are that close, the answer is
vocabulary, not work, and silence is the better output. The cost is asymmetric: a missed hint costs
one skill load the model can still do itself, a wrong hint costs the model's attention and a wrong
procedure for a whole turn. The live check measures these three numbers on real threads before the
PR merges; the values above are the starting point, not a result.

### 3.5 The reason line: the score, and nothing else

Dennis's Q2 is right: Jev is a classifier, so there is no clause to show. Three options:

| Option                             | Block                                       | Cost                                                        |
| ---------------------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| Drop it                            | `skill: video`                              | The operator cannot tell a 0.76 pick from a 0.99 pick.      |
| **Show the score (recommended)**   | `skill: video — 0.87`                       | One number the model may over-trust.                        |
| Ask a second question for a reason | `skill: video — 0.87 (matches: clip, demo)` | A second round trip for words the classifier did not write. |

**Recommended: the score.** It is the only evidence a classifier has, it is four tokens, and it
makes a threshold change visible in the transcript: when the operator sees a run of 0.77 picks, the
threshold is what to move. The over-trust risk is handled in the provenance sentence, which says
what the number is:

> The Atlas harness's skill classifier scored the work in this thread as a 0.87 match for the skill
> 'video'. The operator did not write this. Load it only when it fits.

If the number turns out to be noise in real use, drop the option and keep `skill: <name>`.

### 3.6 The block, the slot and the transcript

- `skillSuggestionBlockOf({ name, probability })` returns `skill: <name> — <score>`, score to two
  decimals. No tags: the envelope comes from `systemContext` on the way to the model
  (`packages/core/src/context/envelope.ts:104-114`).
- The provenance sentence at `packages/core/src/context/envelope.ts:86-88` is rewritten as in §3.5.
- The transcript labels the block from its content
  (`packages/client/src/transcript/context-entries.ts:52-60`). Change the regex to
  `/^skill: ([a-z0-9][a-z0-9-]*)/` and keep the label form `skill suggestion · <name>`.
- `slot` and `key` stay `skill-suggestion` / `latest`, so a later suggestion supersedes the earlier
  one (`packages/core/src/context/supersede.ts`) and the prompt carries one block, about 60 tokens.

### 3.7 Durable state only

`ctx.events()` is this thread's whole event log. Every rule reads it:

| Rule              | Read from the log                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the work          | the last three `user-said` with `saidBy(event) === EMessageOrigin.Operator`, each followed by the last `assistant-said` before the next operator message |
| already loaded    | `tool-called` with `name === 'skill'` and a string `input.name`, lowercased, unique                                                                      |
| already suggested | a `context-loaded` with `slot === 'skill-suggestion'` after the latest operator message                                                                  |
| answered          | an `assistant-said` after the latest operator message → quiet                                                                                            |

No map, no timer, no cache. A restart, a second host or a rewind recomputes the same answer.
`context-loaded` is `Discard` on rewind (`packages/core/src/events/rewind-disposition.ts:23`), so a
rewound message earns a fresh suggestion.

### 3.8 The hook

New file `plugins/skills/src/pod/suggestion-hook.ts`:
1. `skillSuggestionStateOf({ events: ctx.events() })` → `quiet` returns `{}`.
2. `ctx.classifier.status()` → `{ on: false }` returns `{}`. No call, no cost.
3. `catalogueOf({ ctx, options })` (snapshot only) → `null` returns `{}`; map to
   `SkillListingEntry` as the listing hook does (`plugins/skills/src/pod/listing.ts:6-13`),
   filtering `modelInvocable`.
4. `skillSuggestionAskOf(...)` → `undefined` returns `{}`.
5. `ctx.classifier.classify({ state, questions, signal: AbortSignal.timeout(SKILL_SUGGEST_DEADLINE_MS) })`.
   Not `ok` → `{}`. The deadline is the latency ceiling: a slow provider costs nothing visible.
6. `skillSuggestionOf(...)` → `undefined` returns `{}`.
7. Return one draft: `{ type: 'context-loaded', slot, key, content }`.

Register it in `plugins/skills/src/pod/index.ts:22`:
`hooks: (ctx) => ({ beforeTurn: [skillsSuggestionHook({ ctx, options })], beforeStep: [skillsListingHook({ ctx, options })] })`.

---

## 4. Cost and latency

- **Silent turns cost nothing**: no operator message, an answered message, a suggestion already in
  the log, the classifier off, no shortlisted candidate, or the gate below 0.7.
- **One call per new operator message** at most: state ≈ 2 000–2 600 tokens (three turns plus a
  3 000-char listing), 13 short questions ≈ 400 tokens. At Jev's $42 per million input tokens that
  is about **$0.0001 per call**; on OpenAI `gpt-6-luna` at $0.10 per million it is about
  **$0.0000003**.
- **Latency**: the hook is `awaited`, so no step starts before it answers; its internal deadline is
  1 200 ms and the request is aborted at it.

---

## 5. Slice (one PR)

| #   | Contents                                                                                                                                                       | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The pure state and decision modules, their specs, the hook and its registration, the provenance sentence, the transcript regex, the setting text, the READMEs. | `plugins/skills/src/core/suggestion-context.ts`, `plugins/skills/src/core/suggestion.ts`, `plugins/skills/src/core/index.ts`, `plugins/skills/src/core/__tests__/suggestion-context.spec.ts`, `plugins/skills/src/core/__tests__/suggestion.spec.ts`, `plugins/skills/src/pod/suggestion-hook.ts`, `plugins/skills/src/pod/__tests__/suggestion.spec.ts`, `plugins/skills/src/pod/index.ts:22`, `packages/core/src/context/envelope.ts:86-88`, `packages/client/src/transcript/context-entries.ts:52`, `packages/core/src/settings/registry.ts:322-328`, `plugins/skills/README.md` |

Depends on the classifier role (slice 2 of `spec-classifier.md`). No v1 file is edited.

---

## 6. Test plan and live check

**Pure (`plugins/skills/src/core/__tests__/`).**
- `skillSuggestionStateOf`: no operator message; the message answered; a suggestion after the
  message; three turns paired with their replies, oldest first; a fourth turn dropped; the caps
  applied; `loaded` deduplicated and lowercased; non-string `input.name` ignored.
- `skillSuggestionAskOf`: `loaded` is not a candidate; the pre-filter drops an entry with no
  overlap and keeps the best twelve; one `noul` per shortlisted name plus the gate; the section
  order of the state; no candidates → `undefined`.
- `skillSuggestionOf`: gate 0.6 → quiet; winner 0.74 → quiet; winner 0.76 with runner-up 0.60 →
  the winner; winner 0.80 with runner-up 0.70 → quiet (margin); a missing answer → quiet; a
  probability outside [0, 1] → quiet.
- `skillSuggestionBlockOf`: the exact line, score to two decimals.

**Pod (`plugins/skills/src/pod/__tests__/suggestion.spec.ts`).** A fake ctx and a fake classifier:
- one draft naming a skill, with the specified `slot` and `key`;
- `quiet` when the classifier reports `{ on: false }`, and `classify` is never called;
- `quiet` when the log already holds a suggestion for the message;
- `quiet` when `classify` returns `{ ok: false }` and when it rejects on abort;
- `quiet` when the catalogue is absent.

**Client.** `skill: video — 0.87` renders as `skill suggestion · video`
(`packages/client/src/transcript/__tests__/system-context-entries.spec.ts`).

**Commands.** `bun test` in `plugins/skills`, `packages/client`, `packages/core`;
`turbo run typecheck`; `bunx biome check --write` on the touched files.

**Live check (production, one fresh session, this repo, a classifier connected).**
1. "make a 30 second demo clip of this PR" → `skill suggestion · video`, score ≥ 0.75; the model
   loads `video` or says why it does not.
2. "yes, but keep it vertical" as the next message → a suggestion again only if the score passes;
   record the score.
3. "what does the sandbox image build" → no suggestion, and the gate question records a score
   below 0.7.
4. "review this branch" twice in a row → at most one suggestion; the second message is answered
   before the hook runs again.
5. Reload the session, then send a third message → no duplicate suggestion for messages 1 and 2.
6. Turn the classifier off in Settings, start a new session: no suggestion, no request, and the
   settings row reads `Off — …`.
7. Read the trace: one classifier call per operator message, under 1 200 ms. Collect the scores of
   ten real messages before merging and move the thresholds if they are wrong.

---

## 7. Out of scope

- Loading a skill from the suggestion, and the `/name` command path.
- Skill bodies in the input. Only the listing words are read, so a skill whose trigger words live
  in its body can be missed.
- A per-suggestion setting, a new limit, an approval, a badge or a new pane.
- Retries, token booking on the turn ledger, and any cache or memo across turns.
- Any change under `packages/harness`, and any v1 file.
