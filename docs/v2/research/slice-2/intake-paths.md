# Agent input paths in Atlas v1: evidence for v2 slice 2

Read-only source census, 2026-11-02. Checkout: `/atlas/workspaces/atlas`, HEAD `5203552d4a305654edbbd18c42c863a73948414c`. No repository files changed; this report is a session-context artifact. No builds or tests were run: conclusions below are from reading production implementations, not executing them. The research skill was loaded; its delegation instruction was not followed because this search-agent contract prohibits spawning agents.

## Answer

**There is already a shared notice-drain coordinator, but not yet one complete agent-input seam.** `MessageIntake` multiplexes shells, child endings/reports, services, plugin sources, subscriptions, and the operator pending queue. Main and child runners both drain it. Nevertheless initial/direct `say`, child spawn briefs, legacy child steering, progress reports, hook output, watchdog/silent/resume nudges, quality output, remote history hydration, and operator-input replies have distinct entry paths. Unifying only `agent_say` and `report_to_main` misses most of the extraction.

Crucial distinction: **arrival, model delivery, and starting a turn are three different operations.** Durable notice arrival rows deliberately do not reach the model. Delivery rows do. Some model-visible input does not wake a turn (progress/context); some input is already appended before a turn is requested; some is only transformed into a prompt, with no event at all. A new universal interface must express those differences, not turn everything into a `user-said` or a waking notice.

The roadmap requirement is `/atlas/workspaces/atlas/docs/v2/roadmap.md:36–48`: same loop and queue for all agent kinds, differences supplied as configuration; one intake for every producer.

## 1. Existing common machinery and ownership

- `/atlas/workspaces/atlas/packages/harness/src/composition/intake-binding.ts:18–55`, `bindIntake`: constructs sources in **shells → agents → services → plugin sources → operator** order. `submit` only enqueues into `PendingQueues`. Child fallback drivers resolve from the roster; blocked for waiting-for-model, missing/failed child, currently stepping child, or killed child. `agents.wake` is the fallback wake operation. Model-wait and roster changes trigger rechecks.
- `/atlas/workspaces/atlas/packages/harness/src/composition/compose.ts:323`: actual extra sources are plugin-contributed sources followed by `subscriptions.intakeSource`.
- `/atlas/workspaces/atlas/packages/harness/src/composition/turn-wiring.ts:140–162,193–204`: main `TurnDeps.drainPending = intake.prepare`; child `drainNotices = intake.prepare` too. Child-specific steering still wraps that drain.
- `/atlas/workspaces/atlas/packages/harness/src/intake/message-intake.ts:7–21`: `IntakeSource` is prepare/enumerate/subscribe/witness, optionally submit; `IntakeDriver` is blocked/wake. `SubmittedInput` is still specifically a pending chat message, not a general event/notice.
- `/atlas/workspaces/atlas/packages/harness/src/intake/sources.ts:8–41`: registry adapters prefer `prepareNotifications`; otherwise wrap destructive drains in retained-source. Operator adapter prepares its thread queue.
- `/atlas/workspaces/atlas/packages/harness/src/intake/input-batch.ts:3–20`: batch has drafts, wakesTurn, acknowledge, optional release. Combining concatenates source batches and ORs wakesTurn. There is **no cross-source occurrence-time sort**.
- `/atlas/workspaces/atlas/packages/harness/src/plugins/plugin.ts:56`, `/atlas/workspaces/atlas/packages/harness/src/plugins/load.ts:157–203`: plugins can contribute arbitrary additional `IntakeSource`s, accumulated in plugin order. These are an extension path, not a separate kind of loop.

### Arrival versus delivery

The owning rules are `/atlas/workspaces/atlas/packages/core/src/events/notice-stage.ts:4–86`:
- Notice-bearing types are agent-ended, agent-reported, service-ended, shell-ended/matched/awaiting-input, pr-event.
- A notice carries `{id, stage: arrived | delivered}`. `reachesModel` excludes arrival rows and `agent-ended` with `relayed:false`; `recordsLifecycle` excludes delivery rows.
- `owedNotices` finds arrived IDs without any matching delivered ID; `deliveredDraftOf` retains the body, strips the event envelope, changes stage.
- Lifecycle persistence therefore must not itself imply delivery or wake. Recovered delivery is not a second lifecycle transition.

Turn-taking rules: `/atlas/workspaces/atlas/packages/core/src/agents/kind.ts:10–32` and `/atlas/workspaces/atlas/packages/core/src/agents/report.ts:1–10`. Arrivals never take a turn. User/assistant speech, tool result/denial, nudge, shell awaiting/matched/still-running/ended, service-ended, and pr-event do. Agent-reported takes a turn except `kind:progress` (missing kind remains waking for compatibility); agent-ended takes a turn except `relayed:false`. Context-loaded, lifecycle bookkeeping, model-wait rows, and verdict records do not. `/atlas/workspaces/atlas/packages/core/src/events/projections.ts:142–145`, `awaitsReply`, asks whether the **last turn-taking event is anything other than assistant-said**.

## 2. Producer census

The following entries distinguish different entry/delivery paths even where they converge on the shared coordinator.

### A. Operator chat: pending queue during work; direct say at idle

**Entry:** `/atlas/workspaces/atlas/packages/harness/src/intake/message-intake.ts:72–77`, `MessageIntake.submit`, reaches `/atlas/workspaces/atlas/packages/harness/src/pending/pending-queue.ts:116–130`, `enqueue`. Thread-local queues are created by `/atlas/workspaces/atlas/packages/harness/src/pending/pending-queues.ts:18–48`.

**Queue/events:** in-memory FIFO `PendingEntry[]`; messages carry text/images/files/uploads/context/via/requestId. `prepare` emits per message `[explicit context, expanded context, user-said]` at pending-queue.ts:173–201. Context expansion runs only for operator/default-origin messages (65–85). Chat is not logged until committed. Request ID is carried, not deduped by this queue. Commands coexist in the array but are not included by message prepare; separate `enqueueCommand`/`drainCommands` at 133–135 and 218–224. Commands are control/surface work, not automatic model messages.

**Alternate entry bypass:** `/atlas/workspaces/atlas/packages/harness/src/loop/run-turn.ts:183–215`, `LoopTurnRunner.say`, appends explicit context, expanded context and `saidBody(...)` directly, then runs a turn. It does not submit to MessageIntake. This is a real exported seam even though modern serve idle sends generally commit via intake first.

**Callers proving running/idle behavior (outside harness, necessary to identify who starts a turn):**
- `/atlas/workspaces/atlas/apps/serve/src/turn-driver.ts:132–176`: busy/committing/history-held sends enqueue; idle sends call commit then runUntilQuiet. A send landing during an active turn may request another run through `again`; runUntilQuiet resets/rechecks it at 69–113. `run` while turning sets `again` at 116–128.
- `/atlas/workspaces/atlas/apps/serve/src/turn-commit.ts:22–78`: modern idle commit submits and commits intake; without intake writes drafts directly. Creates initial thread atomically with first events if necessary. Explicit `eventsAppended` publication is for mirrored clients, not the model's intake.
- `/atlas/workspaces/atlas/apps/tui/src/composition/use-conversation-send.ts:180–207`: running local sends use pending or shared submit; surface retains a fallback pending path.

**Delivery:** shared step-boundary drain for queued sends; direct append before idle turn for say/commit. All kinds can receive operator-origin messages through shared pending intake, but child-target surface routing is a separate adapter. `via` affects attribution/expansion/editability, not a separate model role.

**Editing:** pending-queue.ts:137–170 allows take-back of last unreserved operator/default-origin item; update/remove reject reserved messages and nonoperator message edits. Stable snapshots are used for subscribers. Retaining these semantics requires identity and reservation state, not just an immutable prompt string.

### B. Initial sub-agent or teammate brief

**Entry:** `/atlas/workspaces/atlas/packages/harness/src/agents/registry/open-child.ts:14–59`, `openChildThread`; called by `/atlas/workspaces/atlas/packages/harness/src/agents/registry/spawn-child.ts:54–115`, `SpawnChild.spawn/spawnAdmitted`.

**Queue/events:** no intake queue. Creates a child thread with first `user-said` (`via:ParentAgent`), records `agent-spawned` in parent, adds roster state and directly starts child `runner.runTurn`. Main-only teammate-spawn permission is checked at spawn-child.ts:80–83. Both child kinds take this path; initial briefs bypass operator skill expansion.

**Delivery:** already in log before first step. Parent starts it explicitly through ChildSteps; no idle-source witness is involved.

### C. `agent_say`: parent-to-child while running versus idle

**Entry:** `/atlas/workspaces/atlas/packages/harness/src/agents/registry/say.ts:147–157`, `say`, verifies direct parent ownership, calls `deliver`/`deliverAdmitted` (53–145).

**Running modern path (77–87):** `deps.input()` returns shared intake; `submit` to child with `via:ParentAgent`; normal pending FIFO and next boundary. Does not interrupt the current model call.

**Running legacy path (90–96):** pushes a `SteerMessage` into `ChildState.pending` (defined `/atlas/workspaces/atlas/packages/harness/src/agents/registry/child-state.ts:20–53`). No log write or independent intake wake. `/atlas/workspaces/atlas/packages/harness/src/agents/registry/child-steering.ts:4–19`, `steeringOf`, snapshots pending and splices only captured prefix on acknowledgement.

**Idle modern path (108–141):** holds child's intake driver, submits, `input.commit` appends **all prepared child inputs**, clears legacy steering, records restart `via:Message`, directly starts `runner.runTurn`, releases hold. The explicit hold prevents a racing automatic wake.

**Idle legacy path (125–130):** directly appends a `user-said` with supplied origin before same restart/run. Fault-killed child is refused (99–101); missing type refused.

**Child merge seam:** `/atlas/workspaces/atlas/packages/harness/src/agents/registry/child-runner.ts:110–155,168,200–216`: `peekSteering` retains capture across failures, maps to user-said with default ParentAgent, and **places steering before shared intake drafts**, although it awaits the notice preparation first. This is an additional ordering tier absent in main.

**Kinds:** existing children (sub and teammate) use the same registry delivery logic. Sub-agents have fewer tools, so not all senders can themselves call agent_say; this is capability filtering rather than a distinct receiving role.

### D. Child normal ending (the sub-agent's report), failure, stop or pause

**Entry:** `/atlas/workspaces/atlas/packages/harness/src/agents/registry/child-steps.ts:193–250`, `ChildSteps.finish`, calls `/atlas/workspaces/atlas/packages/harness/src/agents/registry/child-endings.ts:13–51`, `recordEnding`.

**Queue/events:** `agent-ended` contains last full assistant prose, status, failure metadata, counts and possible leftover services; constructor in child-state.ts:220–237. `AgentJournal.stamp/record` at `/atlas/workspaces/atlas/packages/harness/src/agents/registry/agent-journal.ts:25–40` gives a unique notice ID, appends arrival to the parent, and verifies runId in readOwn if append threw. Delivery is queued in `AgentNoticeQueue`. If arrival did not land (or relocation pause deliberately skips it), queue carries `unloggedArrival`, so drain appends arrival then delivery atomically in draft order.

**Normal sub-agent ending:** `ESpeech.OnEnd` relays prose through waking agent-ended. There is no separate report_to_main API for ordinary sub-agents in current implementation.

**Teammate normal ending:** `ESpeech.ByReport` + Finished creates only `agent-ended, relayed:false`; immediately logged bookkeeping, not queued, not model-visible, not waking (child-steps.ts:239–248, child-endings.ts:33–35). Teammate failure/stop still relays an ending. Configuration of speech therefore changes producer policy today.

**Special hold:** finished OnEnd child with a still-running shell is left held Running with steppingSince cleared and waitingOn set, no ending yet (child-steps.ts:211–220). Shell notice can later wake it. WaitingForModel is parked similarly at 204–208.

**Orphans:** on actual finish child shell/service notices are inherited by parent before recording ending (230); shell/service queue reassign functions below. Thus recipient can change before model delivery.

**Delivery/ordering/dedupe:** `/atlas/workspaces/atlas/packages/harness/src/agents/registry/notices.ts:26–65`: per-thread FIFO, captured object identities removed only on ack; unlogged arrival precedes its delivery; `requeue` dedupes by notice ID, ordinary `queue` does not. `/atlas/workspaces/atlas/packages/harness/src/agents/registry/delivery.ts:30–38,71–86` stamps child deliveredAt only on acknowledgement and only for the same abort-signal generation; report acknowledgements do not mark endings delivered.

### E. Teammate explicit `report_to_main`

**Entry:** `/atlas/workspaces/atlas/packages/harness/src/tools/builtin/report-to-main.ts:40–48`, tool calls registry `reportToParent`; implementation `/atlas/workspaces/atlas/packages/harness/src/agents/registry/say.ts:160–196`. Refuses nonteammates at 163–165. The tool's prose is stricter than the general sub-agent calling instructions: **ordinary sub-agent output is an ending, not this report API**.

**Waking report:** agent-reported {agentId,type,intent,prose,kind}; successful durable arrival required, then delivery queued in parent's AgentNoticeQueue, same boundary/idle handling as ending. Done/blocked/needs-decision and legacy unspecified kind wake.

**Progress report:** directly appends unstamped `agent-reported kind:progress`, no notice queue, no wake. It is model-visible when a later prompt is assembled but by itself never makes awaitsReply true. If it lands during a model request, current request cannot see it; if that request ends the turn without another step, it waits for a later real wake. It does not force continuation. This is why generic 'deliver all agent output as waking user messages' is not behavior-preserving.

### F. Background shell ending

**Entry:** `/atlas/workspaces/atlas/packages/harness/src/shells/registry-events.ts:36–72`, `ShellEvents.recordEnding`; shell lifecycle calls it on process completion. Reads tail excerpt, runs afterShell hooks, rejects superseded entry, persists then queues attention.

**Queue/events:** `/atlas/workspaces/atlas/packages/harness/src/shells/journal.ts:27–45,136–139,167–193`: background-shell-ended arrival plus hook drafts are appended immediately; delivered counterpart queued. Notice carries status/exit/killer/command/description/boot/output ranges/path. Shell ID + owner + boot + optional recovery occurrence ID key journal writes. Per-key promise tails serialize writes (208–224); terminal suppresses later nonending rows; duplicate successful ending skipped, failed ending retry allowed. No-journal/test setup may queue attention without a draft, so batch can have wakesTurn true with empty drafts.

**Delivery:** `/atlas/workspaces/atlas/packages/harness/src/shells/attention.ts:27–45`: in-memory FIFO dedupe by notice ID, capture/ack removes only captured objects, wakes when any captured attention exists. `ShellRegistry.prepareNotifications` at `/atlas/workspaces/atlas/packages/harness/src/shells/shell-registry.ts:195–213` is actual adapter. **Do not replace it with drainNotifications:** legacy drain at 190–192 merely acknowledges and returns `[]`.

**Kinds:** notice owner is launching thread, not necessarily main; all kinds use common drain. Shell/service orphan notices can move to parent (`attention.ts:83–91`, service-notices.ts:99–107), and child ending policy can hold sub-agent open while its shell is live.

### G. Background shell watch match and prompt detection

**Entry:** registry-events.ts:75–113, `announceAwaitingInput`, `announceMatched`, `recordPrompt`; `ring` at 116–130 waits for successful journal and validates current tracked entry.

**Queue/events:** background-shell-matched includes watch pattern, lines, matchCount, watchDisarmed; background-shell-awaiting-input includes prompt excerpt/input capability. Stamped arrival/delivery constructors and journal operations are shell journal.ts:48–88,149–164. Same attention FIFO and source as shell completion, distinct producers/triggers. Delivery does not consume the shell output cursor: excerpts are computed from attachment tail (registry-events.ts:14–27).

**Delivery:** next boundary or idle wake. `watchDisarmed` is preserved output data, not a wake scheduler command. Queue itself does not merge match/prompt/ending types into one item; producer watch logic controls how often matches occur.

### H. Service exit (natural, explicit stop, crash)

**Entry:** `/atlas/workspaces/atlas/packages/harness/src/services/service-endings.ts:38–47,65–98`, `ServiceEndings.exited/persist/announce`.

**Queue/events:** `/atlas/workspaces/atlas/packages/harness/src/services/service-notices.ts:15–29`: service-ended status/exit/killer/logPath/tail/boot. `/atlas/workspaces/atlas/packages/harness/src/services/service-journal.ts:58–79,89–123` logs stamped arrival before queueing delivered. Per-owner/service serial tails, terminal/disowned guards, one successful ending, failed-write retry. Endings announce only for current tracked service and successful persistence. No-journal setup queues unstamped event.

**Delivery:** ServiceNoticeQueue (service-notices.ts:43–68) FIFO; notice-ID dedupe; snapshot capture/ack; captured count controls wake. Owner launching thread; same model boundary/idle source for main/sub/teammate. Declared restarts are runtime lifecycle policy, not another loop input channel: each ended process still enters through ServiceEndings.

### I. GitHub/subscription occurrence (push, polling diff, terminal reading)

**Producer entry:** `/atlas/workspaces/atlas/packages/harness/src/plugins/github/index.ts:73–93`: raw push frames to provider; poll differ also feeds provider. `/atlas/workspaces/atlas/packages/harness/src/plugins/github/pull-request-provider.ts:254–274`, `onFrame`; `sweep` at 190–198 synthesizes merged/closed state from already-settled readings. `start` wires subscription emitter at 229–251.

**Cloud adapter:** `/atlas/workspaces/atlas/packages/harness/src/cloud/pr-event-frame.ts:39–59,75–99`, `prEventNoticeOf/deliverPrEvent`: validates frame, maps to pr-event carrying eventId, catches malformed/throwing consumers. `/atlas/workspaces/atlas/packages/harness/src/cloud/sse-pull-requests.ts:36–96` owns SSE PR adapter and reading book; `/atlas/workspaces/atlas/packages/harness/src/cloud/pr-subscription-client.ts:139–149` acknowledges durable mailbox IDs. These are transport/producer adapters, not direct model invocation.

**Registry entry:** `/atlas/workspaces/atlas/packages/harness/src/subscriptions/registry.ts:259–283`, `offer`: requires live subscription; stamps mailbox arrival; journals ackable PR row; feeds delivered-form occurrence to DeliveryBuffer. DeliveryBuffer callback enqueues ReadyQueue at 88–101. Registry-owned `readyIntakeSource` loads thread then prepares queue (`/atlas/workspaces/atlas/packages/harness/src/subscriptions/ready-queue.ts:97–112`). Generic providers can emit arbitrary EventDraft, not only PR.

**Durability:** `/atlas/workspaces/atlas/packages/harness/src/subscriptions/pr-event-journal.ts:46–64` journals arrival asynchronously and API-acks only after successful append; owed arrivals replay into ReadyQueue on load. Arrival ID is `pr-event:<mailbox eventId>` (`pr-event-notice.ts:11,27–39`). Do not mistake API ack for model delivery acknowledgement. Failed journaling leaves API replay available; registry still offers delivered form to its local buffer.

**Coalescing:** `/atlas/workspaces/atlas/packages/harness/src/subscriptions/delivery-buffer.ts:5,25–87`: 120,000ms quiet window **per subscription**, reset on each batched occurrence. Map keyed by occurrence.key; replacing deletes/reinserts so latest key moves to end. Now, settles, or ends flush immediately: prior held keys except current key, then current occurrence. Ordinary flush emits current map values. ReadyQueue itself is FIFO, no ID dedupe; prepare captures current objects, ack removes those only and triggers completion (ready-queue.ts:22–65). Terminal subscription remains ending until ready rows depart (registry.ts:279–287); unsubscribe/pause discard buffered/ready work (235–253,305–307).

**PR urgency/dedupe:** pull-request-provider.ts:83–116: approval reviews batch by author; green verdict batches with settles=true (immediate flush of batch); failed verdict immediate; mergeability batch; merged/closed immediate + ends; other comments/review changes immediate unless edit policy mutes/batches them. `/atlas/workspaces/atlas/packages/harness/src/plugins/github/pure/pr-event-dedupe.ts:3,40–66`: 200 recently seen IDs plus last admitted transition reading per repo/PR/kind. This is bounded in-memory dedupe, not durable exactly-once global ordering.

**Kinds/ownership:** `/atlas/workspaces/atlas/packages/harness/src/subscriptions/thread-owner.ts:9–39`: main/teammate owns itself; ordinary child resolves recursively to ancestor owner. Tool filtering currently denies subscribe to sub-agents. `/atlas/workspaces/atlas/packages/harness/src/composition/subscription-binding.ts:88–94` loads main and teammate owners on compose. Ready subscription input is delivered through common boundary/idle mechanism.

### J. Replay, reconciliation, teardown and imported durable input

These are additional producers/admission paths, not merely fresh process callbacks:
1. **Owed notices:** shell `/atlas/workspaces/atlas/packages/harness/src/shells/owed-notices.ts:57–77`; agent `/atlas/workspaces/atlas/packages/harness/src/agents/registry/owed-notices.ts:7–33`; service `/atlas/workspaces/atlas/packages/harness/src/services/owed-notices.ts:5–34`; PR pr-event-journal.ts:60–64. Reconstruct delivered forms from arrival-only log IDs and feed existing queues. Agent replay additionally requires rostered child. Shell/service/agent replay queues dedupe notice IDs; PR ready queue itself does not.
2. **Lost child:** `/atlas/workspaces/atlas/packages/harness/src/agents/registry/lost-children.ts:21–58`, `settleLostChildren`, called by recovery.ts:130–160 `recordLost/settle`: reads child progress, directly appends synthetic agent-ended in parent and updates roster. Not an arrival/delivery queue call. Existing log input will be seen by a subsequent turn; this function does not itself run parent.
3. **Lost service:** `/atlas/workspaces/atlas/packages/harness/src/services/recovery.ts:55–104,108–133`, `ServiceRecovery.recordLost/reconcile`, requeues owed then directly appends unstamped synthetic service-ended (Unrecorded), coalesces concurrent reconciliation per thread, excludes current boot/live services. Does not itself launch a turn.
4. **Recovered/lost shell:** `/atlas/workspaces/atlas/packages/harness/src/shells/recovery.ts:69–121,139–174,178–204`, ShellReconciler: per-thread in-flight coalescing; requeues owed, retries failed endings, inspects durable shell attachment. Reattaches running process or records finished process through normal ShellEvents. Missing attachment path uses `journal.ended` (stamped arrival) directly; that immediate call does not itself queue a delivered notice; owed reconciliation supplies later delivery. This detail differs from direct synthetic lost service/agent ends.
5. **Teardown/park flush:** `/atlas/workspaces/atlas/packages/harness/src/composition/flush-session-input.ts:10–34`, `flushThreadInput/flushSessionInput` prepare and append even without running a turn, ack only on append success, release in finally. `/atlas/workspaces/atlas/packages/harness/src/composition/session-teardown.ts:32–84` closes sources, flushes intake threads, stops sandbox; fallback without intake drains sources. `bindIntake` suspends wake during teardown. A delivery stamp means committed model input, **not proof that a model request actually consumed it**; crash after append/before step leaves awaitsReply to drive restart.
6. **API-durable operator send:** `/atlas/workspaces/atlas/packages/harness/src/pod-thread/pod-session-send.ts:33–89`, `createPodSessionSend`: sends durable API intent with random sendId, wakes parked pod if needed; BYO/no API lane wakes and falls back to channel frame delivery. This is distinct from local pending messages.
7. **Remote history pull:** owner is outside harness: `/atlas/workspaces/atlas/apps/serve/src/serve-pull.ts:68–150`, `bindServePull`: watch tick hydrates root, refreshes log, runs idle driver if awaitsReply, sweeps children; concurrent ticks coalesce into one pulling promise plus followUp boolean. `/atlas/workspaces/atlas/apps/serve/src/serve-hydrate.ts:36–85`, `hydrateServeHistory`, reads API events newer than local head, sorts seq, imports with mirror writer, rejects unreadable turn-taking rows rather than silently advancing. **This bypasses MessageIntake.** Mid-turn imported user input is detected from the log at a later boundary; idle root is explicitly run. `/atlas/workspaces/atlas/apps/serve/src/serve-pending-children.ts:33–84`, `wakeChildrenWithPendingInput`, refreshes settled family children, reads awaitsReply, calls agents.wake; skips Running child.

### K. Hooks: several nonqueue injection phases

**Entry/conversion:** `/atlas/workspaces/atlas/packages/harness/src/hooks/registry.ts:69–90,106–169,188–190`, `HookChain` methods. Hooks are ordered by core orderHooks, run serially within phase, budgeted, fallback on mishap. `/atlas/workspaces/atlas/packages/core/src/hooks/outcome.ts:10–25`, `hookOutcomeDrafts`, emits context-loaded(slot=hook name,key=additional-context) before explicit outcome drafts.

Distinct paths:
- **BeforeTurn:** runTrackedTurn invokes beforeTurn and appends returned drafts before first pending-tool settle/intake drain (`tracked-turn.ts:79–85`). Main and child runners use same hook chain shape. Does not independently wake idle turn. E.g. skill suggestion hook `/atlas/workspaces/atlas/packages/harness/src/hooks/skill-suggestion.ts:51–77` reads latest logged user-said, dedupes by event ID per thread, returns additionalContext. Therefore moving initial drain before beforeTurn can change what this hook classifies.
- **BeforeTool/AfterTool:** `/atlas/workspaces/atlas/packages/harness/src/tools/dispatch.ts:123–132,170–180,205–225,265–290` consult/resolve before-tool outcomes, return hook drafts alongside tool denial/result and after-tool context. `createSettlePending` appends them under tool call runId, not intake run ID. Denial and edited tool input must remain control decisions, not plain messages.
- **AfterShell:** hooks/registry.ts:165–169 → registry-events.ts:46–61 → shell journal.ts:183–187 appends hook drafts beside **arrival**, before queued ending delivery. These context rows may therefore be logged before the waking shell notice. No separate hook queue/wake.
- **AfterTurn:** closeQuietStep.ts:85–88 appends hook drafts then returns Completed. It does **not** automatically continue even if a hook returns a nudge. Subsequent driver policy/log inspection determines later execution; do not silently make after-turn context force another step.
- **OnThreadOpen:** `/atlas/workspaces/atlas/packages/harness/src/composition/worktree-claims.ts:159–181`, `threadOpenedHandler`, appends returned drafts directly if thread exists after worktree claim. No intake source or automatic wake.
- **BeforeStep:** hooks/registry.ts:133–145 and `/atlas/workspaces/atlas/packages/harness/src/loop/step-prepare.ts:105–157`: transforms assembled context in memory after assembly, before overflow/fault checks. No log event/queue.
- **BeforeRequest:** hooks/registry.ts:147–159 transforms provider prompt in memory, not model-visible durable log input. `onChunk` at 172–185 filters model output, not incoming input.

Hook content includes instructions/memory/environment/skill guidance and plugin MCP instructions. The seam must preserve causal phase; merely enqueueing all hooks for the next outer drain would delay before-step/before-tool guidance and alter behavior.

### L. Watchdog, loop cut, empty response, resume and completion nudges

1. **Semantic watchdog:** `/atlas/workspaces/atlas/packages/harness/src/loop/loop-watchdog.ts:130–224`, `watchStepLoop`, called between intake/guard and assembly. Writes loop-watch-verdict bookkeeping; may applyLoopCut with notice, reset assembly/re-read; otherwise appends loopWatchNudgeDraft (`nudge`) and rewinds iteration once. If still looping after warning, returns stop/Idle. Clear verdict resets escalation. This is a **direct log append**, not a queued notice nor idle wake.
2. **Syntactic repeated-call guard:** `/atlas/workspaces/atlas/packages/harness/src/loop/tracked-turn.ts:125–141`, `guardRepeatLoop`, uses cut machinery and resets assembly on cut. Loop-cut notice and state transition are not ordinary incoming chat. Both kinds of runner inherit guard/watch deps today.
3. **Silent reply:** `/atlas/workspaces/atlas/packages/harness/src/loop/turn-faults.ts:53–87`, `nudgeSilentStep`, directly appends `nudge` and continues with assembly reset; bounded nudges per turn, then no-content or failure. Called only after closing checks for newly arrived messages. Raw empty response retry precedes this at tracked-turn.ts:229–239 and does not itself create input.
4. **Explicit resume:** `/atlas/workspaces/atlas/packages/harness/src/loop/resume-turn.ts:12–27`, `appendResumeDrafts`: expands unexpanded skill mentions and appends core resumeDrafts. `/atlas/workspaces/atlas/packages/core/src/events/resume-plan.ts:39–62` emits one-step-lifetime nudge only for interrupted-resumable history; pending tools need no nudge; outstanding approval blocks resume plan. `LoopTurnRunner.resume` explicitly starts turn after append (run-turn.ts:218–237). Child `resumeChild` at `/atlas/workspaces/atlas/packages/harness/src/agents/registry/resume-child.ts:26–57` records restart and calls runner.resume. Notice wake instead calls runTurn, not resume.
5. **Shell completion race correction:** `/atlas/workspaces/atlas/packages/harness/src/loop/shell-completion.ts:9–21`, `appendShellCompletionNudge`, directly appends core nudge based on owned log. `/atlas/workspaces/atlas/packages/core/src/events/shell-completion-nudge.ts:6–30`: only if model had a seenThrough, delivered ending landed after it, current history otherwise looks answered, and no later user-said/nudge already supplied handoff. Called on interrupted request or close-quiet message-arrival path. One-step lifetime. Do not generalize this to all notice kinds without an intentional behavior change.

### M. Quality feedback

**Entry:** `/atlas/workspaces/atlas/packages/harness/src/quality/engine.ts:143–155`, `finish`, makes quality records plus one-step nudge unless deadline expired. `/atlas/workspaces/atlas/packages/harness/src/tools/quality-dispatch.ts:252–264`, `QualityStage.review`, validates/contains review behavior; `/atlas/workspaces/atlas/packages/harness/src/tools/dispatch.ts:161–180` places review data in tool result and nudge after afterTool drafts. Settled under tool call runId by settlePending. Not a pending intake item or idle wake. Available to main and filtered child dispatchers through same quality dependency, not a message-only side channel.

### N. `operator_input` / `operator_shell_input`: correlated reply, not chat

**Entry:** `/atlas/workspaces/atlas/packages/harness/src/operator-input/registry.ts:59–70,81–135`, `InProcessOperatorInput.request/openRequest`; `/atlas/workspaces/atlas/packages/harness/src/operator-input/registry.ts:138–182`, `answer`.

**Queue/events:** in-memory one `Open` per thread keyed by requestId; writes operator-input-requested before publishing prompt; caller tool awaits promise. Answer finds matching request/thread, waits recorded-ready, rejects duplicate/cancelled/delivering requests, optionally appends newline, sends raw value to file/FIFO or shell stdin. **The secret value never becomes user-said or notice content.** Writes operator-input-resolved with outcome and byte count only, clears prompt, resolves awaiting tool (203–235). The eventual tool-result is how loop sees completion.

**Delivery:** correlated resume of in-flight dispatch, not MessageIntake drain, not independent idle-turn wake. Cancellation attaches to current signal; no retry of partially delivered value. `/atlas/workspaces/atlas/packages/harness/src/operator-input/deliver.ts:61–130` performs private delivery and cleans spool; `/atlas/workspaces/atlas/packages/harness/src/operator-input/register-operator-input.ts:29–50` supplies published log and shell write adapter. `operator_shell_input` shares this port, not a separate intake queue.

**Kinds:** `/atlas/workspaces/atlas/packages/harness/src/agents/registry/child-runner.ts:63–74`: operator_input is denied to both child kinds; sub-agent denied list is larger. This is existing tool capability policy. A universal input seam must not accidentally make secrets transcript-visible or grant unavailable child tools.

### O. Boot/runtime context and setup notices

Immediate host-side producers outside harness are also relevant to the single seam: `/atlas/workspaces/atlas/apps/serve/src/serve-boot-app.ts:123–139` directly appends `context-loaded` for mounted project files and exported cloud environment names. `/atlas/workspaces/atlas/apps/serve/src/container-notice-events.ts:20–42`, `recordNoticeEvents`, converts collected container NoticePort posts to `sandbox-setup-reported`, appends and publishes them. These rows are passive context, not waking inputs; the core turn-taking predicate excludes both. They enter subsequent prompt assembly from the log (sandbox-setup-reported mapping at `/atlas/workspaces/atlas/packages/core/src/assembly/rules/messages-from-events.ts:266`). General NoticePort/UI warning publication is not automatically an agent input; this specific conversion is.

### P. Model-recovery / machine wake / controls: distinguish input from execution signals

- `/atlas/workspaces/atlas/packages/harness/src/loop/waiting-outcome.ts:8–22`: admission-block result is observed as WaitingForModel, returns waiting outcome instead of continuing model loop.
- `/atlas/workspaces/atlas/packages/harness/src/model-recovery/wait-state.ts:70–120,140–193`: observe groups waits at root by episode-group key, unions affected thread IDs, favors newer credential generation, coalesces with zero-delay timer, serializes root appends of model-waiting. clear/admitted/reconcile write model-wait-cleared. These are **state/bookkeeping**, not turn-taking model notices. Rechecks shared intake through subscribe but do not by themselves manufacture a waking item. I found no independent production caller of `reconcile` that constructs a generic model-recovered message; searched ModelWaitStateToken, ModelWaitState, reconcile/clear, model-recovery/model_recovery across harness and serve/TUI source. Do not promise an automatic recovery loop that this checkout does not implement.
- `/atlas/workspaces/atlas/packages/harness/src/wake/wake-signal-source.ts:25–28`, `fire`, is **machine sleep/clock-jump recovery**, not an agent notice. `/atlas/workspaces/atlas/packages/harness/src/model/wake-aware-model.ts:19–74` aborts stranded model sockets with StreamStallError; `/atlas/workspaces/atlas/packages/harness/src/loop/retrying-step.ts:153–167` wakes retry sleep, without refunding attempts. Retry preparation re-drains intake (tracked-turn.ts:172–190). No user/nudge event is created just for clock wake.
- `/atlas/workspaces/atlas/packages/harness/src/cloud/thread-wake-stream.ts:19–61,64–78`, `watchThreadWakes`: thread lifecycle wake signal invokes caller onWake; it does not carry model text. Pod wake (`pod-thread/pod-wake.ts:21–75`) coalesces attachment/provision into one in-flight promise. Neither is the input body; durable events/subscriptions carry the body separately.
- Interrupt/pause are execution controls through AbortSignal/PauseSignal. `/atlas/workspaces/atlas/packages/harness/src/cloud/remote-turn-runner.ts:195–235` forwards abort/pause over channel; no new model message. Universal intake may expose correlated control capability alongside items, but must not translate stop into user chat.
- Core knows `background-shell-still-running` and approval-answered/requested, but I did **not** find a live harness producer emitting those literal event types in this checkout (searched full harness production TS). Retain compatibility with existing logs; do not count their schemas/projections as evidence of another active producer.

## 3. Precise queue and turn-boundary semantics

### Prepare/append/ack transaction

1. MessageIntake.prepare serializes **per thread** with an outstanding preparation promise; another prepare waits until ack/release, abort-aware (`message-intake.ts:121–170`). Different threads are not globally locked.
2. It prepares sources serially in configured order. Their snapshots can therefore be taken at slightly different instants; this is not an atomic globally timestamped queue snapshot. On source error it releases already prepared batches.
3. Operator prepare reserves all currently unreserved messages, preserving queue insertion order. It does not remove them until ack, disallows editing while reserved, releases reservations on release. It snapshots _all_ messages, not just a prefix before a pending command.
4. Registry batches capture matching notice object identities. New objects arriving after capture remain after ack; service/shell/agent batches generally need no remove-and-reinsert on release because they never removed capture. `retainedSource` retains destructively drained batches until ack (`/atlas/workspaces/atlas/packages/harness/src/intake/retained-source.ts:13–49`), including pending-versus-turn-taking enumeration.
5. `/atlas/workspaces/atlas/packages/harness/src/loop/pending-intake.ts:14–53`, `appendPending`, checks abort before/after drain, appends all drafts with fresh runId, releases on abort/append failure, acknowledges only after successful append. Returns separate drained and wakesTurn flags. No draft does not necessarily imply no wake.
6. `commit` (`message-intake.ts:173–185`) and flushThreadInput use the same prepare/append/ack contract with finally-release. Ack/release idempotence matters because finally release follows successful ack too.
7. This is transactional queue handoff relative to append; not a guarantee of model consumption or universal end-to-end exactly-once delivery. Event stage IDs plus replay and producer-specific dedupe provide the actual recovery properties.

### During a turn

Source anchors: `/atlas/workspaces/atlas/packages/harness/src/loop/tracked-turn.ts:79–285`, `/atlas/workspaces/atlas/packages/harness/src/loop/settle-pending.ts:70–108`, `/atlas/workspaces/atlas/packages/harness/src/loop/close-quiet-step.ts:32–88`.
1. beforeTurn hooks append before first drain.
2. Each outer iteration checks relocation pause, reads owned log, settles outstanding tool calls **before** input drain. Settle sorts pending call ordinal, partitions concurrency-safe runs, executes each run with Promise.all, appends each call's drafts as it settles. Completion order may differ from call order for safe calls. It rereads between partitioned runs. A newly queued message does not preempt an in-flight tool batch.
3. If tools were settled, restart outer iteration and reread. If paused/stalled/interrupted, return appropriate outcome before model request.
4. Drain input, append/ack it, reread if drained or waking. Repeated-call guard may cut/restart. If neither awaitsReply nor `messageArrivedSince` is true, return idle/swallowed without model call.
5. Watchdog runs, can write/cut/nudge/restart/stop. Set seenThrough to last owned sequence before assembly, then assemble and beforeStep hooks. Compaction restarts iteration.
6. Start model request. Queue arrivals during streaming are not spliced into that already submitted request. On retry, `prepareAttempt` drains again and reassembles current log; tracked preparedThrough updates seenThrough and invalidates previous assembly when retry consumed later input.
7. Commit model result/calls. If tool calls exist, repeat and settle them before next input drain.
8. If no tool calls, closeQuietStep first reads log and asks `messageArrivedSince`: filter seq > seenThrough and exclude assistant-said, then awaitsReply (`/atlas/workspaces/atlas/packages/harness/src/loop/turn-position.ts:14–24`). Thus direct-appended user/notice/nudge arriving during model request forces continuation even if the just-appended assistant speech would otherwise mask it. It may append shell-completion correction nudge.
9. If no direct-log handoff, drain pending once more. A waking batch continues and resets silent counters; nonwaking context alone does not force another request. Then silent-reply handling, afterTurn hook append, Completed.
10. Boundary race after the final drain is handled by source change/driver release recheck after turn settles; it is not a synchronous lock over the entire last-step/idle transition.

### Idle wake scheduler

Source: `message-intake.ts:198–243,268–371`.
- Source change coalesces into one microtask recheck. Enumerates union of threadsAwaitingInput (not all pending bookkeeping), chooses explicit registered driver or child fallback.
- Skip if suspended, blocked, waking or thread held. Recheck blocked/suspended/held again in promise microtask immediately before launching.
- Witness is an array of each source's stable witness value; comparison is reference equality per element. Unchanged witness after unsuccessful/undelivered wake increments retry failures; changed witness or acknowledged nonempty draft batch resets. Backoff starts 1s, doubles to cap 30s; minimum retry timer yields a macrotask. **No permanent 3-attempt cap in MessageIntake.**
- waking remains set through returned driver's promise. Driver returning void clears it immediately; correctness then depends on driver's running/blocked state. Serve returns active turning promise; TUI driver's onWake is void.
- Suspension refcounted; hold is per-thread refcounted; neither discards pending items. prepare is not itself disabled by suspension (used for flushing while wakes are suspended).
- Wake only starts execution; turn's own drain appends delivery. It need not create a synthetic user turn. Explicit idle say/child message commits are exceptions that append before explicit run.
- `/atlas/workspaces/atlas/packages/harness/src/agents/registry/notice-wake.ts:32–84`, `NoticeWake.wake`: admission/reservation, refuse currently stepping/killed/retired child, record restart via Wake, ChildSteps.take runner.runTurn. Returns admission snapshot rather than the full child's turn promise; roster blocked state prevents repeated overlapping starts.
- Serve driver registration: `/atlas/workspaces/atlas/apps/serve/src/turn-driver.ts:312–323`, blocked by turning/committing/relocation/history and returns turning promise. TUI registration: `/atlas/workspaces/atlas/apps/tui/src/composition/use-main-wake.ts:77–93`, blocked by work/UI permission/isRunning; keyboard-owning prompts suppress wake.
- `/atlas/workspaces/atlas/packages/harness/src/composition/main-wake.ts:17–34`, MainWake, is **legacy fallback**, not current coordinator. It uses joined notice witness and caps retries at three. TUI only uses it without intake (`use-main-wake.ts:95–107`). Preserve fallback behavior if retained; do not describe its cap as universal scheduler semantics.

## 4. Proposed single interface: preserve v1 first, then simplify

This is a proposed contract, not an implementation change or claim that these types exist today.

### Intake item data

A source-agnostic item should carry at least:
- **Identity and routing:** itemId, recipient agent/thread ID, sender/source identity (operator, agent ID, subscription/provider ID, shell/service ID, hook name, watchdog, recovery). Source is provenance, not a dispatch branch selecting a different agent loop. Include session scope for teammate-as-peer migration.
- **Correlation:** requestId/sendId, noticeId, tool callId/runId/parentRunId where causally attached, replyTo item/request, producer-generation/boot/occurrence identity. Needed for duplicate transport delivery, ending generation stamps, and correlated secret replies.
- **Payload discriminant:** message (text/images/files/uploads + supplied context), event/draft bundle (not necessarily user-said), context contribution, correlated response capability/result, control signal. Preserve full structured event data and schema; do not stringify all input. Secret response should be a nonpersisted capability/token to private delivery, not raw value in durable item/log.
- **Attribution/trust:** origin/via, content trust/source envelope, model visibility, lifecycle-only flag; context expansion policy. Parent-agent messages must not accidentally acquire operator expansion/edit rights.
- **Delivery/phase:** earliest eligible boundary (turn-open, before-step, retry-prepare, tool-settlement phase, after-shell, after-turn, thread-open); model prompting transformation for currently ephemeral hook phases. Current beforeRequest/BeforeStep are transformations, so use an explicit phased context contribution rather than pretending they are delayed chat.
- **Wake policy:** wake idle + continue active, active-boundary-only, passive/model-visible-next-natural-step, lifecycle-only, correlated reply to suspended dispatch, or control-only. Passive progress must stay passive; context not always turn-taking; no model wake merely for machine wake/availability-state changes.
- **Persistence policy/stage:** arrival already recorded? arrival draft(s), delivery draft(s), no-record ephemeral contribution, or private response. Separate lifecycle arrival and deliverable model rows; imports can represent already-committed input without append duplication.
- **Ordering and batching:** source-order class + within-source sequence, bundle order, optional coalescing scope/key and urgency/settles/ends, insertion generation. Initial extraction must retain v1 shells→agents→services→plugins→subscriptions→operator ordering and legacy steering prefix, rather than switching to strict global time FIFO.
- **Acknowledgement effects:** source receipt/ack/release, API receipt ack distinct from model-delivery ack, onCommitted delivery bookkeeping (child deliveredAt, terminal subscription completion), cancellation/disown/orphan reassignment behavior. Keep closures in adapters, not serialized item data; portable item has stable ack token and adapter resolves effects.
- **Editability/reservation:** queue identity, editable/takeback policy, reservation status. Operator-only user edits need continued support.
- **Lifetime/dedupe:** nudge lifetimeSteps, replay ID/dedupe scope, producer terminal generation; avoid global dedupe by shellId/serviceId because later legitimate occurrences/generations exist.

### Minimal universal operations

1. `accept(item)` is **the** entry seam for all producers, including another agent's outputs. Optional accept of already-persisted event reference handles API hydration without synthesizing new speech.
2. `prepare({agentId, boundary, signal}) -> Batch` captures eligible items and returns deterministic drafts/context transforms, wakes/continuation decision, ack/release token. Batch preserves causal event bundles and queue reservations.
3. `commit(batch, append)` appends once, then acknowledges; release on abort/error. Persistence belongs behind a record port, not filesystem/pod code in agent package. Preserve ability to flush without starting a model call.
4. `registerDriver({blocked, run})`, change subscriptions, per-agent hold and global/refcounted gates own idle scheduling. Driver is the same interface for main/sub/teammate; host supplies policy/capabilities.
5. Correlated response/control ingress is part of same typed entry surface but routed by mode to pending dispatch/control state, never concatenated into model chat. This avoids a fake 'single seam' that still needs secret-answer/stop side doors, without leaking secrets or changing cancellation semantics.

### Compatibility constraints for slice 2

- Do not replace specialized event payloads with `user-said`; notice rendering, lifecycle projection, turn-taking, hook context slots, nudge lifetime and attribution all depend on types.
- Preserve old append timing and phase order, including beforeTurn before pending drain and afterTurn not automatically continuing. Preserve tool-settlement-before-message-drain, concurrent safe-call result completion ordering, and retry re-drain.
- Preserve prepare/append/ack and owed-notice replay as separate from proof of model consumption; durable IDs must survive agent/pod restarts. Preserve producer-specific coalescing before ingress or express it explicitly, particularly PR batches.
- Move child queue/policy branches out of the loop: speech policy, startup brief, tools, parent routing, wake permission, and capabilities become configuration/adapters. The receiver should not switch on sender kind to choose a queue.
- Treat model wait, machine wake and attachment as execution/admission signals, not text notices, unless v1 already generated model input for that exact condition.
- Keep surface transport replay outside agent implementation: sendId ack sets, API durable intent, remote hydration and pod provisioning feed the same host-to-agent accept path.
- Tests required before replacement: arrival-before-delivery crash, append throws-after-land, late notice during assistant-only completion, retry consumes new messages, tool batch blocks pending drain, passive progress, teammate normal ending, held child shell wake, failed child wake refusal, overlapping gates/reservations, PR key replacement and terminal flush, imported child input, operator secret duplicate/cancel/partial delivery, beforeTurn skill selection order, and afterTurn hook noncontinuation.

## 5. Boundaries and remaining uncertainty

This is a production-source census of harness intake and its immediate callers, not every historical event type. No universal order/exactly-once guarantee is inferred from queue names. Existing plugin extension points can add further source implementations at runtime; all must obey the documented source/prepare contract, but external plugin bodies are not present to enumerate. Internal plugin and subscription mechanisms were read.

No active generic `model-recovered` notice producer, live harness approval-answer writer, or live background-shell-still-running writer was found in the searched production TS; core compatibility schemas/projectors alone are not producers. Remote API creation of durable operator events is outside requested harness scope; the send adapter, import adapter and actual loop wake handoff were traced, but this report does not claim to audit API transaction semantics. Hook beforeRequest and beforeStep prompt transforms cannot honestly be described as queued log notices; unifying ingress requires a typed phased contribution or preserving those hooks alongside intake until the corresponding extraction is specified.
