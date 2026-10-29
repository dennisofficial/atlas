export default {
  packageManager: 'bun',
  electrobun: { version: '2.0.5' },
  scripts: {
    dev: ['hutch', 'electrobun', 'dev', '--watch'],
    build: ['hutch', 'electrobun', 'build', '--env=stable'],
  },
}
