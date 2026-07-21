// Client handlers for Function-rendered project listings + viewers.
// Loaded as /assets/viewer.js (non-hashed) from edge-rendered HTML.
// Project controls use document-level event delegation so chips work even if
// the tree markup changes (data-proj-tree preferred, data-flat-list fallback).

(function () {
  // --- Copy link ---
  document.querySelectorAll('[data-copy-link]').forEach((copyBtn) => {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        copyBtn.setAttribute('data-copied', '1');
        setTimeout(() => copyBtn.removeAttribute('data-copied'), 1300);
      } catch {
        window.prompt('Copy this link:', window.location.href);
      }
    });
  });

  // --- Print ---
  document.querySelectorAll('[data-print]').forEach((btn) => {
    btn.addEventListener('click', () => window.print());
  });

  // --- Instant tooltips ---
  const tipEl = document.createElement('div');
  tipEl.className = 'tip';
  tipEl.hidden = true;
  document.body.appendChild(tipEl);
  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('[data-tip]');
    if (!target) return;
    tipEl.textContent = target.dataset.tip;
    tipEl.hidden = false;
    const r = target.getBoundingClientRect();
    tipEl.style.left = r.left + r.width / 2 - tipEl.offsetWidth / 2 + 'px';
    tipEl.style.top = r.bottom + 6 + 'px';
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('[data-tip]')) tipEl.hidden = true;
  });

  // --- Project filter / sort / expand (delegated; resilient to DOM variants) ---
  try {
    initProjectControls();
  } catch (err) {
    console.error('[viewer] project controls failed:', err);
  }

  // --- Copy code buttons on MD pages ---
  try {
    initCodeCopy();
  } catch (err) {
    console.error('[viewer] code copy failed:', err);
  }

  function initProjectControls() {
    const treeRoot =
      document.querySelector('[data-proj-tree]') || document.querySelector('[data-flat-list]');
    if (!treeRoot) return;

    const pf = document.querySelector('[data-proj-filter]');
    const countEl = document.querySelector('[data-filter-count]');
    const noRes = document.querySelector('[data-no-results]');
    const typeFilter = document.querySelector('[data-type-filter]');
    const sortFilter = document.querySelector('[data-sort-filter]');

    const params = new URLSearchParams(window.location.search);
    let activeType = params.get('type') || 'all';
    let activeSort = params.get('sort') || 'recent';
    if (pf) pf.value = params.get('q') || '';

    const typeBtns = () =>
      typeFilter ? Array.from(typeFilter.querySelectorAll('[data-type]')) : [];
    const sortBtns = () =>
      sortFilter ? Array.from(sortFilter.querySelectorAll('[data-sort]')) : [];

    const syncActiveChips = () => {
      typeBtns().forEach((b) => b.classList.toggle('is-active', b.dataset.type === activeType));
      sortBtns().forEach((b) => b.classList.toggle('is-active', b.dataset.sort === activeSort));
    };
    syncActiveChips();

    const allItems = () => Array.from(treeRoot.querySelectorAll('li[data-search]'));
    const allGroups = () => Array.from(treeRoot.querySelectorAll('.proj-group'));

    const fuzzy = (q, s) => {
      let h = 0,
        score = 0,
        streak = 0;
      for (const ch of q) {
        const i = s.indexOf(ch, h);
        if (i === -1) return -1;
        streak = i === h ? streak + 1 : 0;
        score += 1 + streak * 2 - (i - h) * 0.05;
        h = i + 1;
      }
      return score;
    };

    const syncUrl = () => {
      const p = new URLSearchParams();
      if (pf?.value.trim()) p.set('q', pf.value.trim());
      if (activeType !== 'all') p.set('type', activeType);
      if (activeSort !== 'recent') p.set('sort', activeSort);
      const qs = p.toString();
      history.replaceState(
        null,
        '',
        qs ? `${window.location.pathname}?${qs}` : window.location.pathname,
      );
    };

    const cmpRecent = (da, db) => {
      if (da && db && da !== db) return db.localeCompare(da);
      if (da && !db) return -1;
      if (db && !da) return 1;
      return 0;
    };

    const sortList = (ul) => {
      const lis = Array.from(ul.querySelectorAll(':scope > li[data-search]'));
      lis.sort((a, b) => {
        if (activeSort === 'recent') {
          const r = cmpRecent(a.dataset.date || '', b.dataset.date || '');
          if (r) return r;
        } else if (activeSort === 'type') {
          if (a.dataset.type !== b.dataset.type) return a.dataset.type.localeCompare(b.dataset.type);
        }
        return (a.dataset.title || '').localeCompare(b.dataset.title || '');
      });
      lis.forEach((li) => ul.appendChild(li));
    };

    const apply = () => {
      const items = allItems();
      const groupEls = allGroups();
      const total = items.length;
      const q = (pf?.value || '').trim().toLowerCase();
      const filtering = !!q || activeType !== 'all';
      let shown = 0;
      for (const li of items) {
        const typeOk = activeType === 'all' || li.dataset.type === activeType;
        let textOk = true;
        if (q) {
          textOk = fuzzy(q, li.dataset.search || '') >= 0;
        }
        const vis = typeOk && textOk;
        li.hidden = !vis;
        if (vis) shown++;
      }
      // Sort files within each folder list (or the flat list root)
      treeRoot.querySelectorAll('.file-list').forEach(sortList);
      if (treeRoot.matches('[data-flat-list]') && treeRoot.tagName === 'UL') {
        sortList(treeRoot);
      }
      // Hide empty folder groups bottom-up (deepest first)
      const groups = groupEls.slice().sort(
        (a, b) => Number(b.dataset.depth || 0) - Number(a.dataset.depth || 0),
      );
      for (const g of groups) {
        const visibleFiles = g.querySelectorAll(':scope > .file-list > li[data-search]:not([hidden])');
        const visibleChildGroups = Array.from(g.querySelectorAll(':scope > .proj-group')).filter(
          (c) => !c.hidden,
        );
        const has = visibleFiles.length > 0 || visibleChildGroups.length > 0;
        g.hidden = filtering && !has;
        if (filtering && has) g.open = true;
      }
      if (countEl) {
        countEl.textContent = filtering
          ? `${shown} / ${total}`
          : `${total} file${total === 1 ? '' : 's'}`;
      }
      if (noRes) noRes.hidden = shown !== 0;
      syncUrl();
    };

    // Event delegation — chips/filter always work even if nodes re-render
    document.addEventListener('click', (e) => {
      const typeBtn = e.target.closest('[data-type-filter] [data-type]');
      if (typeBtn) {
        activeType = typeBtn.dataset.type || 'all';
        syncActiveChips();
        apply();
        return;
      }
      const sortBtn = e.target.closest('[data-sort-filter] [data-sort]');
      if (sortBtn) {
        activeSort = sortBtn.dataset.sort || 'recent';
        syncActiveChips();
        apply();
        return;
      }
      if (e.target.closest('[data-expand-all]')) {
        allGroups().forEach((g) => {
          g.open = true;
        });
        return;
      }
      if (e.target.closest('[data-collapse-all]')) {
        allGroups().forEach((g) => {
          g.open = false;
        });
      }
    });

    if (pf) {
      pf.addEventListener('input', apply);
    }

    apply();
  }

  function initCodeCopy() {
    const body = document.querySelector('.md-body');
    if (!body) return;
    body.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector('.code-copy')) return;
      pre.classList.add('has-copy');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'code-copy';
      btn.textContent = 'Copy';
      btn.setAttribute('aria-label', 'Copy code');
      btn.addEventListener('click', async () => {
        const code = pre.querySelector('code');
        const text = code ? code.textContent : pre.textContent;
        try {
          await navigator.clipboard.writeText(text || '');
          btn.textContent = 'Copied!';
          setTimeout(() => {
            btn.textContent = 'Copy';
          }, 1300);
        } catch {
          btn.textContent = 'Failed';
          setTimeout(() => {
            btn.textContent = 'Copy';
          }, 1300);
        }
      });
      pre.appendChild(btn);
    });
  }

  // --- Share modal ---
  const shareBtns = document.querySelectorAll('[data-share]');
  const shareModal = document.getElementById('share-modal');
  if (shareBtns.length && shareModal) {
    let currentProject = '',
      currentPath = '';

    shareBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        currentProject = btn.dataset.shareProject || '';
        currentPath = btn.dataset.sharePath || '';
        shareModal.hidden = false;
        shareModal.querySelector('[data-share-result]').hidden = true;
        shareModal.querySelector('[data-share-error]').hidden = true;
        const gen = shareModal.querySelector('[data-share-generate]');
        gen.hidden = false;
        gen.disabled = false;
        gen.textContent = 'Generate link';
        shareModal.querySelector('[data-share-ttl]').value = '30d';
      });
    });

    shareModal.querySelector('[data-share-close]').addEventListener('click', () => {
      shareModal.hidden = true;
    });
    shareModal.addEventListener('click', (e) => {
      if (e.target === shareModal) shareModal.hidden = true;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !shareModal.hidden) shareModal.hidden = true;
    });

    const generateBtn = shareModal.querySelector('[data-share-generate]');
    const resultRow = shareModal.querySelector('[data-share-result]');
    const urlInput = shareModal.querySelector('#share-url');
    const errorEl = shareModal.querySelector('[data-share-error]');

    generateBtn.addEventListener('click', async () => {
      generateBtn.disabled = true;
      generateBtn.textContent = 'Generating…';
      errorEl.hidden = true;
      const ttl = shareModal.querySelector('[data-share-ttl]').value;
      try {
        const resp = await fetch('/share', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project: currentProject, path: currentPath, ttl }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Failed to create share link');
        urlInput.value = data.url;
        resultRow.hidden = false;
        generateBtn.hidden = true;
      } catch (err) {
        errorEl.textContent = err.message || 'Something went wrong.';
        errorEl.hidden = false;
        generateBtn.disabled = false;
        generateBtn.textContent = 'Generate link';
      }
    });

    shareModal.querySelector('[data-share-copy]').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(urlInput.value);
        const copyBtn = shareModal.querySelector('[data-share-copy]');
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
        }, 1300);
      } catch {
        urlInput.select();
        document.execCommand('copy');
      }
    });
  }
})();
