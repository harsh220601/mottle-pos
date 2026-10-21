// Renders a film page to MP4: Chromium draws each frame, ffmpeg encodes it,
// audio.py scores it from the film's cue list.
//
//   node engine/render.mjs launch               # full render → ../assets/films/launch.mp4
//   node engine/render.mjs launch --still 12.5  # one frame → .cache/stills/launch-12.5.png
//   node engine/render.mjs launch --draft       # 30 fps, half size, fast preview
//   node engine/render.mjs launch --remux       # rebuild the score and re-mux cached frames
//
// Requires Playwright (global install is fine), ffmpeg and python3 with numpy.
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(join(spawnSync('npm', ['root', '-g']).stdout.toString().trim(), 'playwright')); }

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const name = args[0];
if (!name) { console.error('usage: render.mjs <film> [--still t] [--draft] [--workers n]'); process.exit(1); }
const opt = k => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : undefined; };
const draft = args.includes('--draft');
const still = opt('--still');
const workers = Number(opt('--workers') || Math.max(1, Math.min(6, os.cpus().length - 1)));
const filmURL = pathToFileURL(join(root, 'films', `${name}.html`)).href;
const cache = join(root, '.cache');

const launch = () => playwright.chromium.launch({
  args: ['--allow-file-access-from-files', '--disable-web-security', '--force-color-profile=srgb',
         '--font-render-hinting=none', '--disable-lcd-text', '--hide-scrollbars'],
});

async function openFilm(browser, scale = 1) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
  page.on('pageerror', e => console.error('[page]', e.message));
  await page.goto(filmURL);
  const meta = await page.evaluate(async () => { await FILM.ready(); return { w: FILM.width, h: FILM.height, fps: FILM.fps, duration: FILM.duration, cues: FILM.cues, music: FILM.music, bpm: FILM.bpm }; });
  await page.setViewportSize({ width: meta.w, height: meta.h });
  return { page, meta };
}

const run = (cmd, a) => { const r = spawnSync(cmd, a, { stdio: 'inherit' }); if (r.status) throw new Error(`${cmd} failed`); };

if (still !== undefined) {
  const browser = await launch();
  const { page } = await openFilm(browser);
  mkdirSync(join(cache, 'stills'), { recursive: true });
  for (const t of still.split(',').map(Number)) {
    await page.evaluate(t => FILM.render(t), t);
    const out = join(cache, 'stills', `${name}-${t}.png`);
    await page.screenshot({ path: out });
    console.log(out);
  }
  await browser.close();
  process.exit(0);
}

// Probe metadata
const probeBrowser = await launch();
const { meta } = await openFilm(probeBrowser);
await probeBrowser.close();
const fps = draft ? 30 : meta.fps;
const scale = draft ? 0.5 : 1;
const total = Math.round(meta.duration * fps);
const work = join(cache, 'render', name);
const remux = args.includes('--remux'); // reuse rendered frames, rebuild score and mux
if (!remux) { rmSync(work, { recursive: true, force: true }); mkdirSync(work, { recursive: true }); }
console.log(`${name}: ${meta.w}x${meta.h} @ ${fps}fps, ${total} frames, ${workers} workers`);

const t0 = Date.now();
let done = 0;
async function renderChunk(k) {
  const from = Math.floor(total * k / workers), to = Math.floor(total * (k + 1) / workers);
  const browser = await launch();
  const { page } = await openFilm(browser);
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    ...(draft ? ['-vf', `scale=${meta.w / 2}:-2`] : []),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '8', '-pix_fmt', 'yuv420p', join(work, `chunk${k}.mkv`)], { stdio: ['pipe', 'inherit', 'inherit'] });
  const closed = new Promise(r => ff.on('close', r));
  for (let f = from; f < to; f++) {
    await page.evaluate(t => FILM.render(t), f / fps);
    const buf = await page.screenshot({ type: 'png', scale: 'css' });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (++done % 120 === 0) {
      const el = (Date.now() - t0) / 1000;
      process.stdout.write(`\r${done}/${total} frames  ${(done / el).toFixed(1)} fps  eta ${Math.round((total - done) / (done / el))}s   `);
    }
  }
  ff.stdin.end();
  await closed;
  await browser.close();
}
if (!remux) {
  await Promise.all(Array.from({ length: workers }, (_, k) => renderChunk(k)));
  console.log(`\nframes done in ${Math.round((Date.now() - t0) / 1000)}s`);
}

// Score
const cueFile = join(work, 'cues.json');
writeFileSync(cueFile, JSON.stringify({ duration: meta.duration, music: meta.music, bpm: meta.bpm, cues: meta.cues }));
const wav = join(work, 'score.wav');
run('python3', [join(root, 'engine', 'audio.py'), cueFile, wav]);

// Assemble
const chunks = readdirSync(work).filter(f => /^chunk\d+\.mkv$/.test(f)).sort((a, b) => parseInt(a.slice(5)) - parseInt(b.slice(5)));
writeFileSync(join(work, 'list.txt'), chunks.map(f => `file '${f}'`).join('\n'));
// Finished films are published with the website, next to its other media.
const outDir = draft ? join(cache, 'drafts') : join(root, '..', 'assets', 'films');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `${name}${draft ? '-draft' : ''}.mp4`);
run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(work, 'list.txt'), '-i', wav,
  '-c:v', 'libx264', '-preset', draft ? 'veryfast' : 'slow', '-crf', draft ? '26' : '19', '-tune', 'animation',
  '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart', '-r', String(fps),
  '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', out]);
if (!draft) {
  const posterT = meta.cues.find(c => c.type === 'poster')?.t ?? meta.duration * 0.5;
  run('ffmpeg', ['-v', 'error', '-y', '-ss', String(posterT), '-i', out, '-frames:v', '1', '-q:v', '3', join(outDir, `${name}-poster.jpg`)]);
}
console.log(out);
