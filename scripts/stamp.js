// Stamps every script and stylesheet URL in index.html with a hash of the file's
// contents, then copies index.html to 404.html (GitHub Pages serves 404.html for
// league paths).
//
// Why: GitHub Pages lets browsers cache each file for 10 minutes on its own, so right
// after a deploy a phone could run a new script against an old stylesheet, or mix old
// and new modules. With stamps, each version of a file has its own URL, and the page
// loads one consistent set. Modules import each other by plain paths ("./state.js");
// the import map written here points each path at its stamped URL.
//
// Run `npm run stamp` after changing anything in js/ or styles.css. `npm test` fails
// when the stamps are out of date.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const START = '<!-- assets:start (written by scripts/stamp.js) -->';
const END = '<!-- assets:end -->';

const hash = (path) => createHash('sha1').update(readFileSync(join(ROOT, path))).digest('hex').slice(0, 10);

function modules(dir = 'js') {
  return readdirSync(join(ROOT, dir), { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? modules(join(dir, entry.name)) : entry.name.endsWith('.js') ? [join(dir, entry.name)] : []))
    .map((path) => relative(ROOT, join(ROOT, path)).split('\\').join('/'))
    .sort();
}

/** The stamped asset block for index.html's <head>. */
export function assetBlock() {
  const stamped = (path) => `${path}?v=${hash(path)}`;
  const js = modules();
  const imports = Object.fromEntries(js.map((path) => [`./${path}`, `./${stamped(path)}`]));
  return [
    START,
    '  <script type="importmap">',
    ...JSON.stringify({ imports }, null, 2).split('\n').map((line) => `  ${line}`),
    '  </script>',
    `  <link rel="stylesheet" href="${stamped('styles.css')}">`,
    '  <!-- Every module fetched up front, instead of one import level at a time. -->',
    ...js.filter((path) => path !== 'js/app.js').map((path) => `  <link rel="modulepreload" href="${stamped(path)}">`),
    `  <script type="module" src="${stamped('js/app.js')}"></script>`,
    `  ${END}`,
  ].join('\n');
}

/** index.html with a fresh asset block. */
export function stampedIndex() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const from = html.indexOf(START);
  const to = html.indexOf(END);
  if (from < 0 || to < 0) throw new Error('index.html is missing the assets:start / assets:end markers');
  return html.slice(0, from) + assetBlock() + html.slice(to + END.length);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const html = stampedIndex();
  writeFileSync(join(ROOT, 'index.html'), html);
  writeFileSync(join(ROOT, '404.html'), html);
  console.log('Stamped index.html and 404.html');
}
