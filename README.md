# articles

Article publishing pipeline: **markdown → deterministic AI header → themed HTML → CDN**.

Everything is driven by one CLI (`bin/articles.mjs`). The manifest (`manifest.json`) is maintained
automatically by every command — never hand-edit it while articles exist.

## Install

```bash
cd ~/projects/articles
npm install
```

External dependencies (already on this machine):

- **cdn-uploader** at `~/projects/cdn-uploader` — R2 uploads (override with `CDN_UPLOADER_DIR`)
- **pi** CLI authenticated with an ollama provider — SVG header generation (ladder step 2)
- **ollama** npm package — ladder steps 1 & 3

## Commands

| Command | What it does |
|---------|--------------|
| `articles new <slug> --title "..." [--topic ...] [--category ...] [--description ...]` | Creates `articles/<slug>/article.md` + manifest entry |
| `articles image <slug>` | Generates `articles/<slug>/header.svg` (fallback ladder below) |
| `articles build <slug> [--theme dark]` | Renders markdown → `articles/<slug>/index.html` |
| `articles publish <slug> [--theme dark]` | build + upload images/html to CDN + verify |
| `articles list` | Manifest summary |
| `articles check <slug>` | Manifest vs disk consistency (hash checks) |

`build` auto-generates the header image if missing, so the minimal flow is:

```bash
articles new my-post --title "My Post" --topic "..." --category "..." --description "..."
# edit articles/my-post/article.md
articles publish my-post
# → https://cdn.rbk.dev/articles/my-post/index.html
```

## Header image ladder (deterministic)

`lib/gen-image.mjs` tries, in order:

1. **ollama-js → local image model** (`localhost:11434`) — auto-detects a model with image
   generation capability, seeds the prompt from the slug
2. **Pi SDK agent** — spawns `pi --mode json` with a strict SVG brief; validates output
3. **ollama-js → ollama cloud** (`glm-5.2` by default, override with `OLLAMA_SVG_MODEL`)

The seed is `sha256("article-header:<slug>")` — same slug always produces the same prompt and
seed regardless of which ladder step succeeds. Reruns only happen when `header.svg` is deleted
(explicit `articles image <slug>` always regenerates).

Env knobs: `OLLAMA_LOCAL_HOST`, `OLLAMA_CLOUD_HOST`, `OLLAMA_SVG_MODEL`, `OLLAMA_API_KEY`.

## Manifest

`manifest.json` is the single source of truth. One record per article:

```jsonc
{
  "slug": "dabdaw-stages-of-ai-grief",
  "title": "DABDAW - Stages of AI Grief",
  "topic": "AI grief, Kübler-Ross model",
  "category": "ai-culture",
  "description": "...",
  "created": "2026-09-27T...",
  "updated": "2026-09-27T...",
  "source":   { "path": "articles/<slug>/article.md", "hash": "..." },
  "content":  { "path": "articles/<slug>/index.html", "bytes": 123, "words": 456, "hash": "..." },
  "images":   [{ "file": "header.svg", "kind": "header", "generator": "pi-sdk", "seed": "...", "generatedAt": "..." }],
  "cdn":      { "html": "articles/<slug>/index.html", "images": ["articles/<slug>/header.svg"] },
  "urls":     { "html": "https://cdn.rbk.dev/...", "images": { "header.svg": "https://cdn.rbk.dev/..." } },
  "aiLabel":  { "scheme": "ai-label.org", "symbol": "made-with-ai", "text": "Written with AI assistance" },
  "published": true,
  "lastPublished": "2026-09-27T..."
}
```

## Rendering details

- **marked** renders the markdown; `lib/template.mjs` wraps it.
- **Theme switcher** (render-markdown style): `<select>` top-right swaps
  `../themes/<name>.css` live. Five themes bundled from
  [rk185371/render-markdown](https://github.com/rk185371/render-markdown):
  dark, light, catppuccin-mocha, gruvbox, rose-pine. Themes are shared at the
  CDN root `themes/` — publish them once (see below).
- **Sidebar TOC** built from `##` headings with scroll-spy.
- **AI disclosure** everywhere:
  - header chip: "WRITTEN WITH AI ASSISTANCE" linking to https://ai-label.org
  - footer: bundled CC0 banner (`assets/ai-label/ai-label_banner-made-with-ai.svg`)
  - `<meta name="ai-generated">` in the head
- Header art SVG lives beside the article: `articles/<slug>/header.svg`, referenced
  relatively so the same HTML works locally and on the CDN.

## CDN layout

```
articles/<slug>/index.html     ← share this URL
articles/<slug>/header.svg
themes/<name>.css              ← shared across all articles
assets/ai-label/*.svg          ← shared CC0 label banner
```

R2 has no directory index — always link `index.html` explicitly.

## Publishing shared assets (one-time)

```bash
cd ~/projects/cdn-uploader
for t in dark light catppuccin-mocha gruvbox rose-pine; do
  node lib/bin/cli.js upload ~/projects/articles/themes/$t.css "themes/$t.css"
done
node lib/bin/cli.js upload ~/projects/articles/assets/ai-label/ai-label_banner-made-with-ai.svg \
  assets/ai-label/ai-label_banner-made-with-ai.svg
```

## Republishing (versioning)

Republishing the same slug overwrites the CDN object. To keep a prior version for comparison,
copy it in the bucket first (or upload the old local `index.html` under a new key):

```bash
cd ~/projects/cdn-uploader
node lib/bin/cli.js upload /abs/path/to/old-index.html "articles/<slug>/v1.html"
```

## Repo

- Remote: github.com/rbk-agent/articles
- Sibling reference implementation: `~/projects/render-markdown` (Pi skill, not required at runtime)