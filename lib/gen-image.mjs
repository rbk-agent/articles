// Deterministic article header image generation — fallback ladder:
//   1. ollama-js + local generative image model (localhost:11434)
//   2. Pi SDK coding agent → SVG header art
//   3. ollama-js + ollama cloud text model → SVG source code
// Same slug + same generator => same seed. Seed is embedded in every prompt.
import { writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OLLAMA_LOCAL = process.env.OLLAMA_LOCAL_HOST || 'http://localhost:11434';
const OLLAMA_CLOUD = process.env.OLLAMA_CLOUD_HOST || 'https://ollama.com';

export function seedFor(slug) {
  const h = createHash('sha256').update(`article-header:${slug}`).digest();
  return { hex: h.slice(0, 8).toString('hex'), num: h.readUInt32BE(0) % 2147483647 };
}

// ---------- Ladder step 1: local ollama image-gen model ----------
async function stepLocalOllamaImage(slug, title, topic, outPath, seed) {
  const { Ollama } = await import('ollama');
  const ollama = new Ollama({ host: OLLAMA_LOCAL });
  let tags;
  try {
    tags = await ollama.list();
  } catch {
    throw new Error('local ollama unreachable');
  }
  if (!tags.models?.length) throw new Error('local ollama has no models installed');
  // Find a model with image-generation capability (/api/show capabilities).
  for (const m of tags.models) {
    try {
      const show = await ollama.show({ model: m.name });
      const caps = show.capabilities || [];
      if (caps.includes('image') || caps.includes('image_generation') ||
          /image|diffus|flux|z-image|sd/i.test(m.name)) {
        const res = await ollama.generate({
          model: m.name,
          prompt: buildImagePrompt(title, topic, seed.hex),
          seed: seed.num,
        });
        const b64 = res.images?.[0];
        if (!b64) throw new Error(`model ${m.name} returned no image`);
        writeFileSync(outPath, Buffer.from(b64, 'base64'));
        return { generator: `ollama-local:${m.name}`, seed: seed.num };
      }
    } catch { /* try next model */ }
  }
  throw new Error(`no image-generation capable model on local ollama (${tags.models.length} text models)`);
}

// ---------- Ladder step 2: Pi SDK coding agent creates SVG ----------
async function stepPiAgent(slug, title, topic, outPath, seed) {
  const { spawn } = await import('node:child_process');
  const prompt = [
    `Create a single SVG file at exactly ${outPath}.`,
    `It is the header image for an article.`,
    `Title: "${title}"`,
    `Topic: ${topic}`,
    `Requirements:`,
    `- Pure SVG, viewBox="0 0 1200 630", valid standalone XML (xmlns on root).`,
    `- Abstract generative vector art that evokes the topic. NO text, letters, or words in the image.`,
    `- Palette and composition must be derived deterministically from this seed: ${seed.hex}`,
    `- Deterministic construction: hardcode every coordinate; no randomness at runtime, no <script> inside the SVG.`,
    `- 6-10 layered shapes (circles, polygons, paths, gradients ok). Keep total file under 15KB.`,
    `Write the file, then verify it exists. Reply only DONE when the file is written.`,
  ].join('\n');
  await new Promise((resolve, reject) => {
    const child = spawn('pi', ['--mode', 'json', '--thinking', process.env.PI_THINKING || 'low', prompt], { cwd: __dirname + '/..' });
    let out = '', err = '';
    let killed = false;
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, 540000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', () => {
      clearTimeout(timer);
      // Even if timed out, accept a valid SVG the agent managed to write.
      if (existsSync(outPath) && statSync(outPath).size >= 200) {
        try {
          validateSvg(outPath);
          resolve({ generator: 'pi-sdk', seed: seed.hex });
          return;
        } catch { /* invalid file, fall through to reject */ }
      }
      reject(new Error(killed ? 'pi agent timed out (540s)' : `pi agent exited without a valid SVG ${(err || '').slice(-200)}`));
    });
    child.on('error', reject);
  });
}

// ---------- Ladder step 3: ollama cloud model writes SVG ----------
async function stepOllamaCloudSvg(slug, title, topic, outPath, seed) {
  const { Ollama } = await import('ollama');
  const model = process.env.OLLAMA_SVG_MODEL || 'glm-5.2';
  const ollama = new Ollama({ host: OLLAMA_CLOUD, headers: cloudHeaders() });
  const res = await ollama.chat({
    model,
    seed: seed.num,
    temperature: 0,
    messages: [
      { role: 'system', content: 'You are an SVG artist. You output ONLY raw SVG markup, nothing else.' },
      { role: 'user', content: buildImagePrompt(title, topic, seed.hex) + '\nOutput ONLY the raw <svg>...</svg> markup.' },
    ],
  });
  const text = res.message.content;
  const start = text.indexOf('<svg');
  const end = text.lastIndexOf('</svg>');
  if (start === -1 || end === -1) throw new Error('cloud model returned no SVG markup');
  writeFileSync(outPath, text.slice(start, end + 6) + '\n');
  validateSvg(outPath);
  return { generator: `ollama-cloud:${model}`, seed: seed.num };
}

function cloudHeaders() {
  // Pi's ollama auth (if a real key exists) is reused; local models.json uses placeholder "ollama".
  try {
    const auth = JSON.parse(readFileSyncSafe(join(process.env.HOME || '', '.pi/agent/auth.json')));
    const entry = auth?.['ollama-cloud'] || auth?.['ollama'];
    const key = entry?.key || entry?.apiKey || process.env.OLLAMA_API_KEY;
    if (key && key !== 'ollama') return { Authorization: `Bearer ${key}` };
  } catch { /* fall through */ }
  return process.env.OLLAMA_API_KEY ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` } : {};
}

function readFileSyncSafe(p) {
  return readFileSync(p, 'utf8');
}

function buildImagePrompt(title, topic, seedHex) {
  return [
    `Abstract generative vector header art for an article.`,
    `Title: "${title}"`,
    `Topic: ${topic}`,
    `Deterministic seed: ${seedHex} — derive hue, layout and geometry from it.`,
    `Canvas 1200x630. Layered abstract shapes only. No text or letters.`,
  ].join(' ');
}

function validateSvg(outPath) {
  const src = readFileSync(outPath, 'utf8');
  if (!/<svg[\s>]/.test(src) || src.includes('<script')) {
    throw new Error(`invalid SVG at ${outPath}`);
  }
}

// ---------- Ladder driver ----------
export async function generateHeaderImage(articlesRoot, article) {
  const outPath = join(articlesRoot, 'articles', article.slug, 'header.svg');
  const seed = seedFor(article.slug);
  const steps = [stepLocalOllamaImage, stepPiAgent, stepOllamaCloudSvg];
  const attempts = [];
  for (const step of steps) {
    try {
      const info = await step(article.slug, article.title, article.topic || article.category || 'general', outPath, seed);
      return { file: 'header.svg', localPath: outPath, ...info };
    } catch (err) {
      attempts.push(`${step.name}: ${err.message}`);
    }
  }
  throw new Error('all image generation steps failed:\n  ' + attempts.join('\n  '));
}