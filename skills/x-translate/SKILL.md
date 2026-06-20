---
name: x-translate
description: Translate an X (Twitter) post or X Article into Vietnamese and publish it as a styled, self-contained reading artifact on artifacts.hoangtrung.dev, with a prominent link back to the original post. Use when the user gives an x.com / twitter.com link and wants it translated to Vietnamese and deployed as an artifact, or says "dịch bài X", "dịch tweet này sang tiếng Việt", "translate this tweet/article and post it". Covers fetching X content (login-walled), faithful Vietnamese translation, building the HTML artifact, and delivering it.
---

# X → Vietnamese Artifact

Turn an X post / X Article link into a Vietnamese translated reading artifact, delivered to
artifacts.hoangtrung.dev with a prominent link to the original.

## Quick start
1. Fetch the source text (X blocks bots — see Workflow).
2. Translate to Vietnamese — faithful, natural (see [REFERENCE.md](REFERENCE.md)).
3. Fill `templates/article.html` (config JSON + static `<title>` + `<article>` body of `<h2>`s).
4. Deliver via `~/Local/Work/solashi/share-artifacts/deliver.sh`.

Read-aloud is **built in and free**: the template's "Đọc bài" player uses the device's own
voice (Web Speech API). No audio files are generated or deployed — the artifact stays light
(~tens of KB). Do **not** add inline/base64 audio; it bloats the HTML to several MB.

## Workflow

### 1. Get the source text
- X blocks bots. Use the **browser** tool (`open` → `observe` → `extract('text')`).
- The tweet card preview often holds the first ~2 lines + a linked **X Article**.
- X *Articles* are frequently **login-walled**. If the article page redirects to a login
  interstitial, do NOT try to log in. Instead `web_search` for mirrors — e.g.
  `"how to be good at research" site:huggingface.co`, Medium reprints, forum mirrors — then
  `read` the cleanest full-text copy.
- Capture: **title, author handle (@...), original post URL, full body, section headings**.

### 2. Translate to Vietnamese
- Faithful meaning, natural Vietnamese. Keep proper names (Richard Hamming, Karpathy).
- Keep widely-known English terms (backprop, mixture of experts, baseline, ablate) — italicize
  on first use and optionally gloss in parentheses. Full style guide in REFERENCE.md.
- Preserve structure: intro → sections → closing.

### 3. Build the artifact
- Copy `templates/article.html`. It auto-generates: reading-progress bar, dark/light mode,
  sticky table of contents (built from your `<h2>`s), and a prominent **source banner** linking
  to the original.
- Set the config in `<script id="xlate-config" type="application/json">`: `title`, `titleAccent`
  (one word to colorize), `lead`, `author`, `sourceUrl`, `sourceLabel`.
- Also set the static `<title>` to `"<title> — Bản dịch tiếng Việt"`: the project **listing**
  reads the static `<title>` (not the runtime JS one), so a placeholder left there shows up as
  the file's title in the listing.
- Put translated body inside `<article id="xlate-body">` using `p`, `h2` (auto-numbered + TOC'd),
  `blockquote`, `figure.pullquote`, `hr.ornament`.
- Must stay **self-contained**: inline CSS/JS, images as `data:` URIs only.
- Section numbers are **CSS counters** (not text). Never re-add a `<span class="sec-num">` —
  it would enter `textContent` and misalign the read-aloud sentence highlighting.

### 4. Deliver
```bash
cd ~/Local/Work/solashi/share-artifacts
./deliver.sh /tmp/<slug>.html read      # default project: read
```
Return both URLs `deliver.sh` prints: viewer + raw. The artifact is self-contained and light
(~tens of KB) — read-aloud is the device's own voice at runtime, nothing to bundle.

## Rules
- **Always** include a prominent link to the original post (source banner is built-in; also keep
  one in the footer).
- Credit the original author. **Never** add AI/agent authorship markers (no "Generated with",
  no Co-Authored-By). See REFERENCE.md → Document delivery gate.
- Default project is `read`; ask only if classification is genuinely unclear.
- Vietnamese diacritics must be correct; proofread before delivering.
