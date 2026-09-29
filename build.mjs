// Builds dist/: minified + obfuscated index.html, plus assets.
//   node build.mjs                 minify + obfuscate
//   node build.mjs --no-obfuscate  minify only (smallest output)
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { minify as minifyHTML } from 'html-minifier-terser';
import { minify as minifyJS } from 'terser';
import JavaScriptObfuscator from 'javascript-obfuscator';

const SRC = 'index.html';
const OUT = 'dist';
const ASSETS = ['snoopy.png'];
const obfuscate = !process.argv.includes('--no-obfuscate');

// Banner for view-source. Goes right after the doctype (minifier strips comments).
const BANNER = `<!--

  8888888888   .d8888b.
  888         d88P  Y88b
  888                888
  8888888          .d88P
  888          .od888P"
  888         d88P"
  888         888"       d8b
  888         888888888  Y8P

-->
`;

async function processJS(code) {
  const min = await minifyJS(code, {
    ecma: 2020,
    toplevel: true,
    compress: { passes: 3, unsafe_arrows: true, pure_getters: true },
    mangle: { toplevel: true },
    format: { comments: false },
  });
  if (!obfuscate) return min.code;

  // Size-conscious settings: rename + hide strings, skip the options that bloat
  // output (control-flow flattening, dead code injection).
  return JavaScriptObfuscator.obfuscate(min.code, {
    compact: true,
    target: 'browser',
    identifierNamesGenerator: 'mangled-shuffled',
    renameGlobals: false,
    stringArray: true,
    stringArrayThreshold: 1,
    stringArrayEncoding: ['base64'],
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayIndexShift: true,
    stringArrayWrappersCount: 1,
    splitStrings: false,
    numbersToExpressions: false,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    selfDefending: false,
    simplify: true,
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
  }).getObfuscatedCode();
}

// Trim SVG path coordinates to at most 1 decimal.
function tightenPaths(html) {
  return html.replace(/\sd="([^"]+)"/g, (_, d) =>
    ` d="${d
      .replace(/-?\d+\.\d+/g, (n) => String(+(+n).toFixed(1)))
      .replace(/\s*([MLCZmlcz])\s*/g, '$1')
      .replace(/,\s+/g, ',')
      .replace(/\s+-/g, '-')
      .trim()}"`);
}

const src = await readFile(SRC, 'utf8');

// Pull inline scripts out, process them, put them back.
const scripts = [];
let html = src.replace(/<script>([\s\S]*?)<\/script>/g, (_, code) => {
  scripts.push(code);
  return `<script>__SCRIPT_${scripts.length - 1}__</script>`;
});
const processed = await Promise.all(scripts.map(processJS));

html = await minifyHTML(tightenPaths(html), {
  collapseWhitespace: true,
  collapseBooleanAttributes: true,
  removeComments: true,
  removeAttributeQuotes: true,
  removeRedundantAttributes: true,
  removeScriptTypeAttributes: true,
  removeStyleLinkTypeAttributes: true,
  useShortDoctype: true,
  sortAttributes: true,
  sortClassName: true,
  minifyCSS: { level: 2 },
  minifyJS: false,
});
html = html.replace(/__SCRIPT_(\d+)__/g, (_, i) => processed[i]);
html = html.replace(/^<!doctype html>/i, (d) => `${d}\n${BANNER}`);

await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}/index.html`, html);
await Promise.all(ASSETS.map((a) => copyFile(a, `${OUT}/${a}`)));

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const before = Buffer.byteLength(src), after = Buffer.byteLength(html);
console.log(`${SRC} ${kb(before)} (gz ${kb(gzipSync(src).length)})`);
console.log(`${OUT}/index.html ${kb(after)} (gz ${kb(gzipSync(html).length)})` +
  ` ${obfuscate ? 'minified + obfuscated' : 'minified'}`);
