// Article HTML template: render-markdown-style theme switcher + sidebar TOC,
// plus ai-label.org disclosure (header chip + footer banner, CC0 assets bundled).
// Theme files live at the CDN root: ../../themes/<name>.css relative to articles/<slug>/index.html.

const AI_LABEL_URL = 'https://ai-label.org';

export function slugifyHeading(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'section';
}

// Add ids to h1-h3 and build TOC entries from h2s
export function processHeadings(htmlBody) {
  const toc = [];
  let n = 0;
  const out = htmlBody.replace(/<h([123])>([\s\S]*?)<\/h\1>/g, (m, level, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    let id = slugifyHeading(text);
    if (toc.some((t) => t.id === id)) id = `${id}-${++n}`;
    if (level === '2') toc.push({ id, text });
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });
  return { htmlBody: out, toc };
}

export function renderTocHtml(toc) {
  if (!toc.length) return '';
  const items = toc.map((t) => `<a href="#${t.id}" data-id="${t.id}">${escapeHtml(t.text)}</a>`).join('\n');
  return `<nav class="toc"><div class="toc-title">Contents</div>${items}</nav>`;
}

export function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function themeOptions(defaultTheme, themes) {
  return themes
    .map(
      (t) =>
        `<option value="${t}"${t === defaultTheme ? ' selected' : ''}>${t
          .split('-')
          .map((w) => w[0].toUpperCase() + w.slice(1))
          .join(' ')}</option>`
    )
    .join('\n      ');
}

/**
 * @param {object} p
 * @param {string} p.title          article title
 * @param {string} p.description    subtitle/summary line
 * @param {string} p.bylineHtml     date · topic · category row content
 * @param {string} p.htmlBody       rendered markdown <body> content
 * @param {Array}  p.toc            [{id, text}]
 * @param {string} p.headerImgHtml  '' or <img> tag for header image
 * @param {string} p.theme          default theme name
 * @param {string[]} p.themes       available themes
 * @param {object} p.aiLabel        {symbol: 'made-with-ai', text: 'Written with AI assistance'}
 * @param {string} p.footerNote     extra footer text (sources line etc.)
 */
export function renderArticleHtml(p) {
  const { htmlBody, toc } = processHeadings(p.htmlBody);
  const tocHtml = renderTocHtml(toc.length ? toc : p.toc || []);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(p.title)}</title>
<meta name="description" content="${escapeHtml(p.description || '')}">
<meta name="ai-generated" content="${escapeHtml(p.aiLabel?.text || 'Generated with AI assistance')}">
<meta name="generator" content="articles pipeline (marked + deterministic SVG headers)">
<link rel="stylesheet" href="../../themes/${p.theme}.css" id="theme-link">
<style>
  /* Layout overrides (come after theme <link>, so they win) */
  body { display: flex; max-width: none; margin: 0; padding: 0; }
  .toc {
    position: fixed; top: 0; left: 0; width: 200px; height: 100vh;
    overflow-y: auto; padding: 20px 12px; box-sizing: border-box;
    border-right: 1px solid; border-color: inherit;
  }
  .toc-title { font-weight: 600; font-size: 13px; margin-bottom: 12px; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.05em; }
  .toc a { display: block; font-size: 13px; padding: 6px 8px; margin: 1px 0; border-radius: 4px; text-decoration: none; opacity: 0.6; transition: opacity 0.15s, background 0.15s; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .toc a:hover { opacity: 1; background: rgba(128,128,128,0.15); text-decoration: none; }
  .toc a.active { opacity: 1; background: rgba(128,128,128,0.2); border-left: 3px solid; border-color: inherit; padding-left: 5px; }
  .theme-selector {
    position: fixed; top: 12px; right: 16px; z-index: 100; font-size: 13px;
    padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(128,128,128,0.3);
    background: rgba(0,0,0,0.2); color: inherit; cursor: pointer; backdrop-filter: blur(4px);
  }
  .theme-selector:hover { border-color: rgba(128,128,128,0.6); }
  .content { margin-left: 200px; padding: 40px; max-width: 940px; min-height: 100vh; box-sizing: border-box; }
  .header-img { width: 100%; height: auto; border-radius: 12px; margin: 0 0 1.2em; border: 1px solid rgba(128,128,128,0.25); display: block; }
  .byline { font-size: 0.85rem; opacity: 0.75; margin-bottom: 2em; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .ai-chip {
    display: inline-flex; align-items: center; gap: 6px; font-size: 0.72rem; text-decoration: none;
    padding: 3px 10px; border-radius: 999px; border: 1px solid rgba(128,128,128,0.4);
    opacity: 0.85; text-transform: uppercase; letter-spacing: 0.06em;
  }
  .ai-chip:hover { opacity: 1; }
  .ai-chip svg { width: 14px; height: 14px; }
  .ai-chip img { height: 14px; width: auto; vertical-align: middle; }
  .article-footer { margin-top: 3em; padding-top: 1em; border-top: 1px solid rgba(128,128,128,0.3); font-size: 0.82rem; opacity: 0.85; }
  .ai-footer { display: flex; align-items: center; gap: 12px; margin-top: 1em; flex-wrap: wrap; }
  .ai-footer img { height: 26px; width: auto; opacity: 0.8; }
  .ai-footer a { color: inherit; }
  html { scroll-behavior: smooth; }
  @media (max-width: 900px) { .toc { display: none; } .content { margin-left: 0; } }
</style>
</head>
<body>
<select class="theme-selector" id="theme-switcher" title="Switch theme">
      ${themeOptions(p.theme, p.themes)}
</select>
${tocHtml}
<main class="content">
${p.headerImgHtml}
<h1>${escapeHtml(p.title)}</h1>
<div class="byline">${p.bylineHtml}<a class="ai-chip" href="${AI_LABEL_URL}" target="_blank" rel="noopener" title="AI-generated content disclosure — ai-label.org">${p.aiLabel.iconHtml ?? ''}<span>${escapeHtml(p.aiLabel.text)}</span></a></div>
${htmlBody}
<footer class="article-footer">
${p.footerNote ? `<div>${p.footerNote}</div>` : ''}
<div class="ai-footer">
  <a href="${AI_LABEL_URL}" target="_blank" rel="noopener"><img src="../../assets/ai-label/ai-label_banner-made-with-ai.svg" alt="Made with AI — ai-label.org"></a>
  <span><a href="${AI_LABEL_URL}" target="_blank" rel="noopener">AI label</a>: ${escapeHtml(p.aiLabel.text)}. Header art generated by an AI agent. Content is CC0-labeled per ai-label.org.</span>
</div>
</footer>
</main>
<script>
(function() {
  const themeLink = document.getElementById('theme-link');
  const switcher = document.getElementById('theme-switcher');
  switcher.addEventListener('change', (e) => {
    themeLink.href = '../../themes/' + e.target.value + '.css';
  });
})();
(function() {
  const links = document.querySelectorAll('.toc a[data-id]');
  if (!links.length) return;
  const ids = Array.from(links).map(a => a.dataset.id);
  const headings = ids.map(id => document.getElementById(id)).filter(Boolean);
  function update() {
    let active = headings[0];
    const offset = 80;
    for (const h of headings) {
      if (h.getBoundingClientRect().top <= offset) active = h;
    }
    links.forEach(a => { a.classList.toggle('active', a.dataset.id === active?.id); });
  }
  document.querySelector('.content')?.addEventListener('scroll', update);
  window.addEventListener('scroll', update);
  update();
})();
</script>
</body>
</html>
`;
}