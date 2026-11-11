# Spec: one envelope path for everything the model reads

Status: **spec, 2026-11-11**, for operator approval. Anchors at `6a99b42`. Foundational: the
sessions slice ([sessions-link.md](sessions-link.md)) reports through it, so this comes first.

## Goal

Every string the model reads is produced by one function that takes a lane, a source and a body, and
renders the envelope. No rule, tool, plugin or fragment composes model-visible text of its own. v1 got
this right: one wrapping path for operator input, agent messages, harness context, notices and
untrusted third-party text — and the integrity of the lanes is what lets the model tell a page it
fetched from an instruction it must follow.

**Exit criteria**
1. One core API renders every envelope, and every producer calls it: event blocks, tool output, hook
   slots, subscription and PR blocks, compaction lines, plugin prompt fragments.
2. Bash output is untrusted by default, as browser and fetch output already are.
3. The lane names exist once: the transcript, compaction and the prompt name an agent message the same
   way, from the same table.
4. A guard fails the build when a new producer emits model-visible text without an envelope, and when
   a reserved tag appears outside the envelope module.
5. No behaviour change to what the model is told beyond the wrapping; v1 untouched.

## 1. What exists today

- **The helpers** live in `packages/core/src/context/envelope.ts`: `operatorSaid`, `agentSaid`,
  `systemContext`, `systemNotice`, `untrustedEnvelope`, plus `neutraliseEnvelopeTags` for bodies that
  quote the tags. Every tag is reserved and neutralised — that part is right.
- **Event blocks each pick a helper.** `messages-from-events.ts` dispatches per event type to a block
  (`nudge-block`, `subscription-block`, `agent-reported-block`, `pr-event-block`, `run-event-block`,
  …) and each block decides its own tag and wording. It works, but nothing makes a new block choose
  correctly.
- **Tool output is inconsistent.** `browser` (`plugins/web/src/pod/browser-tool.ts:81`) and
  `web_fetch` (`fetch-tool.ts:128`) wrap their pages in `untrustedEnvelope`. `bash` returns plain
  text (`apps/agent-host/src/agent-tools/bash-output.ts`) — the largest untrusted input in the system
  is the one source that is not marked.
- **The lane vocabulary is duplicated.** `agentSenderOf` in
  `packages/core/src/assembly/rules/messages-from-events.ts:163-166` and the speaker table in
  `packages/core/src/compaction/render-range.ts:130-140` both name lanes, in different words, and
  both had to be edited by hand when `child-agent` was added (#2223). That duplication is the smell.
- **Hook provenance is a stringly-typed dictionary.** `HOOK_SLOT_PROVENANCE`
  (`envelope.ts:57-73`) maps a slot name to a sentence, with a generic fallback for anything new.
- **Prompt fragments are plain text.** `plugins/*/src/pod/fragment.ts` each return prose that joins
  the system prompt unlabelled, so a reader cannot tell an instruction from a plugin's description.

## 2. The shape

```ts
export enum ELane {
  Operator = 'operator-said',
  Agent = 'agent-said',
  Context = 'system-context',
  Notice = 'system-notice',
  Untrusted = 'system-untrusted',
}

export type Envelope = { lane: ELane; source: string; body: string }

export const envelopeOf = (args: Envelope): string => …
```

- `source` is the one place a lane's origin is named: a session id, an agent id, a slot name, a URL,
  a tool name. `agent-said`'s `from`, `system-context`'s and `system-untrusted`'s `source`,
  `system-notice`'s `kind` all read from it.
- The lane naming table (operator, main agent, a peer agent, a sub-agent, the harness, a page) lives
  beside `ELane` and is consumed by the prompt assembler, the compaction renderer and the transcript.
  One table, three readers.
- Bodies pass through `neutraliseEnvelopeTags` inside `envelopeOf`; no caller can forget it.

## 3. The producers, one at a time

- **Event blocks:** each block returns `{ lane, source, body }` instead of a rendered string;
  `messages-from-events` renders. A block that returns text is a type error.
- **Tools:** a tool result names its lane. Read-only external text (`bash`, `grep` output, `web_fetch`,
  `browser`, MCP tool results) is `Untrusted` with the tool and command as the source; Atlas's own
  tools (`read`, `task_write`) stay plain, because they are the model's own data, not a stranger's.
- **Hook slots:** the slot becomes the source; the sentence per slot moves into the same table as the
  lane names, and an unknown slot still renders the generic provenance.
- **Prompt fragments:** each fragment declares a source (its plugin id) so the prompt shows where an
  instruction came from, rather than an undifferentiated block of prose.
- **Compaction:** `render-range` renders a line as `envelopeOf`'s one-line form, reusing the lane
  table instead of its own speaker strings.

## 4. The guard

- `packages/core` exports `RESERVED_TAGS`; a spec walks every assembly rule's output and asserts each
  message body begins with a reserved tag or is assistant text.
- A script (in the shape of `scripts/check-package-split.ts`) fails when a module outside
  `packages/core/src/context/` contains a reserved tag literal.
- Tool specs assert each tool's `modelText` lane, so a new tool without a lane fails.

## 5. Out of scope

- Moving text that is not model-visible (viewport, notices to the operator's UI).
- Changing any tool's content, only its wrapping.
- The TUI's rendering (slice 9).

## 6. Open questions

1. **Bash output as untrusted** changes bytes the model sees (a wrapper around every command's
   output). Confirm the trade — I recommend yes, and a one-line envelope rather than a header per
   result.
