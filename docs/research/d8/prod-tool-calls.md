# d8 — Production tool-call sizing for off-box agent loop

Read-only production queries (all wrapped in `BEGIN READ ONLY; … ROLLBACK;`, via
`bunx dotenvx run -f envs/.env.api.production.enc` in `apps/api`, psql with
`sslmode=verify-full&sslrootcert=system`). Run on 2026-11-02 ~19:04 UTC.
Window: last 30 days (`at >= now() - interval '30 days'`).

## Schema findings (relevant to the queries)

- `Event` (`packages/db/src/prisma/schema/threads/event.prisma`): `runId`, `parentRunId`,
  `depth`, `at`, `type`, `body` (JSON string), `seq` per `threadId`.
- `Turn` table exists but is **stale**: only 170 rows, all 2026-09-24 → 2026-09-26, zero rows
  in the last 30 days. Not usable; turns must be derived from `Event`.
- **`runId` does not segment turns**: a long-lived run spans many user messages (one sampled
  thread: a single `runId` covering dozens of tool calls interleaved with several `user-said`
  events). Turn boundaries are derived by partitioning events within a thread by cumulative
  count of `user-said` events over `seq` (each `user-said` opens a new segment; the segment
  containing the `user-said` is the turn). 2,742 `user-said` events / 2,730 distinct runIds in
  30d confirm this matches user-message count.
- `depth` is 0 for **all** 303k events in the window — sub-agent runs live in their own
  threads, so sub-agent turns are not separable from main-agent turns by depth.
- `tool-called` body: `{"type":"tool-called","callId":…,"name":…,"input":{…},"ordinal":N}`
  where `ordinal` resets to 0 at the start of each model step's tool batch
  (`packages/agent/src/loop/step-drafts.ts`). So `ordinal = 0` counts = number of parallel
  tool-call batches = number of model steps that called tools.
- `assistant-said` = model output events (text/reasoning parts only; tool calls are separate
  events). 37.6k in 30d.

## Headline numbers (2,742 turns, last 30 days, 303k depth-0 events)

| Metric                                                                | p50 | p90   | p99    | max     | mean |
| --------------------------------------------------------------------- | --- | ----- | ------ | ------- | ---- |
| Tool calls per turn                                                   | 15  | 67    | 168    | 385     | 26.7 |
| Sequential batches (model steps with ≥1 tool call, `ordinal=0` count) | 10  | 40    | 123    | 361     | 17.4 |
| Model steps (`assistant-said`) per turn                               | 7   | 32    | 92     | —       | —    |
| Turn wall-clock (first→last event of segment), seconds                | 208 | 1,945 | 35,799 | 607,487 | —    |
- Turns with **0 tool calls**: 297 / 2,742 = **10.8%**.
- Mean calls per turn when ≥1 call: 30.0.
- **Parallelism is low: 1.54 calls per batch on average** — most model steps call exactly one
  tool, so tool calls per turn ≈ sequential round trips × ~1.5.

## Tool-name share (all `tool-called`, 30d, top 12 of ~70k calls)

| Tool           | Calls  | Share |
| -------------- | ------ | ----- |
| bash           | 35,234 | 48.1% |
| read           | 19,821 | 27.1% |
| grep           | 3,752  | 5.1%  |
| edit           | 2,636  | 3.6%  |
| task_write     | 1,974  | 2.7%  |
| multi_edit     | 1,876  | 2.6%  |
| write          | 1,782  | 2.4%  |
| skill          | 1,440  | 2.0%  |
| glob           | 995    | 1.4%  |
| agent_spawn    | 814    | 1.1%  |
| agent_say      | 743    | 1.0%  |
| report_to_main | 458    | 0.6%  |

Cheap reads (read+grep+glob) ≈ 24.6k = 33.5%; bash alone is 48%.

## Event-type volume (30d, for context)

tool-called 73,230; tool-result 72,968; tool-dispatched 69,500; assistant-said 37,569;
user-said 2,742. No `turn-ended` event type exists in this window (only `agent-ended`,
7,964 — a different concept).

## Caveats

- Turn wall-clock includes interruptions/parks — p99 10h and max 7d reflect parked sessions,
  not active compute. p50 (3.5 min) is the representative active-turn duration.
- Segment-based turns (not runId-based) for all stats above; see "Schema findings".
- Sub-agent threads inflate per-turn stats slightly (sub-agent turns have no `user-said` of
  their own unless reported to; their events belong to their own threads and mostly fall into
  segments only if that thread received a `user-said` — agent-spawned threads get one, so
  they're included).
- `tool-called` (73,230) > `tool-dispatched` (69,500): some calls are denied/interrupted
  before dispatch (302 `tool-denied` + interrupts).

## SQL used

Connection helper (scratch/runquery.sh):

```sh
cd apps/api && bunx dotenvx run -f envs/.env.api.production.enc -- sh -c '
U="${DIRECT_URL:-$DATABASE_URL}"
case "$U" in *\?*) SUFFIX="&sslmode=verify-full&sslrootcert=system";; *) SUFFIX="?sslmode=verify-full&sslrootcert=system";; esac
{ echo "BEGIN READ ONLY;"; cat "$SQL_FILE"; echo "ROLLBACK;"; } | psql "${U}${SUFFIX}" -q -P pager=off'
```

Event-type distribution:

```sql
SELECT type, count(*) AS n, min(at), max(at)
FROM "Event" WHERE at >= now() - interval '30 days'
GROUP BY type ORDER BY n DESC LIMIT 40;
```

Turn stats (main query):

```sql
WITH ev AS (
  SELECT "threadId", seq, at, type,
         CASE WHEN type='tool-called' AND (body::jsonb->>'ordinal')='0' THEN 1 ELSE 0 END AS batch_start,
         sum((type='user-said')::int) OVER (PARTITION BY "threadId" ORDER BY seq) AS turn_no
  FROM "Event"
  WHERE at >= now() - interval '30 days' AND depth = 0
),
segs AS (
  SELECT "threadId", turn_no, min(at) AS first_at, max(at) AS last_at,
         count(*) FILTER (WHERE type='tool-called') AS tool_calls,
         sum(batch_start) AS batches,
         count(*) FILTER (WHERE type='assistant-said') AS model_steps,
         bool_or(type='user-said') AS has_user
  FROM ev GROUP BY "threadId", turn_no
),
turns AS (SELECT * FROM segs WHERE has_user)
SELECT count(*) AS turns,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY tool_calls) AS p50_calls,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY tool_calls) AS p90_calls,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY tool_calls) AS p99_calls,
  max(tool_calls), avg(tool_calls),
  count(*) FILTER (WHERE tool_calls=0) AS zero_call_turns,
  percentile_cont(0.5/0.9/0.99) WITHIN GROUP (ORDER BY batches) …,
  percentile_cont(0.5/0.9/0.99) WITHIN GROUP (ORDER BY extract(epoch FROM last_at-first_at)) …
FROM turns;
```

Tool-name share:

```sql
SELECT body::jsonb->>'name' AS tool, count(*) AS calls
FROM "Event"
WHERE type='tool-called' AND at >= now() - interval '30 days'
GROUP BY 1 ORDER BY calls DESC LIMIT 12;
```

Calls-per-batch:

```sql
-- same ev/segs CTEs, then:
SELECT round((sum(tool_calls) FILTER (WHERE has_user))::numeric
       / nullif(sum(batches) FILTER (WHERE has_user),0), 2) AS calls_per_batch
FROM segs;  -- 1.54
```
