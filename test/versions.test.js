/**
 * The four places this package states its own version have to agree — and to be ahead
 * of what has already been released.
 *
 * An install updates on the version in the plugin manifest, not on new commits, so a
 * release that forgets to bump it leaves every existing install on the old code while
 * reporting itself current — which has already happened here once. The lockfile is part
 * of the same claim: it is what `npm ci` installs from, so a stale version there
 * describes a package that is not the one being shipped.
 *
 * Agreement alone was not enough. A branch can hold four manifests that agree perfectly
 * on a number `main` has already published, and that is the shape the failure actually
 * takes: two branches bump independently, the first merges, the second is left stating
 * a version that is no longer its own. That passed this check until a merge conflict
 * surfaced it by accident, so the released version is now part of what is compared.
 *
 * None of this fails a build on its own, which is exactly why it needs a test. Run
 * `npm install --package-lock-only` after bumping to bring the lockfile along.
 */

const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');

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

/**
 * The version on the default branch, or null where it cannot be read.
 *
 * Absent outside a checkout with that ref — a published tarball, a shallow clone — and
 * the comparison is simply skipped there. It is a release check, and the places it
 * cannot run are the places nothing is being released from.
 */
function releasedVersion() {
  for (const ref of ['origin/main', 'main']) {
    try {
      const shown = execFileSync('git', ['show', `${ref}:package.json`],
        { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return JSON.parse(shown).version;
    } catch { /* try the next ref */ }
  }
  return null;
}

const order = version => version.split('.').map(Number);
const compare = (a, b) => {
  const [left, right] = [order(a), order(b)];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if ((left[i] || 0) !== (right[i] || 0)) return (left[i] || 0) - (right[i] || 0);
  }
  return 0;
};

const released = releasedVersion();

if (released === null) {
  console.log(`Version ${pkg.version} stated consistently in ${Object.keys(stated).length} places.`);
  console.log('  (no main to compare against, so the release check was skipped)');
} else {
  // Equal is the case for main itself, and for a branch carrying no release.
  assert(compare(pkg.version, released) >= 0,
    `version ${pkg.version} is behind main, which is already on ${released}.\n` +
    '  Bump past it and run: npm install --package-lock-only');

  const ahead = compare(pkg.version, released) > 0;
  console.log(`Version ${pkg.version} stated consistently in ${Object.keys(stated).length} places` +
    `${ahead ? `, ahead of main's ${released}` : ` (level with main)`}.`);
}
