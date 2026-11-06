## What changed

<!-- What a reviewer needs to know, in a few lines. -->

## Testing

<!-- What you ran, and what you tried by hand in which clients. -->

## Checklist

<!-- Keep every line. Tick a box only when it is done. If a line cannot apply, tick it and add "(N/A: <reason>)" after it. -->

- [ ] The change works on every client: web, Mac, mobile and TUI
  - [ ] Every client it does not support is named here, with the reason
  - [ ] Each of those exceptions is documented in `docs/` (link it here)
- [ ] Code quality
  - [ ] Tests added and passing (`bun test` inside each touched package)
  - [ ] Feature logic lives below the surfaces; no client reimplements it
  - [ ] No comments, `as any`, `@ts-ignore` or `@ts-expect-error`, and no file over 300 lines
- [ ] Release
  - [ ] The PR title type sizes the release (`feat` only for something a user can do that they couldn't before)
  - [ ] Setup-breaking changes are called out above
  - [ ] An API change the released serve or TUI can't talk to is titled `fix` or `feat`
