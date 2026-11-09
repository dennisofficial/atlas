import { afterEach, describe, expect, it } from 'bun:test'

import { bing, parseResults, unwrapTarget } from '../backends/bing'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

const wrapped = (target: string): string =>
  `https://www.bing.com/ck/a?!&&p=abc&ptn=3&ver=2&hsh=4&fclid=1d2e&u=a1${Buffer.from(target)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')}&ntb=1`

const result = (args: { href: string; title: string; snippet: string }): string => `
  <li class="b_algo" data-id iid=SERP.1>
    <div class="b_tpcn"><a class="tilk" href="https://www.bing.com/ck/a?!&&u=a1other">github.com</a></div>
    <h2><a target="_blank" href="${args.href}">${args.title}</a></h2>
    <div class="b_caption"><p class="b_lineclamp2">${args.snippet}</p></div>
  </li>`

describe('unwrapTarget', () => {
  it('reads the real target out of a redirect wrapper', () => {
    expect(unwrapTarget(wrapped('https://github.com/vercel-labs/agent-browser'))).toBe(
      'https://github.com/vercel-labs/agent-browser',
    )
  })

  it('passes a plain url through', () => {
    expect(unwrapTarget('https://bun.com/docs')).toBe('https://bun.com/docs')
  })

  it('drops a wrapper it cannot decode rather than guessing', () => {
    expect(unwrapTarget('https://www.bing.com/ck/a?!&&u=not-base64-url')).toBeUndefined()
  })
})

describe('parseResults', () => {
  it('reads the title, the real url and the snippet of each result', () => {
    const html = [
      result({
        href: wrapped('https://github.com/vercel-labs/agent-browser'),
        title: 'GitHub - <strong>vercel</strong>-<strong>labs</strong>/agent-browser',
        snippet: 'Browser automation CLI for AI agents.',
      }),
      result({
        href: wrapped('https://agent-browser.dev/quick-start'),
        title: 'Quick start',
        snippet: 'One command at a time.',
      }),
    ].join('')

    const found = parseResults(html)

    expect(found).toHaveLength(2)
    expect(found[0]?.url).toBe('https://github.com/vercel-labs/agent-browser')
    expect(found[0]?.title).toBe('GitHub - vercel-labs/agent-browser')
    expect(found[0]?.snippet).toBe('Browser automation CLI for AI agents.')
    expect(found[1]?.url).toBe('https://agent-browser.dev/quick-start')
  })

  it('takes the title from the heading rather than from the site link above it', () => {
    const html = result({
      href: wrapped('https://example.com/one'),
      title: 'The real title',
      snippet: 'and the real snippet',
    })

    expect(parseResults(html)[0]?.title).toBe('The real title')
  })

  it('finds nothing in a challenge page', () => {
    expect(parseResults('<html><body><p>Verify you are a human</p></body></html>')).toEqual([])
  })
})

describe('the Bing backend', () => {
  const answer = (body: string, status = 200): void => {
    globalThis.fetch = Object.assign(async () => new Response(body, { status }), {
      preconnect: realFetch.preconnect,
    })
  }

  it('slices the results to the count asked for', async () => {
    answer(
      [
        result({ href: wrapped('https://a.test/1'), title: 'One', snippet: 'first' }),
        result({ href: wrapped('https://a.test/2'), title: 'Two', snippet: 'second' }),
      ].join(''),
    )

    const outcome = await bing({
      query: 'anything',
      count: 1,
      signal: new AbortController().signal,
      credential: undefined,
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0]?.title).toBe('One')
  })

  it('says it was throttled rather than reporting no results', async () => {
    answer('<html><body>Verify you are a human</body></html>')

    const outcome = await bing({
      query: 'anything',
      count: 5,
      signal: new AbortController().signal,
      credential: undefined,
    })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('challenge')
  })

  it('names a rate limit as one', async () => {
    answer('', 429)

    const outcome = await bing({
      query: 'anything',
      count: 5,
      signal: new AbortController().signal,
      credential: undefined,
    })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('rate-limited')
  })
})
