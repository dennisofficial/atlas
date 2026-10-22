// Shared bun:test preload for every package, wired via each package's bunfig.toml
// `[test] preload`. Sets the ATLAS_TESTING signal so the atlas-home test guard
// accepts a throwaway home. (The toStartWith/toEndWith/toBeString matchers are
// built into bun:test's own expect, so nothing else is needed here.)
process.env.ATLAS_TESTING = '1'
