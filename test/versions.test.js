/**
 * The three places this package states its own version have to agree.
 *
 * An install updates on the version in the plugin manifest, not on new commits, so a
 * release that forgets to bump it leaves every existing install on the old code while
 * reporting itself current — which has already happened here once. The lockfile is part
 * of the same claim: it is what `npm ci` installs from, so a stale version there
 * describes a package that is not the one being shipped.
 *
 * None of this fails a build on its own, which is exactly why it needs a test. Run
 * `npm install --package-lock-only` after bumping to bring the lockfile along.
 */

const assert = require('node:assert');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const lock = require(path.join(root, 'package-lock.json'));
const plugin = require(path.join(root, '.claude-plugin', 'plugin.json'));

const stated = {
  'package.json': pkg.version,
  'package-lock.json (root)': lock.version,
  'package-lock.json (packages[""])': lock.packages[''].version,
  '.claude-plugin/plugin.json': plugin.version,
};

const disagree = Object.entries(stated).filter(([, version]) => version !== pkg.version);
assert(!disagree.length,
  'every manifest must state the same version, got:\n' +
  Object.entries(stated).map(([where, v]) => `    ${v}  ${where}`).join('\n') +
  '\n  Run: npm install --package-lock-only');

assert(lock.name === pkg.name, `lockfile names ${lock.name}, package.json names ${pkg.name}`);

console.log(`Version ${pkg.version} stated consistently in ${Object.keys(stated).length} places.`);
