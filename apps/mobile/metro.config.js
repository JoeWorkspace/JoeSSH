const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const mobileModules = path.join(projectRoot, 'node_modules');

const config = getDefaultConfig(projectRoot);

config.watchFolders = Array.from(new Set([...(config.watchFolders ?? []), path.join(workspaceRoot, 'packages')]));

const originalResolveRequest = config.resolver.resolveRequest;
const mobileSingletonPackages = ['react', 'react-dom', 'react-native-web'];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // In a monorepo with hoisted node_modules, expo/AppEntry.js imports "../../App"
  // which resolves to the repo root instead of the workspace. Redirect to expo-router entry.
  if (moduleName === '../../App' && context.originModulePath?.includes('node_modules' + path.sep + 'expo')) {
    return {
      filePath: require.resolve('expo-router/entry-classic'),
      type: 'sourceFile',
    };
  }

  if (mobileSingletonPackages.some((packageName) => moduleName === packageName || moduleName.startsWith(`${packageName}/`))) {
    return context.resolveRequest(
      {
        ...context,
        originModulePath: path.join(mobileModules, '_resolver.js'),
      },
      moduleName,
      platform,
    );
  }

  if (moduleName === '@atlasterm/i18n') {
    return {
      filePath: path.join(workspaceRoot, 'packages/i18n/src/index.ts'),
      type: 'sourceFile',
    };
  }

  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
