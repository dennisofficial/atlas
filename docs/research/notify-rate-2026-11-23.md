# v2 push rate, 2026-11-23

Read-only measurement for [notify-when-needed](../slices/notify-when-needed.md). Source: production
`v2."V2Event"`, `v2."V2InboxEntry"`, `v2."V2Session"` (SELECT only), and trigger.dev `notify-send`
runs. Window: 24 h to 2026-11-23T17:40Z, unless named.

## Method

Per session, replay in time order the open sets of `background-shell-started/ended` (by
`shellId`), `agent-spawned/restarted/ended` (by `agentId`), `subscription-created/ended` (by
`subscriptionId`) and `tool-parked` → `tool-result` (by `callId`). Take the sets at each
main-thread `turn-ended`. A wake is the next main-thread `turn-started`. A Dennis message is an
inbox entry of kind `message` with no sender session.

## Turn ends

| Measure                                     | 24 h               | 7 d                |
| ------------------------------------------- | ------------------ | ------------------ |
| Main-thread `turn-ended`                    | 1268               | 1901               |
| completed / failed / stopped / interrupted  | 1172 / 80 / 15 / 1 | 1798 / 82 / 20 / 1 |
| Dispatch `notify-send` (completed + failed) | 1252               | 1880               |
| Sub-agent thread `turn-ended`               | 0                  | 0                  |

## Open work at a completed turn end

| Measure                                          | 24 h           | 7 d             |
| ------------------------------------------------ | -------------- | --------------- |
| With ≥1 open item                                | 793 (68%)      | 1244 (69%)      |
| shell / agent / subscription open (overlap)      | 82 / 349 / 505 | 161 / 572 / 776 |
| Opened in that same turn                         | 389            | 599             |
| Parked durable wait open                         | 0              | 0               |
| Woke within 5 min, with open work                | 69%            | 68%             |
| Woke within 5 min, nothing open                  | 50%            | 47%             |
| Next 5 min held a Dennis message, with open work | 21%            | 23%             |

Wake delay after a completed turn, 24 h:

| Open at the end            | ≤1 min | ≤5 min | ≤10 min | ≤15 min | ≤60 min |
| -------------------------- | ------ | ------ | ------- | ------- | ------- |
| Only subscriptions (406)   | 88     | 254    | 352     | 379     | 388     |
| A shell or sub-agent (387) | 153    | 293    | 338     | 352     | 378     |

## Who gets the pushes

- 680 of 1252 dispatches (54%) come from 42 nested teammate sessions.
- 1062 (85%) fall within 60 s of a dispatch from another session. Most in any 5 min: 85.

## Pushes actually sent

- No table records a v2 send. `notify-send` returns `{sent, gone}` only.
- trigger.dev: 1047 `notify-send` runs from 04:23Z to 18:56Z. A sample of 175 run outputs had
  `sent = 0` in every run (161 finished, 13 failed, 1 waiting).
- Cause: Dennis set `web.notifications.event.finished.push = false` at 06:39Z. His only enabled
  device is one Web Push subscription (registered 06:39Z). Runs before 06:40Z (473) carry no
  payload in the API output, so they cannot be read back.

## Simulated rules, 24 h

Hold a "finished" push while work is open; drop it if the agent wakes before the hold ends.

| Rule                                                | Pushes         | In a 60 s burst |
| --------------------------------------------------- | -------------- | --------------- |
| Today                                               | 1252           | 1062            |
| Hold 5 min (subscription) / 60 min (shell, agent)   | 620            | 491             |
| Hold 10 min / 60 min                                | 522            | 406             |
| Hold 15 min / 60 min                                | 495            | 379             |
| 10 / 60 + nested sessions only for an operator turn | 443            | 326             |
| Same, first push per 60 s makes a sound             | 443 (226 loud) | —               |

Of the 322 top-level "finished" pushes left, 108 had a live teammate; 84 of those woke within
10 min.

## Caveats

- Presence ("on screen", "in Atlas") cannot be replayed, so real pushes are lower than dispatches.
- 167 subscriptions in the 8-day log never ended (PR subscriptions live for the PR), so old
  subscriptions count as open at later turns. The 10 min hold caps that.
- Inbox `threadId` is empty, so wakes are matched per session.
- Some canonical event JSON is invalid (`\u0000`); fields were read by regex from raw text.
