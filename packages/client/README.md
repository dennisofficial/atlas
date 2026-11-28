# @dltech/atlas-client

The headless client library that web, the TUI and the mobile app share.

## Owns

- The stream connection: follow a session, follow the session list, and reconnect with a watchdog.
- The client session log: one snapshot plus the events after it, in memory or in IndexedDB.
- The session window, the overlay of live steps, and the derived session views.
- The pod channel: the delta channel over a websocket, its frame codecs and its request timeouts.
- The transcript model: the rows of a turn, the tool runs and the thinking folds.
- The crew readout and the sidebar partition: sub-agent state, background work, teammate nesting.
- The session rewind, the composer image upload and draft, the message input and the device login.
- The chat step types for the AI SDK.

## Does not own

- Frame and payload schemas, the channel protocol: `@dltech/atlas-wire`, `@dltech/atlas-protocol`.
- Records and the API transport: `@dltech/atlas-control`, `@dltech/atlas-api-router`.
- The visual components, their styles, and the held composer state that a surface draws.

## Entry points

| Import                                          | Use it for                                                                                                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@dltech/atlas-client/stream`                   | The stream connection, the session follower, the log, the window and the overlay.                                                                                             |
| `@dltech/atlas-client/channel`                  | The pod delta channel, the frame codecs and the tool requests.                                                                                                                |
| `@dltech/atlas-client/chat`                     | The chat transport, the step chunks and the step messages.                                                                                                                    |
| `@dltech/atlas-client/crew`                     | The crew readout, the sub-agent state and the background work.                                                                                                                |
| `@dltech/atlas-client/session`                  | The session create input, the rewind, the summarise, the image upload, the composer attachments, the message input, the draft sync and the sandbox start view.                |
| `@dltech/atlas-client/account`                  | The Atlas Cloud device-code login and the PKCE pair a browser sign-in needs.                                                                                                  |
| `@dltech/atlas-client/settings`                 | The settings page and section lists, and the agent, models, appearance, instructions, memory, skills, notifications, project, group, sandbox and pull-request settings logic. |
| `@dltech/atlas-client/browser-return`           | The outcomes a browser sign-in brought back, held by the state of its start link.                                                                                             |
| `@dltech/atlas-client/transcript`               | The transcript rows, the tool runs and the turn rows.                                                                                                                         |
| `@dltech/atlas-client/stream-fixture`           | A fake scheduler and transport, and the event factories, for a spec.                                                                                                          |
| `@dltech/atlas-client/transcript-fixture`       | The event drafts and the step signals of a transcript, for a spec.                                                                                                            |
| `@dltech/atlas-client/transcript-tool-fixture`  | The tool call and result drafts, for a spec.                                                                                                                                  |
| `@dltech/atlas-client/transcript-tools-fixture` | A sample tool call and shell call, for a spec or a prototype.                                                                                                                 |

## Capabilities

### Follow a session

- `createStreamConnection({ transport, scheduler, networkSignal?, eventSchema?, knownEventTypes?, views? })`:
  the `StreamConnection`. `follow({ sessionId, threadId?, log? })` follows one thread (main by default),
  and a reopen of one of the last 8 closed follows shows it at once; `followSessions()` is the list.
- `createSessionFollower(args)`: a session's follower, its `SessionSnapshot` and its
  `ESessionConnection` state. `HYDRATE_TIMEOUT_MS` bounds the first load.
  `createSessionsFeed({ follow, write })` holds the list.
- `StreamTransport`, `StreamScheduler`, `StreamNetworkSignal`, `systemStreamScheduler`,
  `browserNetworkSignal`: the ports that a surface supplies.
- `nestPeers(rows)` nests each teammate under its spawner. `peerBucketOf({ row })` and
  `EPeerBucket` give a row's bucket; `splitTeammates(rows)` gives its active and done teammates.
  `isRecentProject(args)`, `lastActivityAt(args)` and `RECENT_PROJECT_WINDOW_MS` keep new projects.

### List settings

- `accessGrantNameValid`, `accessGrantDraftValid`, `secretNameInvalid` and `secretDraftValid`: shared grant and secret form predicates. The grant draft adds length limits to the web form's name predicate.
- `beginRevealRequest`, `cancelRevealRequest`, `revealRequestPending` and `acceptRevealRequest`: the reveal request state machine. Cancelled or superseded results cannot be accepted.

- `ESettingsPage`, `SETTINGS_NAV`, `labelOfPage(page)`, `filterNav({ groups, query })`: the user-level
  settings pages, in nav groups, labelled and searchable. `filterNav` keeps whatever a surface adds
  to an item, such as its icon.
- `EProjectSettingsSection`, `PROJECT_SECTIONS`: the project settings sections in web order.
- `EGroupSettingsSection`, `GROUP_SECTIONS`: the group settings sections, which inherit the project
  sections and add the group-only ones.
- `ESettingFieldKind`, `ISettingField`, `fieldValuesFrom({ fields, values })`, `fieldChanges({ saved, draft })`:
  the toggle, choice, range and text rows a settings page renders, read from and diffed into flat
  setting keys. `CONTEXT_FIELDS`, `EXPERIMENTAL_FIELDS`, `QUALITY_FIELDS` and
  `qualityFieldsOf(policies)` are the field lists the Agent, Experimental and Code Quality pages share.
- `appearanceFrom(values)`, `appearanceChanges({ saved, draft })`, `colorSchemeOf(theme)`:
  the `web.appearance.*` settings, the changes to write, and the colour scheme a theme asks for.
  `THEMES`, `DENSITIES` and `CODE_FONT_SIZES` are their options.
- `agentSettingsFrom(values)` and `agentSettingsChanges({ saved, draft })`: the `images.model`
  setting, with `IMAGE_MODEL_ITEMS`.
- `routineSettingsFrom(values)`, `routineSettingsChanges({ saved, draft })`, `ROUTINE_TIMEZONE_KEY`:
  the default routine timezone.
- `PAGE_ROLES`, `ROLE_GROUPS`, `roleTitleOf(role)`, `roleTipOf(role)`, `resolveRoles({ draft, models })`,
  `choiceOf`, `staleOwnerOf`, `ownsModel`, `affectedOf`: the model roles a Models & Effort page
  lists, the copy it shows and the model, effort and fast each role resolves to.
- `modelsDraftFrom(values)`, `modelsChanges({ saved, draft })`, `pickedModelDraft`, `effortDraft`,
  `fastDraft`, `followedDraft`, `unfollowedDraft`: the per-role draft and the flat changes it saves.
  `unfollowedDraft({ draft, role, inherited })` keeps the resolved model, effort and fast when a role stops following.
- `settingValue`, `settingString`, `settingBool`, `diffChanges({ saved, draft })`: read a flat setting
  from its registry entry, and diff two flat records into the keys to patch.
- `INSTRUCTIONS_CHAR_LIMIT`, `instructionsOf({ files, path?, decode })`, `charCountOf({ length, limit })`,
  `canSaveInstructions(args)`: one instructions document, its character budget, and whether a save is
  allowed. The page descriptions travel with them.
- `skillUsageKeyOf(target)`, `skillUsageTargetOf(layer)`, `withSkillUsage({ skills, usage })`:
  cache keys and scope mapping for the separate `skills.usage` query. Merge counts without
  blocking the list or losing inherited-layer metadata. Pending or failed usage leaves each
  summary's `usagePending` marker intact; a received count clears it. Built-ins use personal usage.
- `EMemoryScope`, `EMemoryType`, `MemoryEntry`, `MemoryScopeGroup`, `MEMORY_TYPE_LABELS`,
  `buildMemoryGroups({ memories, groupNames })`, `memoryMatchesFilter({ entry, query, type })`,
  `memoryScopeOptionsOf(groups)`, `memoryScopeHintOf(group)`, `memoryClearDescriptionOf(group)`,
  `memoryKeyInput(key)`, `formatMemoryDate(updatedAt)`: the memory scopes, their rows, and the copy
  around them. `selectedMemoryNamesOf({ selected, memories })`, `memorySelectionOf({ selectedNames, name, selected })` and `memoryDeleteTitleOf(count)` share bulk selection and deletion copy.
- `pickedAdditionalRepository({ repositories, mainRepository, index, value })` applies a repository picker result to an overview draft, rejects duplicate or malformed names, and keeps the additional-repository limit.
- `repoChoices({ repos, query })`, `parseRepoInput(raw)`, `additionalRepoChoices({ repos, query, taken })` and `repositoryPickerChoices({ repos, query, taken })`: search GitHub repositories, accept pasted GitHub links, and exclude repositories already used by a project. The picker excludes all taken names, even when they match the search exactly.

### Read skills

- `matchesSkill({ skill, query })`, `orderSkills({ skills, sort })`, `cycleSkillSort({ current, key })`,
  `ariaSortOf({ sort, key })`: search, order and the ascending, descending, off cycle of a skills list.
  `ESkillSortKey`, `ESortDirection` and `SkillSort` are its model.
- `personalSkillTarget`, `projectSkillTarget({ projectId })`, `groupSkillTarget({ groupId })`,
  `skillsDescriptionOf(target)`: the `skills.*` router input for each scope, and the copy that says
  where that scope's skills load.
- `skillNameIsValid({ name })`, `SKILL_NAME_PATTERN`, `MAX_SKILL_NAME_LENGTH`, `EMPTY_SKILL_MD`,
  `SKILL_ENTRY_PATH`: a new skill's name rule, and the bare `SKILL.md` it starts as.
- `newSkillFileOf({ target, name, hashOf })`: the `skills.put` payload that creates a skill as its
  bare `SKILL.md`, hashed by the surface's own SHA-256.
- `visibleSkillsOf({ skills, query, sort })`, `liveSelectedOf({ selected, visible })`,
  `skillIsSelectable(skill)`: the rows a list shows, the selection that still matches them, and the
  built-in skills no delete can reach.
- `skillUsageViewOf({ skill, now })`, `skillRelativeTimeOf({ iso, now })`, `SkillUsageView`: a row's
  usage text, its last use as a relative time, and "Never used". Pending or failed usage reads "—".
- `buildSkillTree(paths)`, `defaultSkillPath({ metas })`, `skillFileTargetOf`, `skillFilePathProblem`, `skillPathContains`, `skillRenamePlan`: the skill file tree, initial selection and validated file operations shared by web and iOS.
- `skillFileWriteOf`, `saveSkillTextWith`, `isSkillConflict`: hashed file writes and revision-conflict recovery through surface-supplied read, write and hash ports.
- `initialSkillEditorState`, `skillEditorReducer`, `ESkillEditorAction`, `skillDetailIsReadOnly`: the text draft, discard/save/conflict transitions and built-in protection.
- `toBase64Utf8`, `fromBase64Utf8`, `base64OfBytes`, `bytesOfBase64`: a skill file's payload.
- `formatBytes(bytes)`, `formatSkillDate(updatedAt)`, `fileKindOf(path)`, `ESkillFileKind`,
  `SKILL_PRECEDENCE_COPY`: how a skill row reads.
- `inheritedTitleOf(ref)`, `overriddenLabelOf(layer)`, `overridesLabelOf(layer)`, `originNounOf(ref)`,
  `layersBelowOf(layer)`, `shadowedBelowOf(args)`, `inheritedIdsOf(args)`, `LayerRef`: how an inherited
  layer, its owner and its shadow are named.

- `NOTIFY_MOMENTS`, `notifyEventKey(moment)`, `NotificationSettings`, `notificationsFrom(values)`,
  `notificationChanges({ saved, draft })`, `withDeviceZone(settings)`, `QUIET_HOUR_OPTIONS`,
  `NOTIFY_TIMEZONE_KEY` and the quiet-hour keys: the notification moments, quiet hours and their
  time zone. `NOTIFY_DEVICE_KIND_LABELS`, `notifyDeviceDetailOf({ kind, enabled })`,
  `withDeviceEnabled(args)`: a registered device's row and its pending switch.
- `timezoneNames()`, `timezoneChoicesOf({ query, selected })`, `deviceTimezone()`: the time-zone
  list, common zones first, searched as a user types.

### Provider accounts and classifier

- `PROVIDER_CATALOGUE`, `providerGroupsOf`, `providerAccountDetailOf`, `providerKeyMaskOf`, `planNameOf`: provider choices, account groups and account labels.
- `EKeyDialogMode`, `providerKeyReady`, `providerKeyResult`: API-key form validation and trimmed save values.
- `createProviderSignIn`, `EProviderSignInState`, `pollSignInUntilSettled`: the paste-code and device-code sign-in state machine, with surface-supplied API, browser and clock ports.
- `providerUsageWindowsOf`, `providerUsageAgeOf`: plan usage meter values and stale-read text.
- `classifierSettingsFrom`, `classifierChanges`, `classifierModelItems`, `classifierAvailabilityIn`, `classifierStatusOf`, `classifierSuggestionOf`, `classifierFeaturesOf`, `classifierTestLineOf`: classifier drafts, availability, suggestions and status text.

### Access grants, secrets and file mounts

- `accessFileValidation`, `AccessFileDraft`, `EditingFile`: shared file draft validation and save payload, including scope path rules, byte limit and permissions.
- `parseFileMode`, `formatFileMode`, `DEFAULT_MODE_TEXT`, `pickerChoices`, `TreeEntry`: octal mode labels and ranked repository path suggestions.

- `createAccessMemberApi({ api, scope })`: select personal, group or project secret and file operations using a surface-supplied transport.
- `scopeKeyOf`, `moveTargetsOf`, `grantMoveBranchesOf`, `deleteGrantDescription`: grant identity, move destinations and delete confirmation copy.
- `accessGrantSaveOf`, `accessGrantMatchesQuery`, `accessGrantSummary`: grant save payloads, case-insensitive search and member count labels.
- `SECRET_NAME`, `parseEnvLines`, `SecretPair`: secret name validation and .env bulk parsing, with invalid line numbers.
- `accessScopeOfParams`, `accessParamsOfScope`: round-trip scope through settings routes.

### Read an account and its signed-in devices

- `createAuthAccountApi({ baseUrl, token, fetchFn })`: the better-auth REST calls a surface makes
  with a bearer token — the current session, the name, the sessions, the sign-in methods, the unlink,
  the revoke and the reset-link request. `AuthAccountError` carries the status and the code.
- `relativeTime({ from, now })`, `shortDate(iso)`, `monthYear(iso)`: elapsed and calendar labels.
- `deviceNameOf(userAgent)`, `deviceKindOf(userAgent)`, `toDevice(args)`, `signedInDevicesOf(args)`
  and `EDeviceKind`: one session row, its device name and kind, and the current device first.
- `signInMethodsOf(accounts)`, `signInMethodRowsOf({ methods, busy })`, `ESignInMethodAction` and
  `ESignInMethodProvider`: which methods a user has, and the two rows a settings page shows.
- `linkReturnOf(params)`, `ELinkReturnKind`: the outcome a Google link came back with.
- `unlinkRefusalOf(args)`, `SESSION_NOT_FRESH`, `UNREACHABLE`: the refusals a settings page names.

### Read MCP and GitHub settings

- `McpScope`, `mcpServersInputOf({ scope })`, `mcpServerPutInputOf({ scope, draft })`,
  `mcpOauthScreenOfScope(scope)` and `mcpOauthServersInputOf(scope)`: the layer an MCP page reads and
  writes, and the screen its sign-in returns to, at user, project or group scope.
- `rowOfServer`, `targetOf`, `transportOfDraft`, `upsertOfDraft`, `upsertOfServerDraft`,
  `upsertOfToggle`, `serverIdOf`, `mcpDraftIsValid`: the server row and the payload a settings form
  writes. `splitCommandLine`, `joinCommandLine` and `parseKeyValueLines` are the command and
  key-value text a form reads.
- `EMcpAuthState`, `authStateOf`, `cloudServerOf`, `repoServersOf`, `lastUsedOf`,
  `mcpServerLabelOf`, `mcpResultMessageOf`, `mcpSignInResultOf`, `unreachableSignInResult`: what a
  server row says about its grant, and the message a browser return shows. `relativeTimeOf({ iso,
  now })` is the relative time a row prints.
- `pollUntilSettled`, `githubFailureOf`, `githubCapabilitiesOf`, `githubLoginOf`, `GITHUB_REPO_SCOPE`
  and `GITHUB_ORG_SCOPE`: the GitHub device-code flow and what a connection grants.

### Edit a project or a group

- `overviewDraftOf(project)`, `overviewSaveBodyOf({ project, draft })`, `overviewDraftsEqual`,
  `overviewDraftIsValid`, `identityOf(project)`, `shipOptionsOf(behavior)`: the project overview
  draft, its save body and its ship-behavior options, legacy merge included.
- `additionalRepositoryProblem({ value })`, `canAddAdditionalRepository`,
  `addAdditionalRepository`, `editAdditionalRepository`, `removeAdditionalRepository`: the
  additional-repositories list, capped at the wire limit.
- `groupNameProblem({ name })`, `groupMembersOf`, `groupCandidatesOf`, `groupMemberSummaryOf`,
  `GROUP_DESCRIPTION`, `GROUP_DELETE_DESCRIPTION`: a group's name rule and its membership.
- `SANDBOX_SETTING_KEYS`, `inheritedSandboxOf`, `ownValuesOf`, `sandboxOfValues`,
  `sizeSettingValuesOf`, `diskSettingValuesOf`: a sandbox's own and inherited size and disk.
  `savedSizeValueOf`, `sizeValueToSave`, `savedDiskValueOf`, `diskValueToSave`,
  `sandboxSizeOptionsOf`, `sandboxDiskOptionsOf`: its selections and the options including the
  account default. `DEFAULT_SANDBOX_SIZE`, `defaultDiskGbOf`, `sizeKeyOf`, `INHERIT_VALUE`.
- `prCommentEditorsOf(values)`, `prCommentEditorChanges({ draft })`, `MUTED_EDITORS_KEY`,
  `URGENT_EDITORS_KEY`, `settingChangeOf`: the muted and urgent pull-request comment editors.

### Keep the log and the view

- `memorySessionLog()`, `browserSessionLog(eventSchema)`, `createIndexedDbSessionLog(args)`: the
  `SessionLog` implementations. `createSqliteSessionLog({ db })` keeps one behind a `SqliteExecutor`.
- `SessionWindow`, `applyPage`, `applyPageOutcome`, `RENDER_LIMIT`, `OLDER_PAGE`: the paged window.
- `applyOverlayMessage`, `closeOverlay`, `closeOverlayForEvents`, `EMPTY_OVERLAY_STATE`: the live
  step overlay. `overlaySignalsOf` and `overlayRewrote` give its step signals, append or rewrite.
- `derivedViewOf`, `deriveViewOf`, `deriveStatusOf`, `frameFactsOf`: the view of a followed session.
  `sessionDisplayOf`, `isSessionUnreadOf`, `startFailureOf`: the status, unread mark, start failure;
  `blockingCommandOf`, `elapsedClockOf`: the command that holds the next turn, and its clock.

### Read the pod channel

- `createRemoteDeltaChannel(args)`: the delta channel to a pod's live session stream. `webSocketFactory`,
  `sessionSocketUrlOf`, `ChannelSocket`: the socket adapter. `encodeFrame`, `decodeClientFrame`, `EServeFrame`, `EClientFrame`: the client side of the frame codec.
- `listSubscriptions({ channel })`, `subscribeTo(args)`, `setSubscriptionStatus(args)`,
  `unsubscribeFrom(args)`, `readGitChanges({ channel, scope })`: the requests on a `RequestChannel`.
- `EClientRequest`, `ChannelSignal`, `StepSignal`, `TurnOutcome`, `InFlightSlots`: the request names, the signals, a turn's outcome and the in-flight slots.

### Build the transcript

- `deriveTranscript(args)`, `assembleTranscript(args)`, `durableEntries(args)`, `TranscriptEntry`,
  `EEntryKind`: the transcript rows and the durable rows of a thread; `pluginEntries` adds a plugin's
  rows. `summariesAtTarget(events)`: the events with each compaction summary at its target.
- `turnsBySeq(args)`, `settledAtOf(entries)`, `turnEndedEntry(turn)`: the turn rows and the settled
  time. `turnStartedAtOf({ events, status? })`: the open turn's start, or a queued session's `since`. `TurnSpend`, `totalSpend`, `SpendTotals` and `NOTHING_SPENT`: what a turn spent.
- `ECallState`, `ECallKind`, `callKindOf(name)`, `ToolCall`, `ToolRun`, `attachmentsOf`: the tool
  runs and their attachments. `agentsOf(args)`, `agentOf(args)`, `agentLabelOf(agent)`: a
  sub-agent's type, intent, state.
- `noticeEntriesOf(event)`: one event's notice rows. `thinkingVisibilityOf`, `foldThoughts`, `toolsAboveThoughts`: the folds.
- `revealedText({ key, text, gate })`, `runAttentionOf(args)`, `plural(many, one, rest?)`,
  `formatElapsed(ms)`: the revealed text and the helpers that a surface also uses. `stabilisedEntries(args)`: an unchanged entry carried onto its previous identity, and `stabilisedBy(args)` for a row.
- `entryKeyOf({ eventId, part })`, `eventIdOfEntryKey(key)`: the key of one part of an event's
  entries, and the event id back from a key.

### Feed the chat transport

- `createSignalChatTransport({ now })`: returns a `SignalChatTransport` for the AI SDK.
  `absorb(signal)` adds a step signal to a stream and `dropAll()` closes every stream;
  `stepsOfMessages(messages)` gives the in-flight steps of an `AtlasStepMessage` list.

### Read the crew

- `crewRowReading(row)`, `subagentReading(subagent)`, `subagentStateLabel(args)`,
  `subagentContextLabel(args)`: the state and the label of a sub-agent. `crewActivityOf(args)`,
  `shellBusyThreads(rosters)`, `backgroundWaitLabel(args)`, `journalActivityOf(events)`,
  `lastVisitOf` and `recordDeparture`: the activity and the visits.

### Rewind a session

- `seqByEventIdOf(events)`, `rewoundMessageOf(args)`, `rewindLanded(args)`, `rewindRefused(args)`,
  `rewindKillsOf(args)`, `mergedDraftOf(args)`: the picked message, its sequence, the draft ahead of the composer, and the work the rewind stops.
- `restorePlanOf(attachments)`, `requestRewind(args)`: the attachments back in their composer
  stores, and the queued command. `RewindApi`, `RewoundMessage`, `RestorePlan`, `RestoredMedia`,
  `RewindKillRow`: the types. `quickStopRestoresOf(args)`, `quickStopRestoresToApply(args)`: the composer text and attachments that a quick stop gives back, one `QuickStopRestore` for each rewind.

### Summarise a session

- `summarisePointsOf(events)`, `summariseCopyOf(pick)`, `requestSummarise(args)`: the messages a
  summary can reach up to, the confirm copy, and the queued command. `SummariseApi`,
  `SummariseCopy`: the types.

### Start a session and upload a composer image

- `sha256Hex(bytes)`, `supportedMediaTypeOf(mediaType)`, `storeImage(args)` (optional `hashOf`
  without `crypto.subtle`): hash, type, presign-put-confirm. `messageInputOf(args)`,
  `postInputOf(args)`: draft and post input. Ports: `MediaUploadApi`, `PutImage`, `UploadHandle`.
- `EAttachmentStatus`, `HeldStatus`, `OCTET_STREAM`, `MAX_UPLOAD_MB`: the held attachment type and
  its limits. `planAttach({ files, held })`: `accepted`, `oversize` and `droppedOverflow`.
  `withProgress`, `withFailed`, `withoutAttachment`, `readyAttachments`, `isUploading`, `hasFailed`: the holder updates. `TOO_MANY_FILES`, `REMOVE_FAILED_FILES`, `tooLargeNotice(name)`, `uploadFailedNotice(name)`: the notices.
- `sessionCreateInputOf(args)`, `initialProjectIdOf(args)`: a new session's create input and project. `sessionBootViewOf(args)` gives the sandbox start steps, `bootViewAt(args)` ticks a running start to `now`, and `BootView` types them.
- `composerSendStateOf`, `contextPercentOf`, `createDraftSync(args)`: send, context, draft write.
- `queuedMessagesOf`, `queuedNoticesOf`, `stagedQueuedMessagesOf`, `optimisticPlacementOf(args)`: the queued rows. `WithdrawTarget`, `WithdrawIntent` (a target plus the request id it was minted for), `WithdrawSettlement`, `withdrawSettlementsOf(args)`, `withdrawRefusalNoticeOf(reason)`: the Edit or Remove of one queued row, settled by the durable `input-withdrawn` or `input-refused`. `requestWithdraw(args)`, `createWithdrawStore()`, `withdrawStore`: the withdraw request and the in-memory per-session intents that hide a row until the settlement for its target arrives; an answer that belongs to an older request for the same target leaves the newer intent held. `operatorSaidOf(said)`, `withdrawOwnedInboxIdsOf(args)`: the messages the operator owns, so the withdraw path alone restores the text and reports a refusal. `ToolPicture` and `firstPictureIn(args)` (in `transcript`) read the media ref a tool result carried.

### Sign in to Atlas Cloud

- `beginCloudLogin(args)`, `pollCloudLogin(args)`: the device-code ticket and the poll outcome.
  `CLOUD_CLIENT_ID`, `CloudLoginTicket`, `ECloudLoginPoll` and `CloudLoginOutcome` are the grant and its types. `DeviceLoginError` carries the HTTP `status`, `0` when the host is unreachable.
- `createPkcePair()`: `{ verifier, challenge, state }` for an RFC 7636 sign-in — a 32-byte verifier
  and its S256 challenge, both unpadded base64url, from Web Crypto so every surface can mint one.
  `pkceChallengeOf(verifier)` computes the challenge alone.

### Keep a browser return

- `createReturnStore()` gives a `ReturnStore`: `read(state)`, `remember({ state, outcome })` and
  `subscribe(listener)`. `browserReturns` is the store of the tab or the app.
- A sign-in flow remembers the outcome the browser brought back under the state of its start
  link, and a card reads it with `read(state)`. `returnOutcomeOf` in `@dltech/atlas-core` picks
  the durable outcome over the kept one.

## Usage

From `apps/web/src/features/sessions/data/session-stream.ts`:

```ts
const connection = createStreamConnection({
  transport: sessionStreamTransport({ client: api, surface: EStreamSurface.Web }),
  scheduler: systemStreamScheduler,
  eventSchema: sessionEventSchema,
  knownEventTypes: sessionEventTypes,
  views: sessionViews,
})
connection.connect()
```

## Rules

- Import a `-fixture` subpath in a spec, or in a prototype. Do not import it in a product path.
- Supply the stream transport and the scheduler. The stream connection opens no socket of its own;
  `createRemoteDeltaChannel` opens the websocket to the pod, through the socket factory.
- Pass the events through the protocol schema of the surface, which the log and the connection take
  as an `eventSchema`. Keep the derivation pure: a transcript or a view is a function of its inputs.
- Send a message through the channel. `SignalChatTransport.transport.sendMessages` throws.

## See also

- `docs/decisions/0024-v2-realtime.md`: the stream, the resume by sequence and hash, the overlay.
- `docs/decisions/0020-v2-sub-agent-worktrees-and-peer-sessions.md` describes the crew.
