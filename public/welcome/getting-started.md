---
title: Getting started
description: A quick tour of this artifacts site — how links work, what gets rendered, and how search and access control fit together.
tags:
  - guide
  - welcome
  - reference
date: 2026-06-19
---

# Getting started

This site hosts shareable artifacts — rendered reports, investigations, and explainers.
Every artifact keeps a stable link, so anything you have shared before keeps working.

## How links work

Each artifact lives under a project folder and is reachable three ways:

| Path                       | What it serves                                  |
| -------------------------- | ----------------------------------------------- |
| `/<project>/<file>`        | The viewer page (toolbar + rendered content)    |
| `/<project>/<file>.html`   | The raw HTML file, served verbatim              |
| `/<project>/<file>.md`     | The raw Markdown file, served verbatim          |

The viewer adds a toolbar with download and copy-link actions. The raw paths are
byte-for-byte the original files, so direct links and embeds keep resolving.

## What gets rendered

- **Markdown** is rendered as a styled page with headings, code highlighting, and a table of contents.
- **HTML** artifacts are self-contained, so the viewer embeds them in an iframe with an option to open them fullscreen.

## A small code sample

Metadata for a Markdown artifact comes from its frontmatter:

```yaml
---
title: My report
description: One-line summary shown in the gallery
tags: [infra, audit]
date: 2026-06-19
---
```

## Search and access

The gallery on the home page supports full-text search and tag filtering.
Some projects are private and prompt for a password before their artifacts load;
public projects like this one are open to anyone with the link.
