// Token Radar, radar-2 (Node 22, standard library only).
//
// Reads the sealed snapshot (from --input, default /input/snapshot.json), scores every genuine
// pre-token candidate with the model in lib/radar.ts, and writes the entry's output directory:
//
//   board.json     the ranked board (the gate's rows)
//   data.js        the same board, compact, for the dashboard page
//   dashboard/     a copy of this repository's dashboard/
//   screenshots/   a copy of this repository's screenshots/
//   dossier.json   the judge's dossier, built from that output with the vendored library
//
// The run is deterministic: the same snapshot bytes give the same output bytes, twice. Nothing is
// read from the network and no clock is consulted; a protocol's age is measured against the
// snapshot's own as_of date, never today.
//
// Local run:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, boardIssue, dataScript, parseSnapshot } from './lib/radar.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repo = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the dossier, the rest refuse. */
const TEXT_CAP = 65_536;
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Stop with a message on stderr and exit code 1. */
function die(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

/** The value after `--name value` or `--name=value`, else `fallback`. */
function flag(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}` && i + 1 < args.length) return args[i + 1]!;
    if (args[i]!.startsWith(`--${name}=`)) return args[i]!.slice(name.length + 3);
  }
  return fallback;
}

const inputPath = flag('input', '/input');
const snapshotFile = inputPath.endsWith('.json') ? inputPath : join(inputPath, 'snapshot.json');
if (!existsSync(snapshotFile)) {
  die(`no snapshot at ${snapshotFile}: pass --input <snapshot.json|directory>`);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

let snapshot;
try {
  snapshot = parseSnapshot(readFileSync(snapshotFile, 'utf8'));
} catch (err) {
  die(err instanceof Error ? err.message : 'snapshot could not be read');
}
const { board, radar } = buildRadar(snapshot);
const problem = boardIssue(board, snapshot);
if (problem !== null) die(`the model wrote a board the gate refuses: ${problem}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy one directory tree's regular files into `to`, skipping dot-names; returns the names taken. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  const taken: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const path = join(dir, name);
      const target = join(to, rel, name);
      if (statSync(path).isDirectory()) {
        walk(path, join(rel, name));
      } else if (statSync(path).isFile()) {
        mkdirSync(join(to, rel), { recursive: true });
        copyFileSync(path, target);
        taken.push(rel === '' ? name : `${rel}/${name}`);
      }
    }
  };
  walk(from, '');
  return taken;
}

const dashFiles = copyTree(join(repo, 'dashboard'), join(outDir, 'dashboard'));
if (dashFiles.length === 0 || !dashFiles.includes('index.html')) {
  die('dashboard/ holds no index.html to hand in');
}
const shots = copyTree(join(repo, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  die(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) die(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier is written last: the scorer rebuilds it from this output and compares bytes.
const dossierPath = join(outDir, 'dossier.json');
writeFileSync(
  dossierPath,
  buildDossier(outDir, {
    text_max_bytes: TEXT_CAP,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

// Self-check: the dossier on disk must be byte for byte what the library writes from this output.
const rebuilt = buildDossier(outDir, {
  text_max_bytes: TEXT_CAP,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
});
if (!readFileSync(dossierPath).equals(Buffer.from(rebuilt))) {
  die('dossier.json on disk differs from what buildDossier writes from this output');
}

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ` +
    `${join(outDir, 'dashboard')} (${dashFiles.length} files), ${join(outDir, 'screenshots')} ` +
    `(${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
