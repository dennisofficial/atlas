import { describe, expect, it } from 'bun:test'

import { cleanReleaseBody } from '../clean-release-body'

describe('cleanReleaseBody', () => {
  it('keeps the change lines and drops the github scaffolding', () => {
    const body = [
      "## What's Changed",
      '',
      '* fix(cloud): capture only the active worktree, not the whole worktree fleet by @dennisofficial in https://github.com/dennisofficial/atlas/pull/975',
      '',
      '**Full Changelog**: https://github.com/dennisofficial/atlas/compare/tui-v1.46.1...tui-v1.46.2',
    ].join('\n')

    expect(cleanReleaseBody(body)).toBe(
      '* fix(cloud): capture only the active worktree, not the whole worktree fleet'
    )
  })

  it('strips the attribution tail whether it links a pull url or an issue number', () => {
    expect(
      cleanReleaseBody('* feat(tui): show release notes on launch by @dennislysenko in #860')
    ).toBe('* feat(tui): show release notes on launch')
    expect(
      cleanReleaseBody(
        '- fix(serve): reattach cloud thread pointer by @dennislysenko in https://github.com/dennisofficial/atlas/pull/858'
      )
    ).toBe('- fix(serve): reattach cloud thread pointer')
  })

  it('drops what\'s-changed headings at any depth', () => {
    expect(cleanReleaseBody("### What's Changed\n\n* fix(tui): a real fix")).toBe(
      '* fix(tui): a real fix'
    )
  })

  it('drops the new-contributors section', () => {
    const body = [
      "## What's Changed",
      '',
      '* feat(tui): something by @someone in #851',
      '',
      '## New Contributors',
      '* @someone made their first contribution in https://github.com/dennisofficial/atlas/pull/851',
      '',
      '**Full Changelog**: https://github.com/dennisofficial/atlas/compare/tui-v1.31.0...tui-v1.32.0',
    ].join('\n')

    expect(cleanReleaseBody(body)).toBe('* feat(tui): something')
  })

  it('leaves unusual bodies untouched apart from trimming', () => {
    const body = '\n\nA hand-written note with no bullets.\n\n'
    expect(cleanReleaseBody(body)).toBe('A hand-written note with no bullets.')
  })

  it('collapses the blank runs left behind by removed lines', () => {
    const body = [
      "## What's Changed",
      '',
      '* feat(tui): first half by @a in #1',
      "* fix(tui): second half's details",
      '',
      '**Full Changelog**: https://github.com/dennisofficial/atlas/compare/a...b',
    ].join('\n')

    expect(cleanReleaseBody(body)).toBe(
      ['* feat(tui): first half', "* fix(tui): second half's details"].join('\n')
    )
  })
})
