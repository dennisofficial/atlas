const pageStyle = (args: { accent: string; accentDark: string; accentShadow: string }): string => `
  * { margin: 0; box-sizing: border-box; }
  body {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
    background: radial-gradient(ellipse 80% 60% at 50% 0%, #3d2318 0%, #1f130d 55%, #120b08 100%);
    color: #e8f0ec; padding: 24px;
  }
  .card {
    max-width: 420px; width: 100%; text-align: center; padding: 48px 40px;
    background: linear-gradient(165deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%);
    border: 1px solid rgba(255,255,255,0.09); border-radius: 20px;
    box-shadow: 0 24px 64px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08);
    backdrop-filter: blur(12px);
  }
  .mark {
    width: 56px; height: 56px; margin: 0 auto 24px; border-radius: 16px;
    display: flex; align-items: center; justify-content: center; font-size: 28px; color: #fff;
    background: linear-gradient(140deg, ${args.accent} 0%, ${args.accentDark} 100%);
    box-shadow: 0 8px 24px ${args.accentShadow};
  }
  .mark.fail { background: linear-gradient(140deg, #b3402e 0%, #8f3123 100%); box-shadow: 0 8px 24px rgba(179,64,46,0.3); }
  h1 { font-size: 22px; font-weight: 650; letter-spacing: -0.01em; margin-bottom: 10px; }
  p { font-size: 14px; line-height: 1.6; color: #9db3aa; }
  p.detail { color: #c9a79e; margin: 0 0 12px; font-size: 13px; }
`

export type LoopbackBrand = { accent: string; accentDark: string; accentShadow: string }

export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)

export const loopbackPage = (args: {
  brand: LoopbackBrand
  title: string
  heading: string
  body: string
  failed: boolean
}): string =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${args.title}</title><style>${pageStyle(args.brand)}</style></head><body><div class="card"><div class="mark${args.failed ? ' fail' : ''}">${args.failed ? '&#10007;' : '&#10003;'}</div><h1>${args.heading}</h1>${args.body}</div>${args.failed ? '' : '<script>window.close()</script>'}</body></html>`

export const loopbackErrorHtml = (args: { brand: LoopbackBrand; detail: string }): string =>
  loopbackPage({
    brand: args.brand,
    title: 'Sign-in failed',
    heading: 'Sign-in failed',
    body: `<p class="detail">${escapeHtml(args.detail)}</p><p>You can close this window and try again from the terminal.</p>`,
    failed: true,
  })
