import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const requireDevices = process.argv.includes('--require-devices');
const results = [];
const coreNativeSmokeTestIds = ['mobile-home-root', 'sync-status-panel', 'sync-error-panel', 'sync-primary-action'];
const offlineFallbackNativeSmokeTestIds = [
  'sync-status-offline',
  'sync-error-offline-fallback',
  'sync-preview-workspace',
  'sync-preview-command',
  'emergency-channels-empty',
];
const offlineFallbackMaestroTestIds = [...offlineFallbackNativeSmokeTestIds];
const localeSpecificSmokeText = [
  'Offline fallback active',
  'Sync service offline',
  'Relay Connect',
  'Cached Key',
  'Register and Pull Preview',
];

checkMobileConfig();
checkRuntimeHooks();
checkNativeSmokeFlowContract();
checkHostTooling();

const failures = results.filter((result) => result.status === 'fail');
const warnings = results.filter((result) => result.status === 'warn');

for (const result of results) {
  const marker = result.status === 'pass' ? 'PASS' : result.status === 'warn' ? 'WARN' : 'FAIL';
  console.log(`${marker} ${result.label}${result.detail ? ` - ${result.detail}` : ''}`);
}

if (failures.length > 0) {
  process.exitCode = 1;
} else {
  console.log(
    `Native smoke preflight passed with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.` +
      (requireDevices ? '' : ' Use --require-devices to fail when simulator/emulator tooling is unavailable.'),
  );
}

function checkMobileConfig() {
  const appJson = readJson('app.json');
  const packageJson = readJson('package.json');
  const expo = appJson.expo ?? {};

  passIf(expo.name === 'JoeSSH', 'Expo app name is JoeSSH');
  passIf(expo.slug === 'atlasterm-mobile', 'Expo slug is stable');
  passIf(expo.scheme === 'atlasterm', 'Deep-link scheme is configured');
  passIf(expo.userInterfaceStyle === 'automatic', 'OS light/dark appearance is automatic');
  passIf(expo.orientation === 'default', 'Native layout supports portrait and landscape orientation');
  passIf(expo.ios?.bundleIdentifier === 'com.atlasterm.mobile', 'iOS bundle identifier is configured');
  passIf(expo.android?.package === 'com.atlasterm.mobile', 'Android package identifier is configured');
  passIf(Array.isArray(expo.plugins) && expo.plugins.includes('expo-router'), 'Expo Router plugin is enabled');
  passIf(expo.web?.bundler === 'metro', 'Expo Web uses Metro bundler');

  for (const scriptName of [
    'start',
    'ios',
    'android',
    'web',
    'typecheck',
    'test',
    'smoke:native:preflight',
    'smoke:native:devices',
    'smoke:native:maestro',
  ]) {
    passIf(typeof packageJson.scripts?.[scriptName] === 'string', `package script '${scriptName}' exists`);
  }

  for (const dependencyName of ['expo', 'expo-router', 'react', 'react-native']) {
    passIf(
      typeof packageJson.dependencies?.[dependencyName] === 'string',
      `dependency '${dependencyName}' is declared`,
      `${dependencyName} missing from dependencies`,
    );
  }
}

function checkRuntimeHooks() {
  const homeScreenPath = path.join(appRoot, 'app', 'index.tsx');
  const babelConfigPath = path.join(appRoot, 'babel.config.js');
  const metroConfigPath = path.join(appRoot, 'metro.config.js');
  const maestroSmokePath = path.join(appRoot, 'maestro', 'native-smoke.yaml');

  passIf(existsSync(homeScreenPath), 'Home screen route exists');
  passIf(existsSync(babelConfigPath), 'Mobile Babel config exists');
  passIf(existsSync(metroConfigPath), 'Mobile Metro config exists');
  passIf(existsSync(maestroSmokePath), 'Native Maestro smoke flow exists');

  const homeScreenSource = readFileSync(homeScreenPath, 'utf8');
  for (const testId of coreNativeSmokeTestIds) {
    passIf(homeScreenSource.includes(`testID="${testId}"`), `native smoke hook '${testId}' exists`);
  }

  for (const testId of offlineFallbackNativeSmokeTestIds) {
    passIf(homeScreenSource.includes(testId), `offline fallback native smoke hook '${testId}' exists`);
  }
  passIf(
    homeScreenSource.includes('emergency-channel-${channel.id}'),
    'Emergency channel rows expose stable native smoke hooks',
  );

  passIf(homeScreenSource.includes('useColorScheme'), 'Home screen reads native color scheme');

  if (existsSync(maestroSmokePath)) {
    const maestroSmokeSource = readFileSync(maestroSmokePath, 'utf8');

    passIf(maestroSmokeSource.includes('${ATLASTERM_MAESTRO_APP_ID}'), 'Maestro smoke uses configurable app id');

    for (const testId of coreNativeSmokeTestIds.filter((testId) => testId !== 'mobile-home-root')) {
      passIf(maestroSmokeSource.includes(`id: "${testId}"`), `Maestro smoke targets '${testId}'`);
    }

    for (const testId of offlineFallbackMaestroTestIds) {
      passIf(maestroSmokeSource.includes(`id: "${testId}"`), `Maestro smoke asserts offline fallback hook '${testId}'`);
    }
  }
}

function checkNativeSmokeFlowContract() {
  const homeScreenPath = path.join(appRoot, 'app', 'index.tsx');
  const syncServicePath = path.join(appRoot, 'services', 'sync.ts');
  const maestroSmokePath = path.join(appRoot, 'maestro', 'native-smoke.yaml');

  if (!existsSync(homeScreenPath) || !existsSync(syncServicePath) || !existsSync(maestroSmokePath)) {
    return;
  }

  const homeScreenSource = readFileSync(homeScreenPath, 'utf8');
  const syncServiceSource = readFileSync(syncServicePath, 'utf8');
  const maestroSmokeSource = readFileSync(maestroSmokePath, 'utf8');
  const hasNoEndpointSyncUrl = !process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL?.trim();

  passIf(
    maestroSmokeSource.includes('launchApp:') && maestroSmokeSource.includes('clearState: true'),
    'Maestro smoke launches with a clean app state',
  );
  passIf(
    appearsBefore(maestroSmokeSource, 'id: "sync-status-panel"', 'id: "sync-primary-action"'),
    'Maestro smoke checks status before the primary action',
  );
  passIf(
    appearsBefore(maestroSmokeSource, 'tapOn:', 'id: "sync-error-panel"'),
    'Maestro smoke waits for offline fallback after tapping the primary action',
  );
  passIf(
    offlineFallbackMaestroTestIds.every((testId) => appearsBefore(maestroSmokeSource, 'tapOn:', `id: "${testId}"`)),
    'Maestro smoke verifies offline fallback status, preview, and recovery routes after tapping',
  );
  passIf(
    containsScrollUntilVisibleFor(maestroSmokeSource, 'emergency-channels-empty'),
    'Maestro smoke scrolls to the honest empty recovery state before asserting it',
  );
  passIf(
    containsScrollUntilVisibleFor(maestroSmokeSource, 'sync-preview-workspace'),
    'Maestro smoke scrolls to the preview surface before asserting it',
  );
  passIf(
    localeSpecificSmokeText.every((text) => !maestroSmokeSource.includes(text)),
    'Maestro smoke remains locale-independent by targeting stable native hooks',
  );
  passIf(
    /phase:\s*offlineError\s*\?\s*["']offline["']\s*:\s*["']ready["']/.test(homeScreenSource),
    'Home screen maps offline fallback into offline sync phase',
  );
  passIf(homeScreenSource.includes('getOfflineError()'), 'Home screen renders the offline fallback error panel');
  passIf(
    syncServiceSource.includes('return getFallbackDevice(request);'),
    'Register device falls back locally without a sync endpoint',
  );
  passIf(
    syncServiceSource.includes('return getFallbackPreview(fallbackDevice);'),
    'Preview pull falls back locally without a sync endpoint',
  );
  passIf(
    syncServiceSource.includes('emergencyChannels: []'),
    'Fallback preview does not fabricate recovery routes',
  );
  passIf(
    /accepted:\s*0[\s\S]*?syncCursor:\s*device\.syncCursor\s*\?\?\s*(['"])0\1/.test(
      syncServiceSource,
    ),
    'Presence push is skipped without a sync endpoint',
  );
  if (!hasNoEndpointSyncUrl) {
    warn(
      'Native smoke is configured for the no-endpoint offline fallback path',
      'EXPO_PUBLIC_ATLASTERM_SYNC_URL is set',
    );
  } else {
    passIf(true, 'Native smoke uses the no-endpoint offline fallback path');
  }
}

function checkHostTooling() {
  const hasNpx = Boolean(findCommand('npx'));
  const hasAdb = Boolean(findCommand('adb'));
  const hasEmulator = Boolean(findCommand('emulator'));
  const hasMaestro = Boolean(findCommand('maestro'));
  const hasXcrun = Boolean(findCommand('xcrun'));

  passIf(hasNpx, 'npx is available for Expo CLI launch');
  hostPassIf(hasMaestro, 'Maestro native smoke CLI tooling', 'Maestro not found on PATH');
  hostPassIf(hasAdb, 'Android adb tooling', 'Android adb not found on PATH');
  hostPassIf(hasEmulator, 'Android emulator CLI tooling', 'Android emulator CLI not found on PATH');

  if (process.platform === 'darwin') {
    hostPassIf(hasXcrun, 'iOS xcrun simulator tooling', 'xcrun not found on PATH');
  } else {
    warnOrFail('iOS simulator tooling unavailable on this host OS', `current platform is ${process.platform}`);
  }
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(appRoot, relativePath), 'utf8'));
}

function passIf(condition, label, detail = '') {
  results.push({
    detail: condition ? '' : detail,
    label,
    status: condition ? 'pass' : 'fail',
  });
}

function hostPassIf(condition, label, detail) {
  if (condition) {
    results.push({ label, status: 'pass' });
    return;
  }

  warnOrFail(label, detail);
}

function warnOrFail(label, detail) {
  results.push({
    detail,
    label,
    status: requireDevices ? 'fail' : 'warn',
  });
}

function warn(label, detail) {
  results.push({
    detail,
    label,
    status: 'warn',
  });
}

function appearsBefore(source, before, after) {
  const beforeIndex = source.indexOf(before);
  const afterIndex = source.indexOf(after);

  return beforeIndex >= 0 && afterIndex >= 0 && beforeIndex < afterIndex;
}

function containsScrollUntilVisibleFor(source, testId) {
  const pattern = new RegExp(
    [
      '-\\s+scrollUntilVisible:',
      '[\\s\\S]*?element:',
      '[\\s\\S]*?id:\\s+"' + escapeRegExp(testId) + '"',
      '[\\s\\S]*?direction:\\s+DOWN',
    ].join(''),
  );

  return pattern.test(source);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findCommand(command) {
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which';

  try {
    return execFileSync(lookup, [command], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}
