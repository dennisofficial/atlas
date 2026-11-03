const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

const duplicated = [
  'expo-constants',
  'expo-font',
  'expo-glass-effect',
  'expo-linking',
  'expo-status-bar',
]
for (const name of duplicated) {
  config.resolver.extraNodeModules[name] = path.dirname(
    require.resolve(`${name}/package.json`, { paths: [__dirname] }),
  )
}

module.exports = config
