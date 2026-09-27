#!/usr/bin/env node
// articles CLI — markdown article pipeline with auto-maintained manifest.
//
// Commands:
//   new <slug> --title "..." [--topic ...] [--category ...] [--description ...]
//   image <slug>                     regenerate header image (fallback ladder)
//   build <slug> [--theme <name>]    render md → articles/<slug>/index.html
//   publish <slug> [--theme <name>]  build + upload html/images to CDN, verify
//   list                             manifest summary
//   check <slug>                     manifest vs disk consistency check
//
// The manifest is updated automatically by every command that touches an article.

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { loadManifest, saveManifest, getArticle, upsertArticle, sourceHash, countWords } from '../lib/manifest.mjs';
import { renderArticleHtml } from '../lib/template.mjs';
import { generateHeaderImage } from '../lib/gen-image.mjs';
import { uploadFile, verifyUrl } from '../lib/cdn.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ARTICLES_DIR = join(ROOT, 'articles');

const AI_LABEL_TEXT = 'Written with AI assistance';
const THEMES = ['dark', 'light', 'catppuccin-mocha', 'gruvbox', 'rose-pine'];
const DEFAULT_THEME = 'dark';

const now = () => new Date().toISOString();

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--topic' || a === '--category' || a === '--description' || a === '--title') flags[a.slice(2)] = argv[++i];
    else if (a === '--theme') flags.theme = argv[++i];
  }
  return flags;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- commands ----------

function cmdNew(slug, flags) {
  if (!slug) throw new Error('usage: articles new <slug> --title "..." [--topic ...] [--category ...] [--description ...]');
  if (!flags.title) throw new Error('--title is required');
  const manifest = loadManifest(ROOT);
  if (getArticle(manifest, slug)) throw new Error(`article "${slug}" already exists in manifest`);
  const dir = join(ARTICLES_DIR, slug);
  if (existsSync(dir)) throw new Error(`directory already exists: ${dir}`);
  mkdirSync(dir, { recursive: true });
  const ts = now();
  const article = {
    slug,
    title: flags.title,
    topic: flags.topic || flags.title,
    category: flags.category || 'general',
    description: flags.description || '',
    created: ts,
    updated: ts,
    source: { path: `articles/${slug}/article.md`, hash: null },
    content: { path: `articles/${slug}/index.html`, bytes: null, words: null, hash: null },
    images: [],
    cdn: {},
    urls: {},
    aiLabel: { scheme: 'ai-label.org', symbol: 'made-with-ai', text: AI_LABEL_TEXT },
    published: false,
    lastPublished: null,
  };
  upsertArticle(manifest, article);
  saveManifest(ROOT, manifest);
  writeFileSync(
    join(dir, 'article.md'),
    `# ${flags.title}\n\n## Introduction\n\nTODO: write the article.\n`
  );
  console.log(`created ${slug}: ${dir}/article.md`);
  console.log(`next: edit article.md → articles image ${slug} → articles publish ${slug}`);
}

function loadArticleOrThrow(slug) {
  const manifest = loadManifest(ROOT);
  const article = getArticle(manifest, slug);
  if (!article) throw new Error(`article "${slug}" not in manifest — run: articles new ${slug}`);
  return { manifest, article };
}

async function buildHtml(article, theme) {
  const mdPath = join(ARTICLES_DIR, article.slug, 'article.md');
  if (!existsSync(mdPath)) throw new Error(`missing source: ${mdPath}`);
  const md = readFileSync(mdPath, 'utf8');
  const htmlBody = await marked.parse(md);

  let headerImgHtml = '';
  if (existsSync(join(ARTICLES_DIR, article.slug, 'header.svg'))) {
    headerImgHtml = `<img class="header-img" src="header.svg" alt="AI-generated header art">`;
  }

  const bylineHtml = [
    `<span>${(article.updated || article.created).slice(0, 10)}</span>`,
    `<span>${escapeAttr(article.topic)}</span>`,
    `<span>${escapeAttr(article.category)}</span>`,
  ].join(' · ');

  const html = renderArticleHtml({
    title: article.title,
    description: article.description,
    bylineHtml,
    htmlBody,
    headerImgHtml,
    theme,
    themes: THEMES,
    aiLabel: { symbol: 'made-with-ai', text: AI_LABEL_TEXT, iconHtml: '' },
    footerNote: '',
  });
  return { html, md };
}

function setHeaderImage(article, img) {
  article.images = [
    { file: img.file, kind: 'header', generator: img.generator, seed: String(img.seed), generatedAt: now() },
  ];
}

async function ensureHeaderImage(manifest, article) {
  const imgPath = join(ARTICLES_DIR, article.slug, 'header.svg');
  if (existsSync(imgPath)) return;
  console.log('header image missing — generating (ladder: local ollama → pi sdk → ollama cloud)...');
  const img = await generateHeaderImage(ROOT, article);
  setHeaderImage(article, img);
  saveManifest(ROOT, manifest);
  console.log(`header image: ${img.generator} (seed ${img.seed})`);
}

async function cmdBuild(slug, flags, ctx) {
  const loaded = ctx ?? loadArticleOrThrow(slug);
  const { manifest, article } = loaded;
  const theme = flags.theme || DEFAULT_THEME;
  await ensureHeaderImage(manifest, article);
  const { html, md } = await buildHtml(article, theme);
  const outPath = join(ARTICLES_DIR, slug, 'index.html');
  writeFileSync(outPath, html);
  article.content = {
    path: `articles/${slug}/index.html`,
    bytes: statSync(outPath).size,
    words: countWords(md),
    hash: sourceHash(outPath),
  };
  article.source.hash = sourceHash(join(ARTICLES_DIR, slug, 'article.md'));
  article.updated = now();
  saveManifest(ROOT, manifest);
  console.log(`built articles/${slug}/index.html (${article.content.bytes} bytes, ${article.content.words} words, theme: ${theme})`);
}

async function cmdPublish(slug, flags) {
  const ctx = loadArticleOrThrow(slug);
  const { manifest, article } = ctx;
  await cmdBuild(slug, flags, ctx);
  const dir = join(ARTICLES_DIR, slug);
  const cdnBase = `articles/${slug}`;
  const urls = {};

  for (const img of article.images) {
    const key = `${cdnBase}/${img.file}`;
    const { url } = await uploadFile(join(dir, img.file), key, img.file.endsWith('.svg') ? 'image/svg+xml' : undefined);
    urls[img.file] = url;
  }
  const { url: htmlUrl } = await uploadFile(join(dir, 'index.html'), `${cdnBase}/index.html`, 'text/html');
  urls['index.html'] = htmlUrl;

  let allOk = true;
  for (const u of Object.values(urls)) {
    const v = await verifyUrl(u);
    console.log(`${v.ok ? '✅' : '⚠️'} ${v.output}`);
    if (!v.ok) allOk = false;
  }
  article.cdn = { html: `articles/${slug}/index.html`, images: Object.keys(urls).filter((k) => k !== 'index.html') };
  article.urls = { html: htmlUrl, images: urls };
  article.published = allOk;
  article.lastPublished = now();
  saveManifest(ROOT, manifest);
  console.log(`published: ${htmlUrl}`);
  if (!allOk) process.exitCode = 1;
}

async function cmdList() {
  const manifest = loadManifest(ROOT);
  if (!manifest.articles.length) return console.log('no articles in manifest');
  for (const a of manifest.articles) {
    const img = a.images?.[0]?.generator || 'none';
    console.log(
      `${a.published ? '🟢' : '⚪'} ${a.slug.padEnd(22)} ${a.category.padEnd(10)} ` +
        `words:${String(a.content?.words ?? '?').padEnd(6)} img:${img.padEnd(20)} ${a.urls?.html || 'unpublished'}`
    );
  }
}

async function cmdCheck(slug) {
  const { article } = loadArticleOrThrow(slug);
  const problems = [];
  const dir = join(ARTICLES_DIR, slug);
  if (!existsSync(join(dir, 'article.md'))) problems.push('missing article.md');
  if (!existsSync(join(dir, 'index.html'))) problems.push('missing index.html (run: articles build <slug>)');
  for (const img of article.images) {
    if (!existsSync(join(dir, img.file))) problems.push(`missing image: ${img.file}`);
  }
  if (article.source?.hash) {
    const h = sourceHash(join(dir, 'article.md'));
    if (h !== article.source.hash) problems.push('article.md changed since last build');
  }
  console.log(problems.length ? `⚠️ ${slug}:\n  - ${problems.join('\n  - ')}` : `✅ ${slug} consistent`);
}

// ---------- entry ----------

const [cmd, slug, ...rest] = process.argv.slice(2);
const flags = parseArgs(rest);
try {
  if (cmd === 'new') cmdNew(slug, flags);
  else if (cmd === 'image') {
    const { manifest, article } = loadArticleOrThrow(slug);
    const img = await generateHeaderImage(ROOT, article);
    setHeaderImage(article, img);
    saveManifest(ROOT, manifest);
    console.log(`header image regenerated: ${img.generator} (seed ${img.seed}) → articles/${slug}/header.svg`);
  } else if (cmd === 'build') await cmdBuild(slug, flags);
  else if (cmd === 'publish') await cmdPublish(slug, flags);
  else if (cmd === 'list') await cmdList();
  else if (cmd === 'check') await cmdCheck(slug);
  else {
    console.error('usage: articles <new|image|build|publish|list|check> ...');
    process.exit(1);
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(1);
}