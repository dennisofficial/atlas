const config = {
  extraSources: [
    {
      type: 'dir',
      filePath: '../../patches',
      reasons: ['bun patchedDependencies can change native code'],
    },
  ],
}

module.exports = config
