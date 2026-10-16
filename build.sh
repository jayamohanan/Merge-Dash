#!/bin/sh
# Build the folder that gets uploaded.
#
# A COPY, not the project itself: the project holds tools, notes, art sources and
# scratch folders that have no business on a games portal, and deciding what to
# leave out by hand every time is how a 3MB editor ends up shipped.
#
# EXCLUDE, rather than list what to include. A list of includes goes stale the
# moment a new art folder appears and quietly ships a game missing its pictures —
# the failure is silent and looks like a bug. An exclude list fails the other way:
# something unwanted slips in, the upload is a little larger, and nothing breaks.
#
# Run from anywhere:  sh build.sh   or   sh /path/to/project/build.sh
set -e

# WORK FROM THE SCRIPT'S OWN FOLDER, not from wherever it was called. Everything
# below copies "the current folder" — so run from somewhere else, the script
# would not fail, it would copy THAT folder instead: a home directory, say. Moving
# to the script's location first makes it do the same thing from anywhere.
cd "$(dirname "$0")"

OUT=build

rm -rf "$OUT"
mkdir -p "$OUT"

# THE COPY, IN NODE — not rsync. Cloudflare Pages' build machine has no rsync
# (the build died there with "rsync: not found"), and Node is already needed
# below, so this runs the same everywhere.
#
# What is LEFT OUT:
#   NAMES   anywhere in the tree — repo and tooling folders, notes, Finder litter
#   PATHS   from the project root — art folders that are kept but not loaded
node - "$OUT" <<'EOF'
const fs = require('fs'), path = require('path');
const OUT = process.argv[2];
const NAMES = new Set(['.git', '.github', '.gitignore', '.claude', '.DS_Store', 'build', 'build.sh',
                       'build.command', 'dev', 'tools', 'style', 'sounds', 'untitled folder']);
const PATHS = new Set([]);
const skip = (rel, name) => NAMES.has(name) || PATHS.has(rel) || name.startsWith('._') || name.endsWith('.md');
let n = 0;
(function copy(rel) {
  for (const e of fs.readdirSync(rel || '.', { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (skip(r, e.name)) continue;
    if (e.isDirectory()) { fs.mkdirSync(path.join(OUT, r), { recursive: true }); copy(r); }
    else if (e.isFile()) { fs.copyFileSync(r, path.join(OUT, r)); n++; }
  }
})('');
console.log(`copied ${n} files`);
EOF

# ── START THE OPENING ART WITH THE PAGE ────────────────────────────────────────
# Without this, loading runs in rounds, each waiting on the server: the page,
# then the scripts, then — only once game.js has arrived and run — the art. The
# build's index.html gets a <link rel="preload"> for every file the opening
# load needs, so the browser starts fetching them the moment the page arrives,
# alongside the scripts. When the game asks for them they are already in hand
# or on their way.
#
# WHICH FILES comes from assets.js, the same function the game loads from — run
# here in a sandbox over the config. Nothing is listed by hand, so the hints
# cannot drift from what the game actually loads.
#
# Images are hinted as="image" with crossorigin="anonymous", matching how the
# game loads them (plain image loads, see `loader` in game.js). JSON is hinted
# as="fetch", which is what Phaser's XHR is. A hint of a different kind than the
# request would not be reused and the file would download twice — check the
# Network tab after changing either side: every file should appear once.
node - "$OUT" <<'EOF'
const fs = require('fs'), path = require('path'), vm = require('vm');
const OUT = process.argv[2];
const ctx = vm.createContext({ console });
for (const f of ['config.js', 'assets.js']) {
  vm.runInContext(fs.readFileSync(path.join(OUT, f), 'utf8'), ctx, { filename: f });
}
const pick = vm.runInContext(`sharedAssets().map((a) => ({ url: a.url, json: a.type === 'json' }))`, ctx);
const hints = new Map();
for (const p of pick) if (p.url && !hints.has(p.url)) hints.set(p.url, p.json);
const tags = [...hints].map(([url, json]) => json
  ? `\t<link rel="preload" href="${url}" as="fetch" crossorigin="anonymous">`
  : `\t<link rel="preload" href="${url}" as="image" crossorigin="anonymous">`).join('\n');
const htmlPath = path.join(OUT, 'index.html');
const page = fs.readFileSync(htmlPath, 'utf8');
if (!page.includes('</head>')) throw new Error('index.html has no </head> to put preload hints in');
fs.writeFileSync(htmlPath, page.replace('</head>',
  `\t<!-- Added by build.sh: the opening load, fetched from the moment the page arrives. -->\n${tags}\n</head>`));
console.log(`added ${hints.size} preload hints to index.html`);
EOF

# ── STRIP THE COMMENTS FROM OUR OWN SCRIPTS ────────────────────────────────────
# The source is written to be read: much of it is comments. That is worth having while the game is being made and worth
# nothing to a player, who downloads every word of it. So the BUILD COPY has them
# removed. The source files are never touched.
#
# COMMENTS AND WHITESPACE ONLY — names are left exactly as written. These files
# are plain scripts sharing globals: config.js defines CONFIG and game.js reads
# it. A minifier free to rename would shorten those in one file without knowing
# another file depends on them, and the game
# would break on load. Keeping names costs a little size and removes that risk.
#
# phaser.min.js is left alone: it is already minified.
#
# Skip it with  sh build.sh --no-minify  when debugging a build — a minified file
# puts its whole program on a few lines, so an error's line number points nowhere
# useful.
if [ "$1" != "--no-minify" ]; then
  for f in game.js config.js assets.js; do
    [ -f "$OUT/$f" ] || continue
    npx --yes esbuild@0.24.0 "$OUT/$f" \
      --minify-whitespace --minify-syntax --legal-comments=none \
      --log-level=warning --outfile="$OUT/$f.tmp"
    mv "$OUT/$f.tmp" "$OUT/$f"
  done
fi

# ── ONE SCRIPT INSTEAD OF THREE ────────────────────────────────────────────────
# config.js, assets.js and game.js are three requests before the game can even
# start, and each waits on the server. In the BUILD COPY they are joined into
# one game.js, in the order index.html loads them, and the build's index.html
# gets one tag in place of three. The project's
# files and its index.html are never touched.
#
# Joined as a PLAIN script, not a module. The project's index.html still loads
# game.js as a module, but it uses nothing a module provides (no import, no
# export), while the others
# were written as plain scripts — and a module runs in strict mode, which would
# hold them to rules they were never checked against. As a plain script
# everything runs exactly as they always have.
#
# Safe only because no two files declare the same top-level name. game.js used
# to have a scope of its own; joined, it shares one. If a clash is ever added,
# the game stops on load with "has already been declared" naming it.
#
# Phaser stays its own file: it is not ours, it is already minified, and a
# player's browser can keep it cached across updates to the game.
node - "$OUT" <<'EOF'
const fs = require('fs'), path = require('path');
const OUT = process.argv[2];
const parts = ['config.js', 'assets.js', 'game.js'];
const htmlPath = path.join(OUT, 'index.html');
let page = fs.readFileSync(htmlPath, 'utf8');
// Read everything first, then write: game.js is both an input and the output.
const joined = parts.map((f) => fs.readFileSync(path.join(OUT, f), 'utf8')).join('\n;\n');
for (const f of parts) {
  const tag = new RegExp(`[ \\t]*<script[^>]*src="${f.replace(/\./g, '\\.')}"[^>]*></script>\\r?\\n?`);
  if (!tag.test(page)) throw new Error(`index.html has no <script> tag for ${f}`);
  page = page.replace(tag, '');
  fs.rmSync(path.join(OUT, f));
}
const phaser = /(<script[^>]*src="phaser\.min\.js"[^>]*><\/script>)/;
if (!phaser.test(page)) throw new Error('index.html has no <script> tag for phaser.min.js');
page = page.replace(phaser, '$1\n\t<script src="game.js"></script>');
fs.writeFileSync(path.join(OUT, 'game.js'), joined);
fs.writeFileSync(htmlPath, page);
console.log(`joined ${parts.length} scripts into game.js`);
EOF

echo "built $OUT —  $(du -sh "$OUT" | cut -f1)"
echo
echo "largest pieces:"
du -sh "$OUT"/* 2>/dev/null | sort -rh | head -6
