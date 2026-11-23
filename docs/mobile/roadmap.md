# Atlas iOS app roadmap

The iOS app (`apps/mobile`) is a native v2 client. It catches up with web one feature at a time,
one PR per feature. The daily mobile routine takes the first unchecked item, builds it and ticks it
in the same PR.

## Product contract

- **Native, not a web port.** Use iOS patterns: native-stack headers with large titles, sheets,
  context menus, swipe actions, SF Symbols where Expo exposes them.
- **Navigation.** A native tab bar (`expo-router/native-tabs`) with the web sidebar's tabs: Threads,
  Routines, Projects, Artifacts. A tab appears when its feature ships. The tab bar appears with the
  second tab. Settings and sign-out open from the avatar button in the Threads header.
- **v2 only.** Use `@dltech/atlas-client` (stream, session follower, sessions feed) and the API
  through `@dltech/atlas-api-router`. Never import v1 (`@dltech/atlas-client/channel`, v1 tRPC
  namespaces such as `threads.*`).
- **The app presents; it decides nothing.** A rule that web and iOS both need (a status mapping, a
  grouping, a derived view) lives in `packages/client` or `packages/core`, and web uses it too.
- **Session states.** `sessionDisplayOf` in `packages/client/src/stream/session-display.ts` is the
  one mapping: Starting, Start failed (Retry), Working (Stop), Waiting for you, Idle, Parked, Failed.
- **Push.** Notifications go through the shared push port of the notifications feature. The app
  reports presence and registers its Expo token. It has no push logic of its own.

## Done for each feature

- A spec in a sibling `__tests__/` for every new rule; `bun test` passes in each touched package.
- Typecheck and Biome pass on touched files; no file over 300 lines; no comments.
- Live check on the Expo web bundle (`mobile` service in `.atlas/services.yaml`) against real
  sessions; the PR Testing section lists what was checked and the result.
- One PR with a conventional title (`feat(mobile): …` for something new). CI green, merged.

## Features

- [x] Threads home: v2-only session list, shared session states, v1 removed
- [ ] New session sheet: project, model, first message (`sessions.create`)
- [ ] Session screen basics: streamed transcript, composer, header state, Stop, Retry, queued messages
- [ ] Answer operator input: questions and approvals (`operatorRequests.answer`)
- [ ] Attachments: photos and files in the composer (`media.presign/confirm`)
- [ ] Notifications: presence and Expo token on the shared push port
- [ ] Session actions: archive, pin, withdraw a queued message
- [ ] Model and effort per session
- [ ] Changes: diff list and file diffs (`sessions.changes`, `sessions.changeContent`)
- [ ] Pod controls: sleep, wake, keep awake (`sleepPod`, `wakePod`, `holdPod`)
- [ ] Sub-agents and teammates: open a child session from the transcript
- [ ] Projects tab (brings the tab bar)
- [ ] Routines tab
- [ ] Artifacts tab
- [ ] Services and previews
