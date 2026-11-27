# Atlas iOS app roadmap

The iOS app (`apps/mobile`) is a native v2 client. It catches up with web one feature at a time,
one PR per feature. The daily mobile routine takes the first unchecked item, builds it and ticks it
in the same PR.

## Product contract

- **Native, not a web port.** Use iOS patterns: native-stack headers with large titles, sheets,
  context menus, swipe actions, SF Symbols where Expo exposes them.
- **Navigation.** A native tab bar (`expo-router/native-tabs`) with the four tabs: Sessions,
  Routines, Projects, Artifacts. Routines, Projects and Artifacts show an in-progress placeholder
  until their feature ships. Settings and sign-out open from the avatar button in every tab's
  header.
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
  sessions, at the viewports in `docs/mobile/devices.md`: the iPhone 18 Pro Max, and the iPhone Duo
  closed, open portrait and open landscape when the feature has a layout. The PR Testing section
  lists what was checked, with a screenshot of each viewport, and the result.
- Live check on an Expo iOS simulator (EAS Simulators, `simulator` profile in `apps/mobile/eas.json`)
  against the same session, opened on web beside it. Compare the two screens: every action and
  piece of information that web shows and the screen lacks is either built in the PR or added below
  as an unchecked feature. Then compare how they look: where the iOS screen looks worse than web
  in person (for example the iOS `ActivityIndicator` against the web spinner), fix it or add it
  below. The PR has the simulator and web screenshots side by side.
- One PR with a conventional title (`feat(mobile): …` for something new). CI green, merged.

## Features

- [x] Threads home: v2-only session list, shared session states, v1 removed
- [x] New session sheet: project, model, first message (`sessions.create`)
- [x] Session screen basics: streamed transcript, composer, header state, Stop, Retry, queued messages
- [x] Answer operator input: questions from `operator_input` and `operator_shell_input` (`operatorRequests.answer`)
- [x] Attachments: photos, camera and files in the composer (`media.presign/confirm`)
- Notifications: presence and Expo token on the shared push port
  - [x] 1. Presence: surface, open session and foreground on `notifications.reportPresence`
  - [x] 2. Expo token registration that always settles, retries on foreground and shows its
    outcome in Settings and PostHog (`push_registration`)
  - [ ] 3. The iPhone registers an Expo device in production and receives a push (read the
    Settings row or the `push_registration` event, fix what it names)
- [ ] Message actions on chat bubbles, as on web (`transcript-user-turn.tsx`): copy, edit a
  queued message, rewind, summarise up to here; and the time, which `SentAt` in
  `message-row.tsx` renders but Dennis does not see on the device (find out why on the simulator)
- [ ] Session actions: archive, pin, withdraw a queued message
- [ ] Model and effort per session
- [ ] Changes: diff list and file diffs (`sessions.changes`, `sessions.changeContent`)
- [ ] Pod controls: sleep, wake, keep awake (`sleepPod`, `wakePod`, `holdPod`)
- [ ] Sub-agents and teammates: open a child session from the transcript
- [ ] Projects tab
- [ ] Routines tab
- [ ] Artifacts tab
- [ ] Services and previews
