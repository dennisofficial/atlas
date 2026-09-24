# Atlas identity

The approved Atlas mark is Split Apex: a clay, open A with a diagonal gap in its right leg. Use the same silhouette on every surface.

| File | Use |
| --- | --- |
| `atlas-mark.png` | Transparent master, 1254 × 1254. |
| `atlas-icon.png` | Transparent general-purpose icon, 1024 × 1024. |
| `atlas-icon-dark.png` | Opaque general-purpose icon, 1024 × 1024. |
| `atlas-bot-avatar.png` | Transparent GitHub/Linear app logo, 512 × 512. |
| `atlas-bot-avatar-dark.png` | Opaque GitHub/Linear bot avatar, 512 × 512. |
| `favicon.ico` | Transparent browser icon with 16, 32, and 48px entries. |

All opaque assets use exactly **#272422** as the background. Preserve the transparent master’s clay artwork, proportions, diagonal gap, and clear space. The original artwork was generated with the built-in image generation tool; exports resize that master and preserve its alpha, or composite onto the specified solid background. Do not redraw each usage independently.

The web header, README, favicon, browser icon, Apple touch icon, and web manifest use this identity. The terminal startup/welcome lockup prepends a half-cell adaptation of the same mark to the existing Atlas wordmark and uses the operator’s selected accent.

GitHub App display settings and Linear OAuth application settings manage their own logos outside the repository. Upload the transparent bot avatar where the platform supports a custom background; use the dark avatar where it does not. Set GitHub’s badge background to **#272422**.

## Design context

Atlas owns its coding-agent loop, assembles model context from durable events, and coordinates work through terminal and cloud surfaces. The mark suggests structure and forward motion while remaining legible at avatar size. The codebase’s clay accent is `#D97757`; the approved raster artwork retains its generated clay appearance. See `packages/ui/src/tokens/primitives.ts` for UI tokens.
