# Atlas v2 roadmap

Ordered slices. Status: **nothing started.** Each slice gets its own spec (goal, interfaces,
schemas, tests, file-level plan) _before_ it is built; this file holds only the order, the goal and
the exit criterion. The design is in [architecture.md](architecture.md).

Ordering rule (D7): web and mac with a cloud pod come first, because that is the daily driver and
where the incident happened. Local slices follow, and D2 (the local control plane) must be settled
before slice 7.

| #   | Slice                     | Goal                                                                                                                                                                                                               | Exit criterion                                                                                                                                                |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Design and records        | Lock the decisions; write the design docs                                                                                                                                                                          | These docs and decision [0018](../decisions/0018-v2-pod-first-architecture.md) are merged. Protocol spec and per-slice specs are written as each slice starts |
| 1   | Record core               | The durable record, inbox and leases exist as pure rules plus a storage-agnostic `control` library with a Postgres adapter in the v2 storage; settle schema-or-prefix (D6) and the append-only history events (P5) | Property tests pass for the seq-466 interleaving, stale-epoch writes, hash mismatch and append-only rewind; the v2 storage migrates cleanly beside v1         |
| 2   | Cloud pod runtime         | A cloud pod holds a lease, runs the existing loop against the record ports, appends hash-chained events and consumes the inbox                                                                                     | A cloud pod on v2 completes a scripted multi-turn session with tools; a second writer attempt at the same seq is rejected                                     |
| 3   | Views                     | Status, branch, worktree, PR links and subscriptions summary are folds in `core`, materialized by the CP at a log position                                                                                         | Every field the v1 clients derive by heuristic is a view or shown as unknown; the incident's branch and PR link appear from the log alone                     |
| 4   | Web and Mac on v2 (cloud) | Send through the inbox; transcript from the record plus direct deltas; one session stream; sidebar from view rows                                                                                                  | **First milestone:** a real cloud session on v2 from the web, with basic chat and tools, resumable after the stream drops and after a park                    |
| 5   | Features, one at a time   | Move sub-agents, shells and services, subscriptions and PR, memory, previews onto the feature-package shape (D5)                                                                                                   | Each feature, on its own, runs on v2 with its events, views, commands, runtime and control handlers registered; no feature imports another                    |
| 6   | Hardening and daily use   | Use v2 for the maintainer's own cloud work; close the gaps that surfaces                                                                                                                                           | A defined period of daily work on v2 with no manual repair of a session                                                                                       |
| 7   | Local                     | A docker pod against a control plane; then `atlasd` (D2) so the Mac host and the TUI use the same `control` library over SQLite; then the TUI on v2                                                                | A local session runs on v2 from Mac and from the TUI, offline, in exactly one control plane                                                                   |
| 8   | v1 retirement             | Remove v1 once v2 has proven itself                                                                                                                                                                                | The maintainer decides; cutover moves everything to v2 (D6)                                                                                                   |

Notes:

- Slice 5 is one spec per feature, not one spec for the slice.
- Slices 1 and 2 may overlap once the record core's interfaces are fixed in its spec.
- The v1 stopgap for the incident ships independently of this roadmap.
- The exit criteria are the bar for calling a slice done; the specs may add stricter ones.
