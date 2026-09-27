import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const MANIFEST_FILE = 'manifest.json';

export function manifestPath(root) {
  return join(root, MANIFEST_FILE);
}

export function loadManifest(root) {
  const p = manifestPath(root);
  if (!existsSync(p)) {
    return { version: 1, articles: [] };
  }
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    if (!Array.isArray(data.articles)) data.articles = [];
    return data;
  } catch (err) {
    throw new Error(`manifest.json is not valid JSON: ${err.message}`);
  }
}

export function saveManifest(root, manifest) {
  writeFileSync(manifestPath(root), JSON.stringify(manifest, null, 2) + '\n');
}

export function getArticle(manifest, slug) {
  return manifest.articles.find((a) => a.slug === slug) ?? null;
}

export function upsertArticle(manifest, article) {
  const idx = manifest.articles.findIndex((a) => a.slug === article.slug);
  if (idx >= 0) manifest.articles[idx] = article;
  else manifest.articles.push(article);
  return article;
}

export function sourceHash(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex').slice(0, 16);
}

export function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Field order for each article record (Richard's spec):
// slug, title, topic, category, description, created, updated,
// source (md path), content ({path, bytes, words, hash}),
// images [{file, kind, generator, seed, generatedAt}],
// cdn {html, images[]}, urls {html, images[]}, aiLabel, published, lastPublished
export function touchUpdated(article, now) {
  article.updated = now;
}