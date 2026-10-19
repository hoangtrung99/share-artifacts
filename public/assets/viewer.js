// Client behaviours for the artifact shell.
//
// Loaded as /assets/viewer.js (non-hashed) by both the Astro shell pages and the
// edge-rendered Function pages. Everything binds to the server-rendered markup through
// data attributes, so no markup is injected for user text and no framework is needed.
//
// Sections: theme picker, More menu, tooltips, toast, clipboard, share dialog,
// project listing filters, reader TOC + reading progress, highlight.js, small shell extras.

(function () {
  'use strict';

  /* ------------------------------------------------------------------ helpers */

  // Programmatic focus (popovers, dialog) must not pop a tooltip; natural tab/click focus may.
  let programmaticFocus = false;
  function focusEl(el) {
    if (!el || typeof el.focus !== 'function') return;
    programmaticFocus = true;
    try {
      el.focus();
    } finally {
      programmaticFocus = false;
    }
  }

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function safe(label, fn) {
    try {
      fn();
    } catch (error) {
      console.error('[viewer] ' + label + ' failed:', error);
    }
  }

  /** Place a fixed-position popover under its trigger, clamped to the viewport. */
  function positionPopover(popover, trigger, gap) {
    const rect = trigger.getBoundingClientRect();
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const left = Math.max(8, Math.min(rect.right - width, viewportW - width - 8));
    let top = rect.bottom + gap;
    if (top + height > viewportH - 8) top = rect.top - height - gap;
    popover.style.left = left + 'px';
    popover.style.top = Math.max(8, top) + 'px';
  }

  /* ------------------------------------------------------------------- toast */

  let toastEl = null;
  let toastTextEl = null;
  let toastIconUse = null;
  let toastTimer = 0;

  function initToast() {
    toastEl = document.getElementById('toast');
    toastTextEl = document.getElementById('toast-text');
    toastIconUse = toastEl ? toastEl.querySelector('.icon use') : null;
  }

  /** Show a short status pill: success (check, role=status) or error (alert icon, role=alert). */
  function showToast(text, type) {
    if (!toastEl) return;
    if (toastTextEl) toastTextEl.textContent = text;
    if (toastIconUse) toastIconUse.setAttribute('href', type === 'error' ? '#i-alert' : '#i-check');
    toastEl.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('is-visible');
    }, 1700);
  }

  /* ----------------------------------------------------------------- tooltip */

  let tipEl = null;
  let tipTimer = 0;
  let lastTipShownAt = 0;

  function hoverFine() {
    try {
      return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    } catch (error) {
      return true;
    }
  }

  function initTooltip() {
    tipEl = document.getElementById('tip');
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'tip';
      tipEl.id = 'tip';
      tipEl.setAttribute('role', 'tooltip');
      tipEl.hidden = true;
      document.body.appendChild(tipEl);
    }

    document.addEventListener('pointerover', function (event) {
      if (!hoverFine()) return;
      const target = event.target.closest('[data-tip]');
      if (!target || target.contains(event.relatedTarget)) return;
      scheduleTip(target);
    });
    document.addEventListener('pointerout', function (event) {
      const target = event.target.closest('[data-tip]');
      if (!target || target.contains(event.relatedTarget)) return;
      hideTip();
    });
    document.addEventListener('focusin', function (event) {
      // Touch/keyboard-focus tooltips get stuck on coarse pointers; hover/fine only.
      if (programmaticFocus || !hoverFine()) return;
      const target = event.target.closest('[data-tip]');
      if (target) showTip(target);
    });
    document.addEventListener('focusout', function (event) {
      if (event.target.closest('[data-tip]')) hideTip();
    });
    document.addEventListener('pointerdown', function () {
      hideTip();
    });
  }

  function showTip(target) {
    const text = target.dataset.tip;
    if (!text || !tipEl) return;
    tipEl.textContent = text;
    tipEl.hidden = false;
    const rect = target.getBoundingClientRect();
    const width = tipEl.offsetWidth;
    const height = tipEl.offsetHeight;
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8));
    let top = rect.bottom + 8;
    if (top + height > window.innerHeight - 8) top = rect.top - height - 8;
    tipEl.style.left = left + 'px';
    tipEl.style.top = Math.max(8, top) + 'px';
    requestAnimationFrame(function () {
      if (!tipEl.hidden && tipEl.textContent === text) tipEl.classList.add('is-visible');
    });
    lastTipShownAt = Date.now();
  }

  function hideTip() {
    clearTimeout(tipTimer);
    if (!tipEl) return;
    tipEl.classList.remove('is-visible');
    setTimeout(function () {
      if (!tipEl.classList.contains('is-visible')) tipEl.hidden = true;
    }, 120);
  }

  // First tooltip needs a short delay; while one is already active the next is instant.
  function scheduleTip(target) {
    clearTimeout(tipTimer);
    const delay = Date.now() - lastTipShownAt < 900 ? 0 : 380;
    tipTimer = setTimeout(function () {
      showTip(target);
    }, delay);
  }

  /* ------------------------------------------------------------------- theme */

  const THEME_KEY = 'artifacts-theme';
  const DEFAULT_THEME = 'coast';
  const THEMES = {
    coast: { scheme: 'dark', color: '#0a1119', label: 'Coast' },
    forest: { scheme: 'dark', color: '#0b1410', label: 'Forest' },
    ink: { scheme: 'dark', color: '#12110f', label: 'Ink' },
    paper: { scheme: 'light', color: '#faf8f3', label: 'Paper' },
    sepia: { scheme: 'light', color: '#f5eee0', label: 'Sepia' },
  };

  let themePopover = null;
  let themeTrigger = null;
  let themeCloseTimer = 0;

  function initialTheme() {
    const fromUrl = new URLSearchParams(location.search).get('theme');
    if (fromUrl && THEMES[fromUrl]) return fromUrl;
    let stored = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch (error) {
      stored = null;
    }
    return stored && THEMES[stored] ? stored : DEFAULT_THEME;
  }

  function applyTheme(name, persist) {
    const theme = THEMES[name] ? name : DEFAULT_THEME;
    const config = THEMES[theme];
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.scheme = config.scheme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', config.color);
    document.querySelectorAll('[data-theme-picker]').forEach(function (button) {
      button.setAttribute('aria-label', 'Choose theme (current: ' + config.label + ')');
    });
    document.querySelectorAll('.theme-option').forEach(function (option) {
      option.setAttribute('aria-selected', String(option.dataset.themeValue === theme));
    });
    if (persist) {
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch (error) {
        /* storage can be unavailable in private mode; the theme still applies */
      }
    }
  }

  function initTheme() {
    themePopover = document.getElementById('theme-popover');
    applyTheme(initialTheme(), false);
    if (!themePopover) return;

    document.querySelectorAll('[data-theme-picker]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (!themePopover.hidden && themeTrigger === button) closeThemePopover(true);
        else openThemePopover(button);
      });
    });

    themePopover.addEventListener('click', function (event) {
      const option = event.target.closest('.theme-option');
      if (!option) return;
      applyTheme(option.dataset.themeValue, true);
      closeThemePopover(true);
    });

    themePopover.addEventListener('keydown', function (event) {
      const options = Array.prototype.slice.call(themePopover.querySelectorAll('.theme-option'));
      if (!options.length) return;
      const index = options.indexOf(document.activeElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        closeThemePopover(true);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        options[(index + 1 + options.length) % options.length].focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        options[(index - 1 + options.length) % options.length].focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        options[0].focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        options[options.length - 1].focus();
      }
    });

    document.addEventListener('pointerdown', function (event) {
      if (themePopover.hidden) return;
      if (themePopover.contains(event.target) || event.target.closest('[data-theme-picker]')) return;
      closeThemePopover(false);
    });
  }

  function openThemePopover(trigger) {
    if (!themePopover || !trigger) return;
    closeCatPopover(false);
    closeMoreMenu(false);
    hideTip();
    clearTimeout(themeCloseTimer);
    themeTrigger = trigger;
    themePopover.hidden = false;
    positionPopover(themePopover, trigger, 8);
    requestAnimationFrame(function () {
      if (!themePopover.hidden) themePopover.classList.add('is-open');
    });
    document.querySelectorAll('[data-theme-picker]').forEach(function (button) {
      button.setAttribute('aria-expanded', String(button === trigger));
    });
    const selected =
      themePopover.querySelector('.theme-option[aria-selected="true"]') || themePopover.querySelector('.theme-option');
    if (selected) focusEl(selected);
  }

  function closeThemePopover(restoreFocus) {
    if (!themePopover || themePopover.hidden) return;
    themePopover.classList.remove('is-open');
    clearTimeout(themeCloseTimer);
    themeCloseTimer = setTimeout(function () {
      if (!themePopover.classList.contains('is-open')) themePopover.hidden = true;
    }, 120);
    document.querySelectorAll('[data-theme-picker]').forEach(function (button) {
      button.setAttribute('aria-expanded', 'false');
    });
    const trigger = themeTrigger;
    themeTrigger = null;
    if (restoreFocus && trigger && document.contains(trigger)) focusEl(trigger);
  }

  /* --------------------------------------------------------------- More menu */

  let morePopover = null;
  let moreTrigger = null;
  let moreCloseTimer = 0;

  function moreItems() {
    return morePopover ? Array.prototype.slice.call(morePopover.querySelectorAll('.more-item[data-action]')) : [];
  }

  function resolveRawUrl(trigger) {
    const fromTrigger = trigger && trigger.dataset.rawUrl;
    if (fromTrigger) return fromTrigger;
    const carrier = document.querySelector('[data-raw-url]');
    if (carrier) return carrier.dataset.rawUrl || carrier.getAttribute('href') || '';
    const download = document.querySelector('[data-download]');
    if (download) return download.dataset.rawUrl || download.getAttribute('href') || '';
    const frame = document.querySelector('iframe.viewer-frame, iframe.bleed-frame, .viewer-main iframe');
    return (frame && frame.getAttribute('src')) || '';
  }

  function resolveSignoutUrl(trigger) {
    const fromTrigger = trigger && (trigger.dataset.signoutUrl || trigger.dataset.logoutUrl);
    if (fromTrigger) return fromTrigger;
    const carrier = document.querySelector('[data-signout-url], [data-logout-url]');
    if (carrier) {
      return carrier.dataset.signoutUrl || carrier.dataset.logoutUrl || carrier.getAttribute('href') || '';
    }
    const link = document.querySelector('a[href*="/logout"]');
    return (link && link.getAttribute('href')) || '';
  }

  function syncMoreItems(trigger) {
    const reader = !!document.getElementById('read-progress-bar') || !!document.querySelector('.reader-body, #reader-body');
    const rawUrl = resolveRawUrl(trigger);
    const signoutUrl = resolveSignoutUrl(trigger);
    moreItems().forEach(function (item) {
      const action = item.dataset.action;
      if (action === 'raw') item.hidden = !rawUrl;
      else if (action === 'print') item.hidden = !reader;
      else if (action === 'versions') item.hidden = item.getAttribute('data-available') !== 'true';
      else if (action === 'signout') item.hidden = !signoutUrl;
    });
  }

  function initMoreMenu() {
    morePopover = document.getElementById('more-popover');
    if (!morePopover) return;

    document.querySelectorAll('[data-more]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (!morePopover.hidden && moreTrigger === button) closeMoreMenu(true);
        else openMoreMenu(button);
      });
    });

    morePopover.addEventListener('click', function (event) {
      const item = event.target.closest('.more-item[data-action]');
      if (!item || item.hidden) return;
      const action = item.dataset.action;
      if (action === 'versions') {
        closeMoreMenu(false);
        reviewOpenVersions();
        return;
      }
      if (action === 'copy') {
        const trigger = moreTrigger;
        copyText(location.href).then(function (ok) {
          showToast(ok ? 'Link copied' : 'Copy failed — select the link instead', ok ? 'success' : 'error');
          if (moreTrigger === trigger) closeMoreMenu(true);
        });
        return;
      }
      if (action === 'raw') {
        const url = resolveRawUrl(moreTrigger);
        closeMoreMenu(true);
        if (url) window.open(url, '_blank', 'noopener');
        else showToast('Raw file is not available on this page.', 'error');
        return;
      }
      if (action === 'print') {
        closeMoreMenu(true);
        window.print();
        return;
      }
      if (action === 'theme') {
        const trigger = moreTrigger;
        closeMoreMenu(false);
        if (trigger) openThemePopover(trigger);
        return;
      }
      if (action === 'signout') {
        const url = resolveSignoutUrl(moreTrigger);
        closeMoreMenu(false);
        if (url) window.location.assign(url);
        else showToast('Sign out is not available here.', 'error');
      }
    });

    morePopover.addEventListener('keydown', function (event) {
      const visible = moreItems().filter(function (item) {
        return !item.hidden;
      });
      if (!visible.length) return;
      const index = visible.indexOf(document.activeElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMoreMenu(true);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        visible[(index + 1 + visible.length) % visible.length].focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        visible[(index - 1 + visible.length) % visible.length].focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        visible[0].focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        visible[visible.length - 1].focus();
      }
    });

    document.addEventListener('pointerdown', function (event) {
      if (morePopover.hidden) return;
      if (morePopover.contains(event.target) || event.target.closest('[data-more]')) return;
      closeMoreMenu(false);
    });
  }

  function openMoreMenu(trigger) {
    if (!morePopover || !trigger) return;
    closeCatPopover(false);
    closeThemePopover(false);
    hideTip();
    clearTimeout(moreCloseTimer);
    moreTrigger = trigger;
    syncMoreItems(trigger);
    morePopover.hidden = false;
    positionPopover(morePopover, trigger, 8);
    requestAnimationFrame(function () {
      if (!morePopover.hidden) morePopover.classList.add('is-open');
    });
    document.querySelectorAll('[data-more]').forEach(function (button) {
      button.setAttribute('aria-expanded', String(button === trigger));
    });
    const first = moreItems().filter(function (item) {
      return !item.hidden;
    })[0];
    if (first) focusEl(first);
  }

  function closeMoreMenu(restoreFocus) {
    if (!morePopover || morePopover.hidden) return;
    morePopover.classList.remove('is-open');
    clearTimeout(moreCloseTimer);
    moreCloseTimer = setTimeout(function () {
      if (!morePopover.classList.contains('is-open')) morePopover.hidden = true;
    }, 120);
    document.querySelectorAll('[data-more]').forEach(function (button) {
      button.setAttribute('aria-expanded', 'false');
    });
    const trigger = moreTrigger;
    moreTrigger = null;
    if (restoreFocus && trigger && document.contains(trigger)) focusEl(trigger);
  }

  /* --------------------------------------------------------- category popover */

  let catFilter = null;
  let catPopover = null;
  let catTrigger = null;

  function catOptions() {
    return catPopover ? Array.prototype.slice.call(catPopover.querySelectorAll('[data-cat]')) : [];
  }

  function initCatPopover() {
    catFilter = document.querySelector('[data-cat-filter]');
    catPopover = document.querySelector('[data-cat-popover]');
    catTrigger = catFilter ? catFilter.querySelector('[data-cat-trigger]') : null;
    if (!catFilter || !catPopover || !catTrigger) return;

    catTrigger.addEventListener('click', function () {
      if (!catPopover.hidden) closeCatPopover(true);
      else openCatPopover();
    });

    catPopover.addEventListener('keydown', function (event) {
      const options = catOptions();
      if (!options.length) return;
      const index = options.indexOf(document.activeElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCatPopover(true);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        options[(index + 1 + options.length) % options.length].focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        options[(index - 1 + options.length) % options.length].focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        options[0].focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        options[options.length - 1].focus();
      }
    });

    document.addEventListener('pointerdown', function (event) {
      if (catPopover.hidden) return;
      if (catFilter.contains(event.target)) return;
      closeCatPopover(false);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || catPopover.hidden) return;
      event.preventDefault();
      closeCatPopover(true);
    });
  }

  function openCatPopover() {
    if (!catPopover || !catTrigger) return;
    hideTip();
    closeThemePopover(false);
    closeMoreMenu(false);
    catPopover.hidden = false;
    requestAnimationFrame(function () {
      if (!catPopover.hidden) catPopover.classList.add('is-open');
    });
    catTrigger.setAttribute('aria-expanded', 'true');
    const first = catOptions()[0];
    if (first) focusEl(first);
  }

  function closeCatPopover(restoreFocus) {
    if (!catPopover || catPopover.hidden) return;
    // The popover is anchored by CSS without an open/close transition, so hide it at once.
    catPopover.classList.remove('is-open');
    catPopover.hidden = true;
    catTrigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus && catTrigger && document.contains(catTrigger)) focusEl(catTrigger);
  }

  /* --------------------------------------------------------------- clipboard */

  function legacyCopy(text) {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (error) {
      return false;
    }
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      /* permission denied or insecure context — fall through to execCommand */
    }
    return legacyCopy(text);
  }

  function markCopied(el) {
    const use = el.querySelector('use');
    if (use) {
      const original = use.getAttribute('href') || '#i-link';
      use.setAttribute('href', '#i-check');
      setTimeout(function () {
        if (use.getAttribute('href') === '#i-check') use.setAttribute('href', original);
      }, 1400);
    }
    el.classList.add('is-copied');
    setTimeout(function () {
      el.classList.remove('is-copied');
    }, 1400);
  }

  function markCodeCopied(button) {
    if (button.querySelector('use')) {
      markCopied(button);
      return;
    }
    const label = button.textContent;
    button.textContent = 'Copied';
    button.classList.add('is-copied');
    setTimeout(function () {
      button.textContent = label;
      button.classList.remove('is-copied');
    }, 1400);
  }

  function initCopy() {
    document.addEventListener('click', async function (event) {
      const copy = event.target.closest('[data-copy-code], [data-copy], [data-copy-link], [data-share-copy]');
      if (!copy) return;

      if (copy.hasAttribute('data-copy-code')) {
        const pre = copy.closest('pre');
        const code = (pre && pre.querySelector('code')) || (copy.parentElement && copy.parentElement.querySelector('code'));
        const ok = await copyText(code ? code.textContent : '');
        if (ok) {
          markCodeCopied(copy);
          showToast('Code copied');
        } else {
          showToast('Copy failed — select the code instead', 'error');
        }
        return;
      }

      let text = location.href;
      const selector = copy.getAttribute('data-copy-target') || (copy.hasAttribute('data-share-copy') ? '#share-url' : '');
      if (selector) {
        const target = document.querySelector(selector);
        if (target) text = target.value != null ? target.value : target.textContent || '';
      }
      const ok = await copyText(text);
      if (ok) {
        markCopied(copy);
        showToast('Link copied');
      } else {
        showToast('Copy failed — select the link instead', 'error');
      }
    });
  }

  /* ------------------------------------------------------------- share dialog */

  let shareModal = null;
  let shareCloseTimer = 0;
  let shareProject = '';
  let sharePath = '';
  let shareLastFocus = null;
  let sharePrevOverflow = '';
  let shareInerted = [];
  let shareGenerating = false;

  function initShare() {
    shareModal = document.getElementById('share-modal');
    if (!shareModal) return;

    document.addEventListener('click', function (event) {
      const trigger = event.target.closest('[data-share], [data-open-share]');
      if (trigger) {
        event.preventDefault();
        openShare(trigger);
        return;
      }
      if (shareModal.hidden) return;
      if (event.target.closest('[data-share-close]')) {
        closeShare();
        return;
      }
      const ttl = event.target.closest('[data-share-ttl], [data-ttl]');
      if (ttl && ttl.tagName !== 'SELECT') {
        const value = ttl.getAttribute('data-share-ttl') || ttl.getAttribute('data-ttl');
        setActiveTtl(value);
        return;
      }
      if (event.target.closest('#share-generate, [data-share-generate]')) generateShare();
    });

    shareModal.addEventListener('click', function (event) {
      if (event.target === shareModal) closeShare();
    });

    document.addEventListener('keydown', function (event) {
      if (shareModal.hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeShare();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = Array.prototype.slice
        .call(
          shareModal.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        )
        .filter(function (el) {
          return !el.disabled && !el.hidden && el.getClientRects().length > 0;
        });
      if (!focusables.length) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (!shareModal.contains(active)) {
        event.preventDefault();
        focusEl(first);
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        focusEl(last);
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        focusEl(first);
      }
    });
  }

  function projectFromPath() {
    const segment = location.pathname.split('/').filter(Boolean)[0] || '';
    try {
      return decodeURIComponent(segment);
    } catch (error) {
      return segment;
    }
  }

  function openShare(trigger) {
    hideTip();
    closeCatPopover(false);
    closeThemePopover(false);
    closeMoreMenu(false);
    const wasHidden = shareModal.hidden;
    shareLastFocus = trigger || document.activeElement;
    shareProject = trigger.dataset.shareProject || shareModal.dataset.shareProject || projectFromPath();
    sharePath = trigger.dataset.sharePath || shareModal.dataset.sharePath || location.pathname;
    resetShare();
    clearTimeout(shareCloseTimer);
    shareModal.hidden = false;
    setBackgroundInert(true);
    if (wasHidden) sharePrevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () {
      if (!shareModal.hidden) shareModal.classList.add('is-open');
    });
    const card = shareModal.querySelector('.modal-card, [role="dialog"]');
    if (card) focusEl(card);
  }

  function closeShare() {
    if (!shareModal || shareModal.hidden) return;
    shareModal.classList.remove('is-open');
    clearTimeout(shareCloseTimer);
    shareCloseTimer = setTimeout(finishCloseShare, 180);
  }

  function finishCloseShare() {
    if (!shareModal || shareModal.classList.contains('is-open')) return;
    shareModal.hidden = true;
    setBackgroundInert(false);
    document.body.style.overflow = sharePrevOverflow || '';
    const target = shareLastFocus;
    shareLastFocus = null;
    if (target && document.contains(target)) focusEl(target);
  }

  // Inert every sibling along the modal's ancestor chain so nothing behind it is reachable.
  function setBackgroundInert(on) {
    if (!on) {
      shareInerted.forEach(function (el) {
        el.inert = false;
      });
      shareInerted = [];
      return;
    }
    if (shareInerted.length) return;
    let node = shareModal;
    while (node && node !== document.body && node.parentElement) {
      const parent = node.parentElement;
      Array.prototype.forEach.call(parent.children, function (child) {
        if (child === node || child.inert) return;
        child.inert = true;
        shareInerted.push(child);
      });
      node = parent;
    }
  }

  function shareResultEl() {
    return shareModal ? shareModal.querySelector('#share-result, [data-share-result]') : null;
  }

  function shareErrorEl() {
    return shareModal ? shareModal.querySelector('[data-share-error]') : null;
  }

  function shareGenerateEl() {
    return shareModal ? shareModal.querySelector('#share-generate, [data-share-generate]') : null;
  }

  function setShareUrl(value) {
    if (!shareModal) return;
    const el = shareModal.querySelector('#share-url');
    if (!el) return;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value = value;
    else el.textContent = value;
  }

  function ttlButtons() {
    if (!shareModal) return [];
    return Array.prototype.slice
      .call(shareModal.querySelectorAll('[data-share-ttl], [data-ttl]'))
      .filter(function (el) {
        return el.tagName !== 'SELECT';
      });
  }

  function setActiveTtl(value) {
    ttlButtons().forEach(function (button) {
      const own = button.getAttribute('data-share-ttl') || button.getAttribute('data-ttl') || '';
      button.setAttribute('aria-pressed', String(own === value));
    });
  }

  function currentTtl() {
    if (!shareModal) return '30d';
    const select = shareModal.querySelector('select[data-share-ttl], select[data-ttl], #share-ttl');
    if (select) return select.value || '30d';
    const pressed = shareModal.querySelector('[data-share-ttl][aria-pressed="true"], [data-ttl][aria-pressed="true"]');
    if (pressed) return pressed.getAttribute('data-share-ttl') || pressed.getAttribute('data-ttl') || '30d';
    return '30d';
  }

  // The duration field disappears once a link exists (the TTL is baked into the link).
  function setTtlVisible(visible) {
    if (!shareModal) return;
    const select = shareModal.querySelector('select[data-share-ttl], select[data-ttl], #share-ttl');
    if (select) {
      const field = select.closest('.field') || select.parentElement;
      if (field) field.hidden = !visible;
      return;
    }
    const buttons = ttlButtons();
    const group = buttons.length ? buttons[0].closest('.ttl-group') : null;
    if (group) {
      const field = group.closest('.field') || group;
      field.hidden = !visible;
    } else {
      buttons.forEach(function (button) {
        button.hidden = !visible;
      });
    }
  }

  function resetShare() {
    if (!shareModal) return;
    shareGenerating = false;
    const result = shareResultEl();
    if (result) result.hidden = true;
    const error = shareErrorEl();
    if (error) {
      error.hidden = true;
      error.textContent = '';
    }
    const generate = shareGenerateEl();
    if (generate) {
      generate.hidden = false;
      generate.disabled = false;
      generate.removeAttribute('aria-busy');
      if (generate.dataset.originalLabel) {
        generate.textContent = generate.dataset.originalLabel;
        delete generate.dataset.originalLabel;
      }
    }
    setTtlVisible(true);
    setActiveTtl('30d');
    setShareUrl('');
  }

  async function generateShare() {
    if (!shareModal || shareGenerating) return;
    shareGenerating = true;
    const error = shareErrorEl();
    if (error) error.hidden = true;
    const generate = shareGenerateEl();
    if (generate) {
      generate.disabled = true;
      generate.setAttribute('aria-busy', 'true');
      if (!generate.querySelector('svg, span')) {
        generate.dataset.originalLabel = generate.dataset.originalLabel || generate.textContent;
        generate.textContent = 'Creating…';
      }
    }
    try {
      const response = await fetch('/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project: shareProject, path: sharePath, ttl: currentTtl() }),
      });
      let data = {};
      try {
        data = await response.json();
      } catch (parseError) {
        data = {};
      }
      if (shareModal.hidden) return; // closed while the request was in flight
      if (!response.ok) throw new Error((data && data.error) || 'Could not create the share link.');
      if (!data || !data.url) throw new Error('The server did not return a share link.');
      setShareUrl(data.url);
      const result = shareResultEl();
      if (result) result.hidden = false;
      if (generate) generate.hidden = true;
      setTtlVisible(false);
      showToast('Share link created');
      const urlEl = shareModal.querySelector('#share-url');
      if (urlEl) focusEl(urlEl);
    } catch (errorObject) {
      if (shareModal.hidden) return; // closed while the request was in flight
      if (generate) {
        generate.disabled = false;
        if (generate.dataset.originalLabel) {
          generate.textContent = generate.dataset.originalLabel;
          delete generate.dataset.originalLabel;
        }
      }
      const message = (errorObject && errorObject.message) || 'Something went wrong.';
      if (error) {
        error.textContent = message;
        error.hidden = false;
        error.setAttribute('role', 'alert');
      } else {
        showToast(message, 'error');
      }
    } finally {
      shareGenerating = false;
      if (generate) generate.removeAttribute('aria-busy');
    }
  }

  /* ------------------------------------------------------- project listing */

  function cmpRecentEntries(a, b) {
    const da = a.dataset.date || '';
    const db = b.dataset.date || '';
    if (da && db && da !== db) return db.localeCompare(da);
    if (da && !db) return -1;
    if (db && !da) return 1;
    const aa = a.dataset.artifactDate || '';
    const ab = b.dataset.artifactDate || '';
    if (aa && ab && aa !== ab) return ab.localeCompare(aa);
    if (aa && !ab) return -1;
    if (!aa && ab) return 1;
    return 0;
  }

  // Subsequence fuzzy score: higher is better, -1 means no match.
  function fuzzyScore(query, haystack) {
    let cursor = 0;
    let score = 0;
    let streak = 0;
    for (const ch of query) {
      const index = haystack.indexOf(ch, cursor);
      if (index === -1) return -1;
      streak = index === cursor ? streak + 1 : 0;
      score += 1 + streak * 2 - (index - cursor) * 0.05;
      cursor = index + 1;
    }
    return score;
  }

  function initProjectControls() {
    const tree = document.querySelector('[data-proj-tree]') || document.querySelector('[data-flat-list]');
    if (!tree) return;

    const search = document.querySelector('[data-proj-filter]');
    const countEl = document.querySelector('[data-filter-count]');
    const noResults = document.querySelector('[data-no-results]');
    const typeFilter = document.querySelector('[data-type-filter]');
    const sortFilter = document.querySelector('[data-sort-filter]');
    const catRoot = document.querySelector('[data-cat-chips]');

    const rows = function () {
      return Array.prototype.slice.call(tree.querySelectorAll('li[data-search]'));
    };
    const groups = Array.prototype.slice.call(tree.querySelectorAll('details.proj-group'));
    const total = rows().length;
    const initialOpen = new Map(
      groups.map(function (group) {
        return [group, group.open];
      }),
    );
    const forcedOpen = new Set();
    const activeCats = new Set();
    let activeType = 'all';
    let activeSort = 'recent';

    const typeButtons = typeFilter
      ? Array.prototype.slice.call(typeFilter.querySelectorAll('[data-type]'))
      : [];
    const typeValues = new Set(
      typeButtons.map(function (button) {
        return button.dataset.type;
      }),
    );
    const catButtons = catRoot
      ? Array.prototype.slice.call(catRoot.querySelectorAll('[data-cat]'))
      : [];
    const knownCats = new Set();
    rows().forEach(function (row) {
      rowCats(row).forEach(function (cat) {
        knownCats.add(cat);
      });
    });
    // Options can exist without matching rows (Root is always rendered in folder mode, even
    // at count 0), so a ?cat= for one of them must restore rather than be dropped.
    catButtons.forEach(function (button) {
      const value = button.dataset.cat;
      if (value && value !== 'all') knownCats.add(value);
    });

    // Restore state from the URL; values the markup can't represent are ignored.
    const params = new URLSearchParams(location.search);
    if (search) search.value = params.get('q') || '';
    const requestedType = params.get('type');
    if (requestedType && (typeValues.size ? typeValues.has(requestedType) : ['all', 'html', 'md'].indexOf(requestedType) >= 0)) {
      activeType = requestedType;
    }
    const sortValues =
      sortFilter && sortFilter.tagName === 'SELECT'
        ? Array.prototype.map.call(sortFilter.options, function (option) {
            return option.value;
          })
        : ['recent', 'name', 'type'];
    const requestedSort = params.get('sort');
    if (requestedSort && sortValues.indexOf(requestedSort) >= 0) activeSort = requestedSort;
    (params.get('cat') || '')
      .split(',')
      .map(function (value) {
        return value.trim();
      })
      .filter(Boolean)
      .forEach(function (cat) {
        if (knownCats.has(cat)) activeCats.add(cat);
      });
    if (sortFilter && sortFilter.tagName === 'SELECT') sortFilter.value = activeSort;

    function rowCats(row) {
      return (row.dataset.cats || '').split(/\s+/).filter(Boolean);
    }

    function rowText(row) {
      return (row.dataset.search || row.dataset.title || '').toLowerCase();
    }

    function title(row) {
      return row.dataset.title || '';
    }

    function compareRows(a, b) {
      if (activeSort === 'name') return title(a).localeCompare(title(b));
      if (activeSort === 'type') {
        const type = (a.dataset.type || '').localeCompare(b.dataset.type || '');
        if (type) return type;
        return title(a).localeCompare(title(b));
      }
      return cmpRecentEntries(a, b) || title(a).localeCompare(title(b));
    }

    function sortRows() {
      const lists = new Set(tree.querySelectorAll('ul.file-list'));
      if (tree.matches('ul.file-list')) lists.add(tree);
      lists.forEach(function (list) {
        const listRows = Array.prototype.slice.call(list.children).filter(function (child) {
          return child.tagName === 'LI' && child.hasAttribute('data-search');
        });
        if (listRows.length < 2) return;
        listRows.sort(compareRows);
        const fragment = document.createDocumentFragment();
        listRows.forEach(function (row) {
          fragment.appendChild(row);
        });
        list.appendChild(fragment);
      });
    }

    function syncControls() {
      typeButtons.forEach(function (button) {
        button.setAttribute('aria-pressed', String((button.dataset.type || 'all') === activeType));
      });
      catButtons.forEach(function (button) {
        const value = button.dataset.cat || '';
        const pressed = !value || value === 'all' ? activeCats.size === 0 : activeCats.has(value);
        button.setAttribute('aria-pressed', String(pressed));
      });
      updateCatLabel();
    }

    // Compact trigger summary: All / Root / N selected.
    function updateCatLabel() {
      const label = document.querySelector('[data-cat-label]');
      if (!label) return;
      let text = 'Category: All';
      if (activeCats.size === 1 && activeCats.has('root')) text = 'Category: Root';
      else if (activeCats.size > 0) text = 'Category: ' + activeCats.size + ' selected';
      label.textContent = text;
    }

    function emptyMessage(searching) {
      if (activeCats.size && searching) return 'No artifacts match this search in the selected categories.';
      if (activeCats.size) return 'No artifacts in the selected categories.';
      return 'No artifacts match this filter.';
    }

    // Replace only the sentence inside the empty state; keep its icon markup intact.
    function setEmptyText(message) {
      if (!noResults) return;
      const text = noResults.querySelector('[data-no-results-text]');
      if (text) {
        text.textContent = message;
        return;
      }
      for (let node = noResults.lastChild; node; node = node.previousSibling) {
        if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()) {
          node.nodeValue = node.nodeValue.replace(node.nodeValue.trim(), message);
          return;
        }
      }
    }

    function syncUrl(rawQuery) {
      const url = new URL(location.href);
      ['q', 'type', 'sort', 'cat'].forEach(function (key) {
        url.searchParams.delete(key);
      });
      if (rawQuery) url.searchParams.set('q', rawQuery);
      if (activeType !== 'all') url.searchParams.set('type', activeType);
      if (activeSort !== 'recent') url.searchParams.set('sort', activeSort);
      if (activeCats.size) url.searchParams.set('cat', Array.from(activeCats).sort().join(','));
      const next = url.pathname + url.search + url.hash;
      if (next !== location.pathname + location.search + location.hash) history.replaceState(null, '', next);
    }

    function applyFilters() {
      const rawQuery = search ? search.value.trim() : '';
      const query = rawQuery.toLowerCase();
      // An empty project has nothing to filter; keep the server's "no artifacts yet" state.
      const filtering = total > 0 && (!!query || activeType !== 'all' || activeCats.size > 0);
      let shown = 0;

      rows().forEach(function (row) {
        const typeOk = activeType === 'all' || row.dataset.type === activeType;
        const catsOk = activeCats.size === 0 || rowCats(row).some(function (cat) {
          return activeCats.has(cat);
        });
        const textOk = !query || fuzzyScore(query, rowText(row)) >= 0;
        const visible = typeOk && catsOk && textOk;
        row.hidden = !visible;
        if (visible) shown++;
      });

      sortRows();

      groups.forEach(function (group) {
        const hasMatch = !!group.querySelector('li[data-search]:not([hidden])');
        if (filtering) {
          group.hidden = !hasMatch;
          if (hasMatch && !group.open) {
            group.open = true;
            forcedOpen.add(group);
          }
        } else {
          group.hidden = false;
          if (forcedOpen.has(group)) {
            group.open = initialOpen.get(group) === true;
            forcedOpen.delete(group);
          }
        }
      });

      if (countEl) {
        countEl.textContent = filtering
          ? shown + ' / ' + total + ' artifacts'
          : total + ' artifact' + (total === 1 ? '' : 's');
      }
      if (noResults) {
        noResults.hidden = shown !== 0;
        // An empty project keeps its server-rendered "No artifacts in this project yet." copy.
        if (shown === 0 && total > 0) setEmptyText(emptyMessage(!!query));
      }
      syncControls();
      syncUrl(rawQuery);
    }

    if (search) search.addEventListener('input', applyFilters);
    if (sortFilter) {
      if (sortFilter.tagName === 'SELECT') {
        sortFilter.addEventListener('change', function () {
          activeSort = sortFilter.value || 'recent';
          applyFilters();
        });
      } else {
        sortFilter.addEventListener('click', function (event) {
          const button = event.target.closest('[data-sort]');
          if (!button) return;
          activeSort = button.dataset.sort || 'recent';
          applyFilters();
        });
      }
    }
    document.addEventListener('click', function (event) {
      const treeToggle = event.target.closest('[data-expand-all], [data-collapse-all]');
      if (treeToggle && !tree.contains(treeToggle)) {
        const open = treeToggle.hasAttribute('data-expand-all');
        // An explicit user choice wins over the filter's auto-open state restore.
        forcedOpen.clear();
        groups.forEach(function (group) {
          group.open = open;
        });
        return;
      }
      const typeButton = event.target.closest('[data-type]');
      if (typeButton && typeFilter && typeFilter.contains(typeButton)) {
        activeType = typeButton.dataset.type || 'all';
        applyFilters();
        return;
      }
      const catButton = event.target.closest('[data-cat]');
      if (catButton && catRoot && catRoot.contains(catButton)) {
        // Multi-select OR; All resets. The popover stays open while toggling options.
        const value = catButton.dataset.cat || '';
        if (!value || value === 'all') activeCats.clear();
        else if (activeCats.has(value)) activeCats.delete(value);
        else activeCats.add(value);
        applyFilters();
      }
    });

    applyFilters();
  }

  /* ---------------------------------------------------------------- reader */

  function initReaderToc() {
    const links = Array.prototype.slice.call(document.querySelectorAll('[data-toc-link]'));
    if (!links.length) return;
    const linksById = new Map();
    links.forEach(function (link) {
      const href = link.getAttribute('href') || '';
      if (href.charAt(0) !== '#') return;
      const id = href.slice(1);
      if (!document.getElementById(id)) return;
      if (!linksById.has(id)) linksById.set(id, []);
      linksById.get(id).push(link);
    });
    const headings = Array.from(linksById.keys()).map(function (id) {
      return document.getElementById(id);
    });
    if (!headings.length) return;

    function setActive(id) {
      links.forEach(function (link) {
        link.removeAttribute('aria-current');
      });
      (linksById.get(id) || []).forEach(function (link) {
        link.setAttribute('aria-current', 'true');
      });
    }

    const observer = new IntersectionObserver(
      function (entries) {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setActive(entry.target.id);
          return;
        }
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 },
    );
    headings.forEach(function (heading) {
      observer.observe(heading);
    });
  }

  function initReadProgress() {
    const bar = document.getElementById('read-progress-bar');
    if (!bar) return;
    function update() {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      bar.style.transform = 'scaleX(' + progress + ')';
    }
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  /* ------------------------------------------------------ code blocks / hljs */

  function initCodeCopy() {
    const body = document.querySelector('.reader-body, #reader-body, .md-body');
    if (!body) return;
    body.querySelectorAll('pre').forEach(function (pre) {
      if (pre.querySelector('.code-copy')) return;
      pre.classList.add('has-copy');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'code-copy';
      button.setAttribute('data-copy-code', '');
      button.setAttribute('aria-label', 'Copy code');
      button.textContent = 'Copy';
      pre.appendChild(button);
    });
  }

  function highlightCode() {
    // highlight.js is loaded from the CDN on MD reader pages only.
    if (window.hljs) {
      try {
        window.hljs.highlightAll();
      } catch (error) {
        console.error('[viewer] highlight failed:', error);
      }
    }
  }

  /* --------------------------------------------------------- shell extras */

  function initTopbarScroll() {
    const bars = Array.prototype.slice.call(document.querySelectorAll('[data-topbar]'));
    if (!bars.length) return;
    function update() {
      const scrolled = window.scrollY > 4;
      bars.forEach(function (bar) {
        if (scrolled) bar.setAttribute('data-scrolled', '');
        else bar.removeAttribute('data-scrolled');
      });
    }
    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  function initKeyboard() {
    document.addEventListener('keydown', function (event) {
      const active = document.activeElement;
      const typingTag = (active && active.tagName) || '';
      const tag = typingTag.toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || (active && active.isContentEditable);

      // "/" or Cmd/Ctrl+K focuses the project listing search; the gallery owns its own shortcut.
      if (!typing && (event.key === '/' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'))) {
        const input = document.querySelector('[data-proj-filter]');
        if (input && input.getClientRects().length) {
          event.preventDefault();
          input.focus();
          input.select();
        }
        return;
      }
      if (event.key === 'Escape') {
        hideTip();
        if (shareModal && !shareModal.hidden) return; // the dialog owns Escape
        closeThemePopover(true);
        closeMoreMenu(true);
        if (active && active.hasAttribute && active.hasAttribute('data-proj-filter')) {
          active.value = '';
          active.dispatchEvent(new Event('input', { bubbles: true }));
          active.blur();
        }
      }
    });
  }

  function initSkipLinks() {
    document.addEventListener('click', function (event) {
      const skip = event.target.closest('.skip-link');
      if (!skip) return;
      const target = document.querySelector(skip.getAttribute('href'));
      if (!target) return;
      event.preventDefault();
      focusEl(target);
    });
  }

  function initPrintFallback() {
    // The More menu owns print; this keeps an explicit [data-print] hook working if markup adds one.
    document.addEventListener('click', function (event) {
      if (event.target.closest('[data-print]')) window.print();
    });
  }

  /* --------------------------------------------------------------- ghost auth */

  function initGhostPassword() {
    var toggle = document.querySelector('[data-ghost-pw-toggle]');
    var input = document.getElementById('ghost-password');
    if (!toggle || !input) return;
    toggle.addEventListener('click', function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', String(show));
      toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      input.focus();
    });
  }


  /* ------------------------------------------------------- artifact-matched bar */

  // HTML artifacts are iframed same-origin, so the shell can sample their actual colours and
  // keep the 48px bar visually continuous with the artifact — including when the artifact
  // switches theme from inside the iframe. Cross-origin iframes keep the shell theme.
  function initArtifactSkin() {
    var frame = document.querySelector('.viewer-frame');
    var bar = document.querySelector('.viewer-topbar');
    if (!frame || !bar) return;

    var observer = null;
    var timer = null;
    var lastKey = '';

    function parseColor(value) {
      var match = String(value || '').match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      var parts = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      if (parts.length < 3 || parts.some(isNaN)) return null;
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    }
    function composite(color, under) {
      if (!color) return under;
      var a = Number.isFinite(color.a) ? color.a : 1;
      return {
        r: Math.round(color.r * a + under.r * (1 - a)),
        g: Math.round(color.g * a + under.g * (1 - a)),
        b: Math.round(color.b * a + under.b * (1 - a)),
        a: 1,
      };
    }
    function rgb(color) {
      return 'rgb(' + color.r + ', ' + color.g + ', ' + color.b + ')';
    }
    function luminance(color) {
      var channels = [color.r, color.g, color.b].map(function (value) {
        var v = value / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    }
    function contrast(a, b) {
      var la = luminance(a);
      var lb = luminance(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    }
    function mix(a, b, amount) {
      return {
        r: Math.round(a.r + (b.r - a.r) * amount),
        g: Math.round(a.g + (b.g - a.g) * amount),
        b: Math.round(a.b + (b.b - a.b) * amount),
        a: 1,
      };
    }
    function atLeast(background, color, target, start) {
      var amount = start;
      var mixed = mix(background, color, amount);
      while (contrast(background, mixed) < target && amount < 0.98) {
        amount += 0.04;
        mixed = mix(background, color, amount);
      }
      return mixed;
    }
    // The bar sits flush against the top of the iframe, so match the colour that is actually
    // painted there (the artifact's own top bar) rather than only the page background.
    function topStripColor(doc, win, fallback) {
      var width = doc.documentElement.clientWidth || win.innerWidth || 0;
      if (!width) return fallback;
      var points = [0.5, 0.08, 0.92];
      for (var i = 0; i < points.length; i += 1) {
        var x = Math.max(0, Math.min(width - 1, Math.round(width * points[i])));
        var element = doc.elementFromPoint(x, Math.min(24, (win.innerHeight || 24) - 1));
        while (element && element !== doc.documentElement) {
          var style = win.getComputedStyle(element);
          var color = parseColor(style.backgroundColor);
          if (color && color.a > 0) return composite(color, fallback);
          if (style.backgroundImage && style.backgroundImage !== 'none') return fallback;
          element = element.parentElement;
        }
      }
      return fallback;
    }
    function sample() {
      var doc;
      var win;
      try {
        doc = frame.contentDocument;
        win = frame.contentWindow;
      } catch (error) {
        return; // cross-origin artifact
      }
      if (!doc || !doc.body || !win) return;
      var bodyStyle = win.getComputedStyle(doc.body);
      var htmlStyle = win.getComputedStyle(doc.documentElement);
      var white = { r: 255, g: 255, b: 255, a: 1 };
      var pageBackground = parseColor(bodyStyle.backgroundColor);
      if (!pageBackground || pageBackground.a === 0) pageBackground = parseColor(htmlStyle.backgroundColor);
      if (!pageBackground || pageBackground.a === 0) return;
      pageBackground = composite(pageBackground, white);
      var background = topStripColor(doc, win, pageBackground);
      var candidate = parseColor(bodyStyle.color) || parseColor(htmlStyle.color);
      var foreground = candidate && contrast(background, candidate) >= 4.5
        ? candidate
        : (luminance(background) > 0.5 ? { r: 17, g: 17, b: 17, a: 1 } : { r: 247, g: 247, b: 247, a: 1 });
      var key = rgb(background) + '|' + rgb(foreground);
      if (key === lastKey) return;
      lastKey = key;
      bar.style.setProperty('--skin-bg', rgb(background));
      bar.style.setProperty('--skin-fg', rgb(foreground));
      // Muted text must still hit AA (4.5:1); icons only need 3:1.
      bar.style.setProperty('--skin-muted', rgb(atLeast(background, foreground, 4.5, 0.62)));
      bar.style.setProperty('--skin-icon', rgb(atLeast(background, foreground, 3, 0.6)));
      bar.classList.add('is-skinned');
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', rgb(background));
    }
    function stop() {
      if (observer) observer.disconnect();
      observer = null;
      if (timer) clearInterval(timer);
      timer = null;
    }
    function start() {
      stop();
      lastKey = '';
      sample();
      try {
        var doc = frame.contentDocument;
        if (!doc) return;
        observer = new MutationObserver(function () {
          setTimeout(sample, 30);
        });
        [doc.documentElement, doc.body].forEach(function (element) {
          if (element) {
            observer.observe(element, {
              attributes: true,
              attributeFilter: ['class', 'style', 'data-theme', 'data-mode', 'data-color-scheme'],
            });
          }
        });
        // Catches theme switches that only swap CSS variables/stylesheets without a root attr change.
        timer = setInterval(function () {
          if (!document.hidden) sample();
        }, 600);
      } catch (error) {
        /* cross-origin: keep the shell theme */
      }
    }
    frame.addEventListener('load', start);
    start();
  }

  /* ---------------------------------------------------------------- review */
  // Review mode + version history.
  //
  // One controller for both artifact surfaces:
  //  - HTML viewer: the artifact is a same-origin iframe; selection and highlights are
  //    read from/written to `iframe.contentDocument` (no synthetic events needed: the
  //    document is same-origin, so `contentDocument.getSelection()` and
  //    `CSS.highlights` registration work directly).
  //  - Markdown reader: the rendered body is `.reader-body` in this document.
  //
  // Anchors are W3C TextQuoteSelector-style over a whitespace-normalized text index.
  // Persisted highlights use the CSS Custom Highlight API only: the artifact DOM is never
  // mutated (a <style> in the target document's head + registered Range objects). When the
  // API is missing, threads still list and "Jump to" still scrolls; only the paint is lost.
  //
  // Pure helpers are exposed on window.ArtifactsReview for unit tests (test/review-ui.test.mjs).

  const REVIEW_STATUS = ['open', 'addressed', 'resolved'];
  const REVIEW_KIND_LABEL = { comment: 'Comment', replace: 'Replace', remove: 'Remove' };
  const REVIEW_STATUS_LABEL = { open: 'Open', addressed: 'Addressed', resolved: 'Resolved' };
  const REVIEW_CONTEXT_CHARS = 48;
  const REVIEW_MAX_EXACT = 2000;
  const REVIEW_HIGHLIGHT_STYLE_ID = 'arts-review-highlight-style';
  let review = null;

  function reviewEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function reviewIcon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  function reviewClip(text, length) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (value.length <= length) return value;
    return value.slice(0, Math.max(0, length - 1)).trimEnd() + '…';
  }

  function reviewFormatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return '';
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
    return (value / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function reviewShortDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return date.getUTCDate() + ' ' + months[date.getUTCMonth()] + ' ' + date.getUTCFullYear();
  }

  /** Relative label for thread metadata ("4 min ago"); absolute date after a week. */
  function reviewRelativeTime(value, now) {
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) return '';
    const current = Number.isFinite(now) ? now : Date.now();
    const seconds = Math.max(0, Math.round((current - time) / 1000));
    if (seconds < 45) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + ' min ago';
    const hours = Math.round(minutes / 60);
    if (hours < 24) return hours + ' h ago';
    const days = Math.round(hours / 24);
    if (days < 7) return days + ' d ago';
    return reviewShortDate(time);
  }

  function reviewIsRevisionId(value) {
    return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
  }

  function reviewIdempotencyKey() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (error) {
      /* fall through */
    }
    return 'k-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  /**
   * Locate a TextQuoteSelector in normalized text.
   *
   * Order of evidence (never trust offsets first):
   *  1. enumerate every occurrence of `exact`;
   *  2. one occurrence wins immediately;
   *  3. otherwise score each occurrence with prefix/suffix context and require a unique best;
   * If more than one occurrence remains tied after context scoring the anchor is unanchored:
   * offsets never break an ambiguity tie, so reordered identical quotes can never silently attach
   * to the wrong passage.
   */
  function reviewFindQuote(text, anchor, options) {
    if (typeof text !== 'string' || !text || !anchor || typeof anchor.exact !== 'string') return null;
    const exact = anchor.exact;
    if (!exact) return null;
    const prefix = typeof anchor.prefix === 'string' ? anchor.prefix : '';
    const suffix = typeof anchor.suffix === 'string' ? anchor.suffix : '';
    const hits = [];
    let from = 0;
    while (hits.length < 200) {
      const index = text.indexOf(exact, from);
      if (index === -1) break;
      hits.push(index);
      from = index + 1;
    }
    if (!hits.length) return null;
    if (hits.length === 1) return { start: hits[0], end: hits[0] + exact.length, score: 2 };

    const scored = hits.map(function (index) {
      let score = 0;
      if (prefix) {
        const before = text.slice(Math.max(0, index - prefix.length), index);
        if (before === prefix) score += 2;
        else if (before && prefix.slice(-before.length) === before) score += 1;
      }
      if (suffix) {
        const after = text.slice(index + exact.length, index + exact.length + suffix.length);
        if (after === suffix) score += 2;
        else if (after && suffix.slice(0, after.length) === after) score += 1;
      }
      return { start: index, end: index + exact.length, score: score };
    });
    let best = -1;
    scored.forEach(function (candidate) {
      if (candidate.score > best) best = candidate.score;
    });
    const tied = scored.filter(function (candidate) {
      return candidate.score === best;
    });
    // Offsets are deliberately NOT used to break ties: a tie means the quote context cannot
    // prove which occurrence is meant, so the thread must show as unanchored instead.
    if (best > 0 && tied.length === 1) return tied[0];
    return null;
  }

  /* ------------------------------------------------ normalized text index */

  function reviewBoundaryIndex(index, node, offset) {
    const order = index.nodeOrder.get(node);
    if (order == null) return -1;
    let low = 0;
    let high = index.entries.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      const entry = index.entries[middle];
      const before = entry.order < order || (entry.order === order && entry.offset < offset);
      if (before) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  /** Resolve a selection boundary (element or text node) to a text-node boundary. */
  function reviewTextBoundary(doc, node, offset, side) {
    if (!node) return null;
    if (node.nodeType === 3) {
      return { node: node, offset: Math.max(0, Math.min(Number(offset) || 0, node.nodeValue.length)) };
    }
    const children = node.childNodes;
    function firstText(scope) {
      if (scope.nodeType === 3) return scope.nodeValue ? { node: scope, offset: 0 } : null;
      const walker = doc.createTreeWalker(scope, 4);
      let textNode = walker.nextNode();
      while (textNode && !textNode.nodeValue) textNode = walker.nextNode();
      return textNode ? { node: textNode, offset: 0 } : null;
    }
    function lastText(scope) {
      if (scope.nodeType === 3) return scope.nodeValue ? { node: scope, offset: scope.nodeValue.length } : null;
      const walker = doc.createTreeWalker(scope, 4);
      let last = null;
      let textNode = walker.nextNode();
      while (textNode) {
        if (textNode.nodeValue) last = textNode;
        textNode = walker.nextNode();
      }
      return last ? { node: last, offset: last.nodeValue.length } : null;
    }
    if (side === 'start') {
      for (let i = Math.max(0, Number(offset) || 0); i < children.length; i++) {
        const found = firstText(children[i]);
        if (found) return found;
      }
      return null;
    }
    for (let i = Math.min(children.length, Number(offset) || 0) - 1; i >= 0; i--) {
      const found = lastText(children[i]);
      if (found) return found;
    }
    return null;
  }

  function reviewBuildTextIndex(root, doc) {
    const nodeOrder = new Map();
    const entries = [];
    let text = '';
    let order = 0;
    let lastWasSpace = true;
    const walker = doc.createTreeWalker(root, 4);
    let node = walker.nextNode();
    while (node) {
      const value = node.nodeValue;
      if (value) {
        const parent = node.parentElement;
        const skip = parent
          ? parent.closest('script,style,noscript,template,svg,[data-review-ignore]')
          : null;
        if (!skip) {
          nodeOrder.set(node, order);
          for (let i = 0; i < value.length; i++) {
            if (/\s/.test(value[i])) {
              if (!lastWasSpace) {
                text += ' ';
                entries.push({ node: node, offset: i, order: order });
                lastWasSpace = true;
              }
            } else {
              text += value[i];
              entries.push({ node: node, offset: i, order: order });
              lastWasSpace = false;
            }
          }
          order++;
        }
      }
      node = walker.nextNode();
    }
    if (text.endsWith(' ')) {
      text = text.slice(0, -1);
      entries.pop();
    }
    return { text: text, entries: entries, nodeOrder: nodeOrder, doc: doc };
  }

  function reviewRangeFromIndex(index, start, end) {
    if (start < 0 || end > index.entries.length || end <= start) return null;
    const first = index.entries[start];
    const last = index.entries[end - 1];
    if (!first || !last) return null;
    try {
      const range = index.doc.createRange();
      range.setStart(first.node, first.offset);
      range.setEnd(last.node, last.offset + 1);
      return range;
    } catch (error) {
      return null;
    }
  }

  function reviewSelectorPath(element, root) {
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && node !== root && parts.length < 5) {
      if (node.id) {
        parts.unshift('#' + node.id);
        break;
      }
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = Array.prototype.filter.call(parent.children, function (child) {
          return child.tagName === node.tagName;
        });
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function reviewElementHint(node, container) {
    let element = node && node.nodeType === 1 ? node : node && node.parentElement;
    if (!element) return null;
    const block =
      element.closest('p,li,td,th,pre,blockquote,h1,h2,h3,h4,h5,h6,figure,section,article,div') ||
      element;
    return {
      tag: block.tagName.toLowerCase(),
      id: block.id || null,
      role: block.getAttribute('role') || null,
      selector: reviewSelectorPath(block, container) || null,
      text: reviewClip(block.textContent, 200),
    };
  }

  function reviewHeadingsFor(container, node) {
    const headings = Array.prototype.slice.call(container.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    const before = [];
    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i];
      if (heading.contains(node) || heading.compareDocumentPosition(node) & 4) before.push(heading);
    }
    const nearest = before.length ? before[before.length - 1] : null;
    if (!nearest) return { heading: '', headingPath: [] };
    const path = [];
    for (let i = 0; i < before.length; i++) {
      const level = Number(before[i].tagName.slice(1));
      if (level <= 3) path.push(reviewClip(before[i].textContent, 120));
    }
    return { heading: reviewClip(nearest.textContent, 200), headingPath: path.slice(-3) };
  }

  /** Compute a W3C TextQuoteSelector-style anchor for a document selection. */
  function reviewAnchorFromSelection(target, selection) {
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const doc = target.doc;
    const container = target.container;
    let range;
    try {
      range = selection.getRangeAt(0);
    } catch (error) {
      return null;
    }
    if (!range || !container.contains(range.commonAncestorContainer)) return null;
    const startBoundary = reviewTextBoundary(doc, range.startContainer, range.startOffset, 'start');
    const endBoundary = reviewTextBoundary(doc, range.endContainer, range.endOffset, 'end');
    if (!startBoundary || !endBoundary) return null;
    const index = reviewTextIndexFor(target);
    if (!index || !index.text) return null;
    let start = reviewBoundaryIndex(index, startBoundary.node, startBoundary.offset);
    let end = reviewBoundaryIndex(index, endBoundary.node, endBoundary.offset);
    if (start < 0 || end < 0) return null;
    if (start > end) {
      const swap = start;
      start = end;
      end = swap;
    }
    while (start < end && index.text[start] === ' ') start++;
    while (end > start && index.text[end - 1] === ' ') end--;
    if (end - start < 1) return null;
    if (end - start > REVIEW_MAX_EXACT) end = start + REVIEW_MAX_EXACT;
    const exact = index.text.slice(start, end);
    if (!exact.trim()) return null;
    const headings = reviewHeadingsFor(container, startBoundary.node);
    return {
      version: 1,
      type: 'text',
      exact: exact,
      prefix: index.text.slice(Math.max(0, start - REVIEW_CONTEXT_CHARS), start),
      suffix: index.text.slice(end, end + REVIEW_CONTEXT_CHARS),
      start: start,
      end: end,
      heading: headings.heading,
      headingPath: headings.headingPath,
      element: reviewElementHint(startBoundary.node, container),
      context: {
        language: (doc.documentElement && doc.documentElement.lang) || '',
        tab: null,
      },
    };
  }

  function reviewTextIndexFor(target) {
    if (!target || !target.doc) return null;
    if (target.doc !== target.indexDoc) {
      target.index = reviewBuildTextIndex(target.container, target.doc);
      target.indexDoc = target.doc;
    }
    return target.index;
  }

  /* --------------------------------------------------------- highlights */

  function reviewToken(name) {
    try {
      const value = window.getComputedStyle(document.documentElement).getPropertyValue(name);
      return (value || '').trim();
    } catch (error) {
      return '';
    }
  }

  function reviewCanHighlight(doc) {
    const win = doc && doc.defaultView;
    return !!(win && win.CSS && win.CSS.highlights && typeof win.Highlight === 'function');
  }

  function reviewEnsureHighlightStyle(doc) {
    let style = doc.getElementById(REVIEW_HIGHLIGHT_STYLE_ID);
    if (!style) {
      style = doc.createElement('style');
      style.id = REVIEW_HIGHLIGHT_STYLE_ID;
      (doc.head || doc.documentElement).appendChild(style);
    }
    const accent = reviewToken('--accent') || 'CanvasText';
    const ink = reviewToken('--ink') || 'CanvasText';
    const muted = reviewToken('--muted') || 'CanvasText';
    style.textContent =
      '::highlight(review-open){background-color:color-mix(in srgb,' +
      accent +
      ' 22%,transparent);text-decoration:underline;text-decoration-color:' +
      accent +
      ';text-decoration-thickness:2px;text-underline-offset:2px;}' +
      '::highlight(review-addressed){background-color:color-mix(in srgb,' +
      ink +
      ' 9%,transparent);text-decoration:line-through;text-decoration-color:' +
      muted +
      ';}' +
      '::highlight(review-resolved){background-color:color-mix(in srgb,' +
      ink +
      ' 6%,transparent);}' +
      '::highlight(review-flash){background-color:color-mix(in srgb,' +
      accent +
      ' 55%,transparent);}' +
      '::highlight(review-pending){background-color:color-mix(in srgb,' +
      accent +
      ' 14%,transparent);}';
  }

  function reviewSetHighlight(target, name, ranges) {
    const doc = target && target.doc;
    if (!doc || !reviewCanHighlight(doc)) return;
    const win = doc.defaultView;
    const highlights = win.CSS.highlights;
    if (!ranges || !ranges.length) {
      if (highlights.has(name)) highlights.delete(name);
      return;
    }
    try {
      const highlight = new win.Highlight();
      for (let i = 0; i < ranges.length; i++) highlight.add(ranges[i]);
      highlights.set(name, highlight);
    } catch (error) {
      console.error('[viewer] highlight failed:', error);
    }
  }

  /** Resolve every thread's anchor against its target document; cache ranges per thread. */
  function reviewResolveAnchors() {
    if (!review) return;
    review.anchorRanges = new Map();
    review.anchorState = new Map();
    if (!review.threads.length) return;
    review.targets.forEach(function (target) {
      const index = reviewTextIndexFor(target);
      if (!index || !index.text) return;
      review.threads.forEach(function (thread) {
        if (review.anchorRanges.has(thread.threadId)) return;
        const anchor = thread.anchor;
        if (anchor && anchor.type === 'document') {
          review.anchorState.set(thread.threadId, {
            anchored: true,
            document: true,
            target: target,
            range: null,
          });
          return;
        }
        if (!anchor || anchor.type !== 'text' || typeof anchor.exact !== 'string') {
          review.anchorState.set(thread.threadId, { anchored: false, target: target, range: null });
          return;
        }
        const sameRevision = !!review.viewRevisionId && thread.revisionId === review.viewRevisionId;
        const found = reviewFindQuote(index.text, anchor, { trustOffsets: sameRevision });
        const range = found ? reviewRangeFromIndex(index, found.start, found.end) : null;
        if (range) {
          review.anchorRanges.set(thread.threadId, range);
          review.anchorState.set(thread.threadId, { anchored: true, target: target, range: range });
        } else {
          review.anchorState.set(thread.threadId, { anchored: false, target: target, range: null });
        }
      });
    });
  }

  function reviewPaintHighlights() {
    if (!review) return;
    reviewResolveAnchors();
    review.targets.forEach(function (target) {
      if (!reviewCanHighlight(target.doc)) return;
      reviewEnsureHighlightStyle(target.doc);
      const buckets = { open: [], addressed: [], resolved: [], pending: [] };
      review.anchorRanges.forEach(function (range, threadId) {
        const thread = review.threadById.get(threadId);
        const state = review.anchorState.get(threadId);
        if (!thread || !state || state.target !== target) return;
        const bucket = buckets[thread.status] || buckets.open;
        bucket.push(range);
      });
      reviewSetHighlight(target, 'review-open', buckets.open);
      reviewSetHighlight(target, 'review-addressed', buckets.addressed);
      reviewSetHighlight(target, 'review-resolved', buckets.resolved);
    });
    // Refinements for elements without a text match are intentionally not painted: the
    // contract's element hint is informative, the quote is the anchor of record.
  }

  function reviewFlashAnchor(range) {
    if (!review || !range) return;
    const target = review.targets.find(function (item) {
      return item.doc === range.startContainer.ownerDocument;
    });
    if (!target || !reviewCanHighlight(target.doc)) return;
    reviewEnsureHighlightStyle(target.doc);
    reviewSetHighlight(target, 'review-flash', [range]);
    setTimeout(function () {
      if (review) reviewSetHighlight(target, 'review-flash', []);
    }, 900);
  }

  /* ---------------------------------------------------------- api adapter */

  function reviewApiError(status, code, message, data) {
    const error = new Error(message || 'Request failed.');
    error.status = status;
    error.code = code || '';
    error.data = data || null;
    return error;
  }

  function reviewApiUrl(path, params) {
    const url = new URL(path, window.location.origin);
    Object.keys(params || {}).forEach(function (key) {
      const value = params[key];
      if (value != null && value !== '') url.searchParams.set(key, String(value));
    });
    return url.pathname + url.search;
  }

  async function reviewFetch(path, options) {
    // Same-origin JSON only: the browser sends Origin/Cookies automatically; the server checks
    // them. Review grants arrive as an artifact-scoped HttpOnly cookie (redeemed by the backend
    // from `?review=`), so the client never sees or stores a token.
    const headers = Object.assign({ accept: 'application/json' }, (options && options.headers) || {});
    const request = Object.assign({ credentials: 'same-origin', headers: headers }, options || {});
    if (request.body && typeof request.body !== 'string') request.body = JSON.stringify(request.body);
    if (request.body) headers['content-type'] = 'application/json';
    let response;
    try {
      response = await fetch(path, request);
    } catch (error) {
      throw reviewApiError(0, 'network', 'Could not reach the server.');
    }
    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }
    if (!response.ok) {
      throw reviewApiError(
        response.status,
        (data && data.code) || '',
        (data && data.error) || 'Request failed (' + response.status + ').',
        data,
      );
    }
    return data || {};
  }

  function reviewIdentityParams() {
    if (review.artifactId) return { artifact: review.artifactId };
    return { project: review.project, file: review.file };
  }

  function reviewListQuery() {
    const query = reviewIdentityParams();
    query.revision = review.allRevisions ? 'all' : review.viewRevisionId || 'current';
    query.limit = 100;
    return query;
  }

  function reviewLoadThreads(options) {
    const opts = options || {};
    if (!review) return Promise.resolve();
    if (review.loadingThreads) {
      review.threadsDirty = true;
      return Promise.resolve();
    }
    review.loadingThreads = true;
    if (!opts.quiet) reviewSetState('loading');
    return reviewFetch(reviewApiUrl('/api/feedback', reviewListQuery()))
      .then(function (data) {
        review.threads = Array.isArray(data.threads) ? data.threads : [];
        review.threadById = new Map(
          review.threads.map(function (thread) {
            return [thread.threadId, thread];
          }),
        );
        review.counts = data.counts || reviewComputeCounts(review.threads);
        review.permissions = data.permissions || review.permissions || {};
        review.artifact = data.artifact || review.artifact;
        review.revision = data.revision || review.revision;
        review.txid = data.txid || 0;
        if (!review.viewRevisionId && data.revision && data.revision.revisionId) {
          review.viewRevisionId = data.revision.revisionId;
        }
        review.lastLoadedAt = Date.now();
        reviewSyncArmed();
        // Refresh the normalized index on every load: artifacts can mutate between polls.
        reviewInvalidateIndexes();
        reviewSetState('');
        reviewUpdateBadge();
        reviewRenderThreads();
        reviewPaintHighlights();
        reviewUpdateFrameGuard();
        reviewUpdateFilters();
        reviewUpdateFooter();
        reviewAnnounce(review.counts.open + ' open · ' + review.counts.addressed + ' addressed');
        if (review.pendingFocusThread) {
          reviewFocusThreadCard(review.pendingFocusThread);
          review.pendingFocusThread = '';
        }
      })
      .catch(function (error) {
        reviewHandleApiFailure(error, opts);
      })
      .finally(function () {
        review.loadingThreads = false;
        if (review.threadsDirty) {
          review.threadsDirty = false;
          setTimeout(function () {
            if (review) reviewLoadThreads({ quiet: true });
          }, 0);
        }
      });
  }

  function reviewComputeCounts(threads) {
    const counts = { open: 0, addressed: 0, resolved: 0 };
    (threads || []).forEach(function (thread) {
      if (counts[thread.status] != null) counts[thread.status] += 1;
    });
    return counts;
  }

  function reviewHandleApiFailure(error, opts) {
    if (!review) return;
    const code = error && error.code;
    // Public artifact feedback is not public: without a valid review-grant cookie (or an
    // owner project session) the API answers 401/403. Treat that as "no review access" and
    // hide the action entirely — never render a dead control or leaked counts.
    // 401/403 = no review access; 5xx (including 503 not-configured) = feature unavailable.
    // Both hide the action silently instead of rendering a dead control or logging console noise.
    if (
      code === 'feedback_not_configured' ||
      code === 'network' ||
      error.status === 0 ||
      error.status === 401 ||
      error.status === 403 ||
      error.status >= 500
    ) {
      review.available = false;
      reviewUpdateAvailability();
      reviewUpdatePill();
      reviewSyncArmed();
      if (review.open) {
        reviewSetState(
          'error',
          error.status === 503
            ? 'Review is not configured on this deployment.'
            : error.status >= 500 || error.status === 0
              ? 'Review is temporarily unavailable.'
              : 'A review link is required to see or add feedback on this artifact.',
        );
      }
      return;
    }
    if (error.status === 404 || error.status === 405) {
      review.available = false;
      reviewUpdateAvailability();
      reviewSyncArmed();
      return;
    }
    reviewSetState('error', (error && error.message) || 'Feedback could not be loaded.');
    if (!opts.quiet && review.counts) reviewUpdateBadge();
  }

  function reviewLoadRevisions(options) {
    const opts = options || {};
    if (!review) return Promise.resolve();
    review.loadingRevisions = true;
    const query = reviewIdentityParams();
    return reviewFetch(reviewApiUrl('/api/revisions', query))
      .then(function (data) {
        const revisions = Array.isArray(data.revisions) ? data.revisions : [];
        review.revisions = revisions;
        review.revisionsArtifact = data.artifact || review.revisionsArtifact;
        review.revisioningEnabled =
          data.artifact && typeof data.artifact.revisioningEnabled === 'boolean'
            ? data.artifact.revisioningEnabled
            : revisions.length > 0;
        review.latestRevision = data.latest || null;
        review.totalRevisions = Number(data.total) || revisions.length;
        reviewUpdateVersionsEntry();
        if (!review.revisioningEnabled || !revisions.length) {
          // Feedback is revision-bound; without a registry there is nothing to bind to, so
          // both Version history and Feedback stay out of the bar instead of failing later.
          review.available = false;
          reviewUpdateAvailability();
          reviewUpdatePill();
          reviewSyncArmed();
        } else if (!review.viewRevisionId) {
          // The server pins even the default view to the exact revision shown; mirror that so
          // created threads always bind to the bytes the reviewer actually sees.
          const latest = revisionLatest(revisions);
          if (latest) review.viewRevisionId = latest.revisionId;
        }
        reviewApplyPinnedRevision();
        if (opts.openDialog) reviewRenderVersions(true);
      })
      .catch(function (error) {
        if (opts.openDialog) reviewRenderVersionsError(error);
        else if (
          error.status === 401 ||
          error.status === 403 ||
          error.status === 0 ||
          error.status >= 500
        ) {
          review.revisions = null;
          reviewUpdateVersionsEntry();
          reviewUpdateAvailability();
          reviewSyncArmed();
        }
      })
      .finally(function () {
        review.loadingRevisions = false;
      });
  }

  /* -------------------------------------------------------------- state UI */

  function reviewRefs() {
    return review.refs;
  }

  function reviewSetState(name, message) {
    if (!review) return;
    const refs = review.refs;
    const hasThreads = review.threads.length > 0 || !!review.pendingThread;
    refs.loading.hidden = name !== 'loading';
    refs.error.hidden = name !== 'error' && name !== 'readonly';
    refs.empty.hidden = name !== 'empty';
    if (name === 'error' || name === 'readonly') {
      refs.errorText.textContent = message || 'Feedback could not be loaded.';
      refs.retry.hidden = name === 'readonly';
      refs.error.setAttribute('role', name === 'readonly' ? 'note' : 'alert');
    }
    if (hasThreads) {
      refs.loading.hidden = true;
      refs.error.hidden = true;
      refs.empty.hidden = true;
    }
    review.stateName = name || '';
  }

  function reviewUpdateAvailability() {
    if (!review) return;
    // /api/revisions does not depend on the feedback DB, so version history stays available
    // even when feedback is not configured; only the feedback action is hidden.
    const available = review.available !== false;
    document.querySelectorAll('[data-review-toggle]').forEach(function (button) {
      button.hidden = !available;
    });
    if (!available && review.open) reviewClosePanel({ restoreFocus: false });
  }

  function reviewUpdateVersionsEntry() {
    const item = document.querySelector('[data-action="versions"]');
    if (!item) return;
    const show = !!(review && review.revisioningEnabled && review.revisions && review.revisions.length);
    item.hidden = !show;
    item.setAttribute('data-available', show ? 'true' : 'false');
  }

  function reviewUpdateBadge() {
    if (!review) return;
    const open = review.counts ? review.counts.open : 0;
    document.querySelectorAll('[data-review-toggle]').forEach(function (button) {
      const badge = button.querySelector('[data-review-badge]');
      if (badge) {
        badge.textContent = open > 99 ? '99+' : String(open);
        badge.hidden = !open;
      }
      button.setAttribute(
        'aria-label',
        'Feedback' + (open ? ' (' + open + ' open)' : ''),
      );
      button.setAttribute('aria-pressed', String(!!review.open));
    });
  }

  function reviewUpdateFilters() {
    if (!review) return;
    const counts = review.counts || { open: 0, addressed: 0, resolved: 0 };
    review.refs.status.querySelectorAll('[data-review-filter]').forEach(function (button) {
      const status = button.getAttribute('data-review-filter');
      const count = button.querySelector('[data-review-count]');
      if (count) count.textContent = String(counts[status] || 0);
      button.setAttribute('aria-pressed', String(status === review.statusFilter));
    });
    review.refs.scopeWrap.hidden = !(review.revisions && review.revisions.length > 1);
    review.refs.scope.checked = !!review.allRevisions;
  }

  function reviewUpdateFooter() {
    if (!review) return;
    const exportAllowed = !review.permissions || review.permissions.canExport !== false;
    review.refs.foot.hidden = !review.threads.length || !exportAllowed;
  }

  function reviewUpdateReadonlyNote() {
    if (!review) return;
    const note = review.refs.note;
    const reasons = [];
    if (review.readonly) {
      reasons.push(
        'Viewing revision ' +
          (review.revisionNumber || '?') +
          ' — feedback is read-only here.',
      );
    } else if (review.readonlyReason) {
      reasons.push(review.readonlyReason);
    } else if (review.permissions && review.permissions.canComment === false && review.available !== false) {
      reasons.push('Read-only: a review link is needed to add feedback to this artifact.');
    }
    note.textContent = '';
    note.hidden = !reasons.length;
    if (!reasons.length) return;
    note.appendChild(reviewEl('span', '', reasons[0]));
    if (review.readonly) {
      const link = reviewEl('a', 'review-note-link', 'Back to latest');
      link.href = reviewLatestHref();
      note.appendChild(link);
    }
  }

  function reviewUpdateHint() {
    if (!review) return;
    const hint = review.refs.hint;
    if (!hint) return;
    const can = review.available !== false && !review.readonly && (!review.permissions || review.permissions.canComment !== false);
    hint.hidden = !(review.mode && can);
  }

  function reviewAnnounce(message) {
    if (!review || !review.refs.live) return;
    review.refs.live.textContent = '';
    setTimeout(function () {
      if (review) review.refs.live.textContent = message;
    }, 20);
  }

  /* ---------------------------------------------------------- thread views */

  function reviewFilteredThreads() {
    if (!review) return [];
    return review.threads.filter(function (thread) {
      return thread.status === review.statusFilter;
    });
  }

  function reviewRenderThreads() {
    if (!review) return;
    const refs = review.refs;
    refs.list.textContent = '';
    const threads = reviewFilteredThreads();
    if (review.pendingThread) refs.list.appendChild(reviewThreadCard(review.pendingThread, true));
    threads.forEach(function (thread) {
      refs.list.appendChild(reviewThreadCard(thread, false));
    });
    const isEmpty = !threads.length && !review.pendingThread;
    if (review.stateName === '' || review.stateName === 'empty') {
      refs.empty.hidden = !isEmpty;
      if (isEmpty) {
        refs.emptyText.textContent = reviewEmptyMessage();
      }
    }
    const documentAllowed =
      reviewCanComment() &&
      review.available !== false &&
      review.frameReady !== false &&
      !(review.frameExpected && !reviewFrameMatches());
    if (refs.documentButton) {
      // Empty-state entry point: discoverable only when there is nothing in the list.
      refs.documentButton.hidden = !(isEmpty && review.statusFilter === 'open' && documentAllowed);
    }
    if (refs.documentAction) {
      // Header entry point: works even when the Open list is not empty (small icon action).
      refs.documentAction.hidden = !documentAllowed;
    }
    reviewUpdateBadge();
  }

  function reviewCanComment() {
    if (!review || review.readonly) return false;
    return !(review.permissions && review.permissions.canComment === false);
  }

  /** Selection capture is armed whenever the session may write — no panel required. */
  function reviewCanSelectToComment() {
    if (!review || review.available === false || review.readonly) return false;
    if (!reviewCanComment()) return false;
    if (document.querySelector('iframe.viewer-frame') && !reviewFrameMatches()) return false;
    return true;
  }

  function reviewSyncArmed() {
    if (!review) return;
    review.mode = !!(review.permissions && reviewCanSelectToComment());
    reviewUpdateBadge();
    reviewUpdateHint();
    reviewUpdatePill();
    if (!review.mode) {
      reviewHidePopover();
      reviewHideInline();
    }
  }

  function reviewInlineOpen() {
    return !!(review && review.refs && review.refs.inline && !review.refs.inline.hidden);
  }

  function reviewStoredName() {
    try {
      return window.localStorage.getItem('artifacts-review-name') || '';
    } catch (error) {
      return '';
    }
  }

  function reviewRememberName(name) {
    try {
      if (name) window.localStorage.setItem('artifacts-review-name', name);
    } catch (error) {
      /* storage unavailable */
    }
  }

  function reviewShowInlineError(message) {
    if (!review) return;
    review.refs.inlineError.textContent = message || '';
    review.refs.inlineError.hidden = !message;
  }

  function reviewEmptyMessage() {
    if (review.statusFilter === 'addressed') return 'No addressed feedback yet.';
    if (review.statusFilter === 'resolved') return 'No resolved feedback yet.';
    if (review.readonlyReason || (review.permissions && review.permissions.canComment === false)) {
      return 'No open feedback on this artifact.';
    }
    return review.allRevisions
      ? 'No open feedback across revisions yet. Select text, or comment on the whole document.'
      : 'No open feedback yet. Select text in the artifact, or comment on the whole document.';
  }

  function reviewThreadCard(thread, pending) {
    const card = reviewEl('li', 'thread');
    card.setAttribute('data-thread', thread.threadId);
    card.setAttribute('data-status', thread.status);
    if (pending) card.classList.add('is-pending');
    const anchor = thread.anchor || {};
    const quote = reviewEl('button', 'thread-quote');
    quote.type = 'button';
    quote.setAttribute('data-thread-action', 'jump');
    quote.setAttribute('data-thread-id', thread.threadId);
    quote.title =
      anchor.type === 'document' ? 'Jump to the top of the artifact' : 'Jump to the commented passage';
    quote.appendChild(
      reviewEl(
        'span',
        'thread-quote-text',
        anchor.type === 'document'
          ? 'Whole document'
          : reviewClip(anchor.exact || (anchor.element && anchor.element.text) || '(no quote)', 240),
      ),
    );
    const quoteMeta = reviewEl('span', 'thread-quote-meta');
    if (thread.revisionNumber) quoteMeta.textContent = 'v' + thread.revisionNumber;
    if (quoteMeta.textContent) quote.appendChild(quoteMeta);
    card.appendChild(quote);

    const head = reviewEl('div', 'thread-head');
    head.appendChild(reviewEl('span', 'thread-kind', REVIEW_KIND_LABEL[thread.kind] || 'Comment'));
    const state = review.anchorState && review.anchorState.get(thread.threadId);
    if (state && !state.anchored) {
      const lost = reviewEl('span', 'thread-lost', 'Location lost');
      lost.title = 'The quote no longer matches this revision uniquely.';
      head.appendChild(lost);
    }
    const outdated = review.viewRevisionId && thread.revisionId && thread.revisionId !== review.viewRevisionId;
    if (outdated) head.appendChild(reviewEl('span', 'thread-outdated', 'Outdated'));
    const statusChip = reviewEl('span', 'thread-status', REVIEW_STATUS_LABEL[thread.status] || thread.status);
    head.appendChild(statusChip);
    card.appendChild(head);

    const meta = reviewEl('p', 'thread-meta');
    const author = thread.author || {};
    meta.appendChild(reviewEl('span', 'thread-author', author.name || 'Anonymous'));
    if (author.unverified) {
      const unverified = reviewEl('span', 'thread-unverified', 'unverified');
      unverified.title = 'Guest display name — not a verified account.';
      meta.appendChild(unverified);
    }
    meta.appendChild(reviewEl('span', 'thread-dot', '·'));
    const time = reviewEl('span', '', reviewRelativeTime(thread.createdAt));
    time.title = reviewShortDate(thread.createdAt);
    meta.appendChild(time);
    if (outdated) {
      meta.appendChild(reviewEl('span', 'thread-dot', '·'));
      meta.appendChild(reviewEl('span', '', 'written on v' + (thread.revisionNumber || '?')));
    }
    card.appendChild(meta);

    const messages = Array.isArray(thread.messages) && thread.messages.length
      ? thread.messages
      : [{ body: thread.body || '', author: author, createdAt: thread.createdAt }];
    const first = messages[0];
    card.appendChild(reviewEl('p', 'thread-body', first.body || ''));
    if (thread.kind === 'replace' && first.replacement) {
      const replacement = reviewEl('div', 'thread-replacement');
      replacement.appendChild(reviewEl('p', 'micro', 'Suggested replacement'));
      replacement.appendChild(reviewEl('p', 'thread-replacement-text', first.replacement));
      card.appendChild(replacement);
    }

    const replies = Array.isArray(thread.replies) && thread.replies.length ? thread.replies : messages.slice(1);
    if (replies.length) {
      const list = reviewEl('ol', 'thread-replies');
      replies.forEach(function (reply) {
        const item = reviewEl('li', 'thread-reply');
        const replyMeta = reviewEl('p', 'thread-meta');
        replyMeta.appendChild(reviewEl('span', 'thread-author', (reply.author && reply.author.name) || 'Anonymous'));
        replyMeta.appendChild(reviewEl('span', 'thread-dot', '·'));
        const replyTime = reviewEl('span', '', reviewRelativeTime(reply.createdAt));
        replyTime.title = reviewShortDate(reply.createdAt);
        replyMeta.appendChild(replyTime);
        item.appendChild(replyMeta);
        item.appendChild(reviewEl('p', 'thread-body', reply.body || ''));
        list.appendChild(item);
      });
      card.appendChild(list);
    }

    if (!pending) {
      const actions = reviewEl('div', 'thread-actions');
      const perms = thread.permissions || review.permissions || {};
      if (reviewCanReply(perms) && !review.readonly) {
        actions.appendChild(
          reviewActionButton('reply', thread.threadId, 'Reply', 'reply'),
        );
      }
      if (!review.readonly) {
        // Transitions follow the lifecycle exactly: open --(admin only)--> addressed
        // --Resolve--> resolved --Reopen--> open. No action is offered out of order, and a
        // read-only session never sees Reopen.
        if (thread.status === 'open' && reviewCanMarkAddressed(perms)) {
          actions.appendChild(reviewActionButton('addressed', thread.threadId, 'Addressed', 'check'));
        }
        if (thread.status === 'addressed' && reviewCanResolve(perms)) {
          actions.appendChild(reviewActionButton('resolved', thread.threadId, 'Resolve', 'check'));
        }
        if (thread.status === 'resolved' && reviewCanReopen(perms)) {
          actions.appendChild(reviewActionButton('open', thread.threadId, 'Reopen', 'history'));
        }
      }
      if (actions.children.length) card.appendChild(actions);
    }
    return card;
  }

  function reviewCanReply(perms) {
    if (review.permissions && review.permissions.canReply === false) return false;
    if (perms && perms.canReply === false) return false;
    return true;
  }

  function reviewCanReopen(perms) {
    if (perms && typeof perms.canReopen === 'boolean') return perms.canReopen;
    return false;
  }

  function reviewCanMarkAddressed(perms) {
    // Contract v2: canChangeStatus (= mark Addressed) is true only for the site-owner admin
    // token; a browser session never receives it, so the web UI leaves this to the CLI.
    if (perms && perms.canChangeStatus === true) return true;
    return !!(review.permissions && review.permissions.canChangeStatus === true);
  }

  function reviewCanResolve(perms) {
    if (perms && typeof perms.canResolve === 'boolean') return perms.canResolve;
    if (perms && typeof perms.canReopen === 'boolean' && perms.canReopen) return true;
    return !!(review.permissions && review.permissions.canResolve);
  }

  function reviewActionButton(action, threadId, label, iconName) {
    const button = reviewEl('button', 'thread-action');
    button.type = 'button';
    button.setAttribute('data-thread-action', action);
    button.setAttribute('data-thread-id', threadId);
    if (iconName) button.appendChild(reviewIcon(iconName));
    button.appendChild(reviewEl('span', '', label));
    return button;
  }

  function reviewFindThread(threadId) {
    if (!review) return null;
    for (let i = 0; i < review.threads.length; i++) {
      if (review.threads[i].threadId === threadId) return review.threads[i];
    }
    return null;
  }

  function reviewShowReplyForm(threadId, button) {
    const card = review.refs.list.querySelector('[data-thread="' + threadId + '"]');
    if (!card || card.querySelector('.thread-reply-form')) return;
    const thread = reviewFindThread(threadId);
    if (!thread) return;
    const form = reviewEl('form', 'thread-reply-form');
    form.setAttribute('data-thread-reply-form', threadId);
    const label = reviewEl('label', 'sr-only', 'Reply');
    label.setAttribute('for', 'review-reply-' + threadId.slice(-8));
    const input = reviewEl('textarea', 'review-input');
    input.id = 'review-reply-' + threadId.slice(-8);
    input.rows = 3;
    input.maxLength = 8000;
    input.placeholder = 'Reply…';
    input.setAttribute('data-reply-input', '');
    const actions = reviewEl('div', 'review-composer-actions');
    const cancel = reviewEl('button', 'btn', 'Cancel');
    cancel.type = 'button';
    cancel.setAttribute('data-thread-action', 'cancel-reply');
    cancel.setAttribute('data-thread-id', threadId);
    const send = reviewEl('button', 'btn btn--primary', 'Reply');
    send.type = 'submit';
    actions.appendChild(cancel);
    actions.appendChild(send);
    form.appendChild(label);
    form.appendChild(input);
    form.appendChild(actions);
    card.appendChild(form);
    if (button) button.setAttribute('aria-expanded', 'true');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      reviewSubmitReply(threadId, input, send, form);
    });
    input.addEventListener('keydown', function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        reviewSubmitReply(threadId, input, send, form);
      }
    });
    input.focus();
  }

  function reviewSubmitReply(threadId, input, button, form) {
    const body = input.value.trim();
    if (!body) {
      input.focus();
      return;
    }
    const thread = reviewFindThread(threadId);
    if (!thread) return;
    const key = reviewIdempotencyKey();
    const optimistic = {
      messageId: 'pending-' + key,
      body: body,
      author: { name: reviewAuthorName(), kind: 'guest', unverified: true },
      createdAt: new Date().toISOString(),
    };
    thread.replies = thread.replies || [];
    thread.replies.push(optimistic);
    thread.messages = thread.messages || [];
    thread.messages.push(optimistic);
    reviewRenderThreads();
    reviewPaintHighlights();
    form.remove();
    button.disabled = true;
    reviewFetch('/api/feedback/' + encodeURIComponent(threadId) + '/replies', {
      method: 'POST',
      body: { body: body, authorName: reviewAuthorName(), idempotencyKey: key },
    })
      .then(function (data) {
        if (data && data.thread) reviewReplaceThread(data.thread);
        reviewLoadThreads({ quiet: true });
        showToast('Reply added');
        reviewAnnounce('Reply added');
      })
      .catch(function (error) {
        thread.replies = thread.replies.filter(function (reply) {
          return reply.messageId !== optimistic.messageId;
        });
        thread.messages = thread.messages.filter(function (message) {
          return message.messageId !== optimistic.messageId;
        });
        reviewRenderThreads();
        reviewPaintHighlights();
        reviewShowApiError(error, 'Reply could not be added.');
      })
      .finally(function () {
        button.disabled = false;
      });
  }

  function reviewReplaceThread(thread) {
    if (!review || !thread) return;
    const index = review.threads.findIndex(function (item) {
      return item.threadId === thread.threadId;
    });
    if (index >= 0) review.threads[index] = thread;
    else review.threads.push(thread);
    review.threadById.set(thread.threadId, thread);
  }

  function reviewAuthorName() {
    if (!review) return '';
    if (review.permissions && review.permissions.identity && review.permissions.identity.name) {
      return review.permissions.identity.name;
    }
    const input = review.refs.name;
    return input && !input.hidden ? input.value.trim() : '';
  }

  function reviewShowApiError(error, fallback) {
    if (!error) {
      showToast(fallback || 'Something went wrong.', 'error');
      return;
    }
    if (error.code === 'version_conflict') {
      showToast('This thread changed — reloading.', 'error');
      reviewLoadThreads({ quiet: true });
      return;
    }
    if (error.status === 429) {
      showToast('Too many actions — try again in a moment.', 'error');
      return;
    }
    if (error.code === 'feedback_not_configured') {
      showToast('Review is not configured on this deployment.', 'error');
      return;
    }
    if (error.code === 'invalid_revision') {
      showToast('This artifact has no published revision yet — feedback starts with the next publish.', 'error');
      return;
    }
    showToast(error.message || fallback || 'Something went wrong.', 'error');
  }

  function reviewChangeStatus(threadId, status) {
    const thread = reviewFindThread(threadId);
    if (!thread) return;
    if (review.readonly) {
      showToast('Old revisions are read-only.', 'error');
      return;
    }
    const previousStatus = thread.status;
    thread.status = status;
    reviewRenderThreads();
    reviewPaintHighlights();
    reviewFetch('/api/feedback/' + encodeURIComponent(threadId), {
      method: 'PATCH',
      body: {
        status: status,
        expectedVersion: thread.version,
        addressedRevisionId: status === 'addressed' ? review.viewRevisionId || undefined : undefined,
      },
    })
      .then(function (data) {
        if (data && data.thread) reviewReplaceThread(data.thread);
        showToast('Thread marked ' + status);
        reviewAnnounce('Thread marked ' + status);
        reviewLoadThreads({ quiet: true });
      })
      .catch(function (error) {
        thread.status = previousStatus;
        reviewRenderThreads();
        reviewPaintHighlights();
        reviewShowApiError(error, 'Could not update the thread.');
      });
  }

  function reviewJumpToThread(threadId) {
    let state = review && review.anchorState && review.anchorState.get(threadId);
    if (state && !state.anchored) {
      // The artifact DOM may have changed since the last resolve (tabs, filters, lazy content):
      // rebuild the index once and retry before declaring the anchor lost.
      reviewInvalidateIndexes();
      reviewPaintHighlights();
      state = review.anchorState.get(threadId);
    }
    if (state && state.document) {
      const target = state.target || review.targets[0];
      const behavior = reviewReduceMotion() ? 'auto' : 'smooth';
      if (target && target.frame) {
        try {
          target.doc.defaultView.scrollTo({ top: 0, behavior: behavior });
        } catch (error) {
          /* ignore */
        }
      } else {
        window.scrollTo({ top: 0, behavior: behavior });
      }
      review.pendingFocusThread = threadId;
      reviewFocusThreadCard(threadId);
      return;
    }
    if (!state || !state.anchored || !state.range) {
      showToast('Could not find this passage in the current revision.', 'error');
      return;
    }
    const range = state.range;
    const target = state.target;
    const behavior = reviewReduceMotion() ? 'auto' : 'smooth';
    const scroll = function () {
      try {
        const element =
          range.startContainer.nodeType === 1
            ? range.startContainer
            : range.startContainer.parentElement;
        if (target.frame) {
          // HTML artifact: scroll the artifact document itself, never the outer page.
          const win = target.doc.defaultView;
          if (element && typeof element.scrollIntoView === 'function') {
            element.scrollIntoView({ block: 'center', behavior: behavior });
          } else if (win) {
            const rect = range.getBoundingClientRect();
            win.scrollTo({
              top: Math.max(0, win.scrollY + rect.top - win.innerHeight / 2),
              behavior: behavior,
            });
          }
        } else if (element) {
          element.scrollIntoView({ block: 'center', behavior: behavior });
        }
        reviewFlashAnchor(range);
      } catch (error) {
        /* detached range */
      }
    };
    if (reviewRevealPanelForSelection()) {
      setTimeout(scroll, 220);
    } else {
      scroll();
    }
    try {
      window.history.replaceState(null, '', '#thread-' + threadId);
    } catch (error) {
      /* ignore */
    }
    review.pendingFocusThread = threadId;
    reviewFocusThreadCard(threadId);
  }

  function reviewFocusThreadCard(threadId) {
    if (!review) return;
    const card = review.refs.list.querySelector('[data-thread="' + threadId + '"]');
    if (!card) return;
    const quote = card.querySelector('.thread-quote');
    if (quote) quote.focus({ preventScroll: true });
    card.scrollIntoView({ block: 'nearest' });
  }

  function reviewReduceMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (error) {
      return false;
    }
  }

  function reviewRevealPanelForSelection() {
    if (!review) return false;
    const mobile = reviewIsMobile();
    if (mobile && review.open) {
      reviewBackToSelection();
      return true;
    }
    return false;
  }

  /* --------------------------------------------------------- thread actions */

  function reviewListClick(event) {
    const actionEl = event.target.closest('[data-thread-action]');
    if (!actionEl) return;
    const action = actionEl.getAttribute('data-thread-action');
    const threadId = actionEl.getAttribute('data-thread-id') || '';
    if (action === 'jump') {
      event.preventDefault();
      reviewJumpToThread(threadId);
    } else if (action === 'reply') {
      reviewShowReplyForm(threadId, actionEl);
    } else if (action === 'cancel-reply') {
      const form = actionEl.closest('.thread-reply-form');
      if (form) form.remove();
      const replyButton = review.refs.list.querySelector(
        '[data-thread-id="' + threadId + '"][data-thread-action="reply"]',
      );
      if (replyButton) replyButton.setAttribute('aria-expanded', 'false');
    } else if (action === 'addressed' || action === 'resolved' || action === 'open') {
      reviewChangeStatus(threadId, action);
    }
  }

  /* --------------------------------------------------------- create thread */

  function reviewComposerOpen() {
    return review && !review.refs.composer.hidden;
  }

  function reviewStartComposer(kind, anchorInfo) {
    if (!review || review.available === false) return;
    if (review.readonly) {
      showToast('Old revisions are read-only.', 'error');
      return;
    }
    if (review.permissions && review.permissions.canComment === false) {
      showToast(review.readonlyReason || 'A review link is needed to add feedback.', 'error');
      return;
    }
    if (!anchorInfo || !anchorInfo.anchor) return;
    if (anchorInfo.anchor.type === 'document' && document.querySelector('iframe.viewer-frame')) {
      // Whole-document comments must also be pinned to the artifact bytes currently shown.
      if (!reviewUpdateFrameGuard()) {
        showToast('The embedded page navigated away from the artifact — reload to comment.', 'error');
        return;
      }
    }
    clearTimeout(review.selectionTimer);
    review.composedAnchor = anchorInfo.anchor;
    reviewHidePopover();
    const isDocument = anchorInfo.anchor.type === 'document';
    review.composer = {
      kind: isDocument ? 'comment' : kind,
      anchor: anchorInfo.anchor,
      anchorInfo: anchorInfo,
      target: anchorInfo.target || null,
      document: isDocument,
      idempotencyKey: reviewIdempotencyKey(),
    };
    const refs = review.refs;
    refs.composerQuote.textContent = isDocument
      ? 'Whole document'
      : reviewClip(anchorInfo.anchor.exact, 220);
    refs.composerQuote.title = isDocument ? 'Whole document' : anchorInfo.anchor.exact || '';
    refs.input.value = '';
    refs.formError.hidden = true;
    refs.replacement.value = kind === 'replace' ? anchorInfo.anchor.exact : '';
    refs.replacement.hidden = kind !== 'replace';
    refs.kind.hidden = true;
    refs.kind.querySelectorAll('[data-review-kind-value]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-review-kind-value') === kind));
    });
    const kicker = { comment: 'New comment', replace: 'Suggested replacement', remove: 'Suggested removal' };
    refs.composerKicker.textContent = kicker[kind] || 'New comment';
    refs.submit.textContent = kind === 'replace' ? 'Suggest replacement' : kind === 'remove' ? 'Suggest removal' : 'Add comment';
    refs.name.hidden = !!(review.permissions && review.permissions.identity);
    reviewOpenPanel({ focus: false });
    refs.composer.hidden = false;
    refs.composer.classList.remove('is-entering');
    requestAnimationFrame(function () {
      if (review && !refs.composer.hidden) refs.input.focus();
    });
    if (reviewIsMobile()) refs.panel.scrollTop = 0;
    reviewUpdateHint();
  }

  function reviewCancelComposer() {
    if (!review) return;
    review.refs.composer.hidden = true;
    review.composer = null;
    review.refs.formError.hidden = true;
    review.refs.input.value = '';
    review.refs.replacement.value = '';
    reviewUpdateHint();
    reviewAnnounce('');
  }

  function reviewSubmitComposer(event) {
    event.preventDefault();
    if (!review || !review.composer || review.submitting) return;
    const refs = review.refs;
    const body = refs.input.value.trim();
    const kind = review.composer.kind;
    const replacement = kind === 'replace' ? refs.replacement.value.trim() : '';
    if (!body) {
      reviewShowFormError('Write a comment before submitting.');
      refs.input.focus();
      return;
    }
    if (kind === 'replace' && !replacement) {
      reviewShowFormError('The suggested replacement is empty.');
      refs.replacement.focus();
      return;
    }
    if (!review.viewRevisionId) {
      reviewShowFormError('This artifact has no published revision yet — feedback starts with the next publish.');
      return;
    }
    if (composerTargetInvalid()) {
      reviewShowFormError('The embedded page navigated away from the artifact — reload before commenting.');
      return;
    }
    const composer = review.composer;
    const payload = reviewThreadPayload(composer, body, replacement, reviewAuthorName());
    reviewRememberName(reviewAuthorName());

    review.submitting = true;
    refs.submit.disabled = true;
    refs.submit.setAttribute('aria-busy', 'true');
    refs.formError.hidden = true;
    const now = new Date().toISOString();
    review.pendingThread = {
      threadId: 'pending-' + composer.idempotencyKey,
      artifactId: payload.artifactId,
      revisionId: payload.revisionId,
      revisionNumber: review.revisionNumber || null,
      kind: kind,
      status: 'open',
      version: 0,
      anchor: composer.anchor,
      author: { name: reviewAuthorName() || 'You', kind: 'guest', unverified: !reviewAuthorName() },
      createdAt: now,
      updatedAt: now,
      messages: [
        {
          messageId: 'pending-' + composer.idempotencyKey,
          seq: 1,
          body: body,
          kind: kind,
          replacement: replacement || null,
          author: { name: reviewAuthorName() || 'You', kind: 'guest', unverified: true },
          createdAt: now,
        },
      ],
      replies: [],
    };
    reviewRenderThreads();
    refs.composer.hidden = true;
    if (review.statusFilter !== 'open') {
      review.statusFilter = 'open';
      reviewUpdateFilters();
      reviewRenderThreads();
    }
    reviewAnnounce('Adding feedback…');

    reviewPostThread(payload)
      .then(function () {
        review.pendingThread = null;
        review.composer = null;
        refs.input.value = '';
        refs.replacement.value = '';
        showToast('Feedback added');
        reviewAnnounce('Feedback added');
        reviewLoadThreads({ quiet: true });
      })
      .catch(function (error) {
        review.pendingThread = null;
        reviewRenderThreads();
        refs.composer.hidden = false;
        review.composer = composer;
        reviewShowApiError(error, 'Feedback could not be added.');
        reviewShowFormError((error && error.message) || 'Feedback could not be added.');
      })
      .finally(function () {
        review.submitting = false;
        refs.submit.disabled = false;
        refs.submit.removeAttribute('aria-busy');
      });
  }

  function composerTargetInvalid() {
    if (!review || !review.composer) return false;
    // Whole-document comments have no target element, but they still bind to the artifact the
    // shell rendered: if the iframe now shows something else, both text and document anchors
    // must be blocked (otherwise the POST could record artifact A while showing B).
    if (review.composer.document) {
      return !!document.querySelector('iframe.viewer-frame') && !reviewFrameMatches();
    }
    const target = review.composer.target;
    return !!(target && target.frame && review.frameReady === false);
  }

  function reviewShowFormError(message) {
    if (!review) return;
    review.refs.formError.textContent = message;
    review.refs.formError.hidden = !message;
  }

  /* ----------------------------------------------------- selection plumbing */

  function reviewTargetElements() {
    const targets = [];
    const frame = document.querySelector('iframe.viewer-frame');
    if (frame) {
      const doc = reviewFrameDocument(frame);
      if (doc) targets.push({ doc: doc, container: doc.body, frame: frame, index: null, indexDoc: null });
    }
    const reader = document.querySelector('.reader-body, #reader-body');
    if (reader) targets.push({ doc: document, container: reader, frame: null, index: null, indexDoc: null });
    return targets;
  }

  /** The artifact URL the shell rendered (raw path + pinned ?rev=); any navigation away is not
   *  the artifact and must never receive feedback. */
  function reviewFrameExpected() {
    const frame = document.querySelector('iframe.viewer-frame');
    if (!frame) return null;
    try {
      const url = new URL(frame.getAttribute('src') || '', window.location.href);
      return { pathname: url.pathname, revision: url.searchParams.get('rev') || '' };
    } catch (error) {
      return null;
    }
  }

  /** True while the iframe still shows the rendered artifact document. */
  function reviewFrameMatches() {
    if (!review || !review.frameExpected) return true;
    const frame = document.querySelector('iframe.viewer-frame');
    if (!frame) return true;
    try {
      const current = new URL(frame.contentWindow.location.href);
      if (current.pathname !== review.frameExpected.pathname) return false;
      if (review.frameExpected.revision) {
        return current.searchParams.get('rev') === review.frameExpected.revision;
      }
      return true;
    } catch (error) {
      // same-origin viewer: a SecurityError means navigation left our origin
      return false;
    }
  }

  function reviewUpdateFrameGuard() {
    if (!review) return false;
    const matches = reviewFrameMatches();
    const changed = review.frameReady !== matches;
    review.frameReady = matches;
    if (review.refs && review.refs.frameNote) {
      review.refs.frameNote.hidden = matches;
    }
    if (!matches) {
      reviewHidePopover();
      reviewHideInline();
      review.composedAnchor = null;
      if (reviewComposerOpen()) reviewCancelComposer();
      reviewAnnounce('The embedded page navigated away from the artifact. Reload to add feedback.');
    }
    if (changed) reviewRenderThreads();
    return matches;
  }

  function reviewInvalidateTextIndex(target) {
    if (!target) return;
    target.index = null;
    target.indexDoc = null;
  }

  function reviewInvalidateIndexes() {
    if (!review) return;
    review.targets.forEach(reviewInvalidateTextIndex);
  }

  /** Rebuild anchored ranges after the artifact DOM mutated (interactive HTML, tabs, filters). */
  function reviewWatchTarget(target) {
    if (!review || !target || !target.container || target.observer) return;
    try {
      const win = target.doc.defaultView;
      if (!win || typeof win.MutationObserver !== 'function') return;
      target.observer = new win.MutationObserver(function () {
        clearTimeout(review.mutationTimer);
        review.mutationTimer = setTimeout(function () {
          if (!review) return;
          reviewInvalidateIndexes();
          reviewRenderThreads();
          reviewPaintHighlights();
          reviewUpdateFrameGuard();
        }, 360);
      });
      target.observer.observe(target.container, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    } catch (error) {
      /* observation is best-effort */
    }
  }

  function reviewDetachTargets() {
    if (!review) return;
    (review.targets || []).forEach(function (target) {
      if (target.observer) {
        try {
          target.observer.disconnect();
        } catch (error) {
          /* ignore */
        }
        target.observer = null;
      }
    });
  }

  function reviewFrameDocument(frame) {
    try {
      const doc = frame.contentDocument;
      if (doc && doc.body) return doc;
    } catch (error) {
      /* cross-origin is not expected (same-origin viewer); no highlight possible */
    }
    return null;
  }

  function reviewAttachTarget(target) {
    if (!target || !target.doc || target.attached) return;
    target.attached = true;
    const doc = target.doc;
    const check = function () {
      // A fresh user selection may revisit the same passage; allow the toolbar again.
      if (review) review.composedAnchor = null;
      reviewScheduleSelectionCheck(10);
    };
    doc.addEventListener('mouseup', check, true);
    doc.addEventListener('keyup', function (event) {
      if (event.shiftKey || event.key === 'Shift' || event.key === 'Escape') check();
    }, true);
    doc.addEventListener('selectionchange', function () {
      reviewScheduleSelectionCheck(180);
    });
    doc.addEventListener('keydown', reviewAnnotationKeydown, true);
    doc.addEventListener('scroll', function () {
      if (!review) return;
      reviewHidePopover();
      reviewHideInline();
    }, true);
    reviewWatchTarget(target);
  }

  function reviewSelectionTarget() {
    if (!review) return null;
    for (let i = 0; i < review.targets.length; i++) {
      const target = review.targets[i];
      let selection = null;
      try {
        selection = target.doc.getSelection();
      } catch (error) {
        selection = null;
      }
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) continue;
      let range;
      try {
        range = selection.getRangeAt(0);
      } catch (error) {
        continue;
      }
      if (target.frame && review && review.frameReady === false) continue;
      if (!target.container || !target.container.contains(range.commonAncestorContainer)) continue;
      return { target: target, selection: selection, range: range };
    }
    return null;
  }

  function reviewScheduleSelectionCheck(delay) {
    if (!review) return;
    clearTimeout(review.selectionTimer);
    review.selectionTimer = setTimeout(function () {
      if (!review) return;
      // A composer already owns the anchor; do not re-show the selection toolbar over it.
      if (reviewComposerOpen() || reviewInlineOpen() || review.submitting) {
        reviewHidePopover();
        return;
      }
      if (!review.mode || !review.available) {
        reviewHidePopover();
        return;
      }
      if (review.readonly || (review.permissions && review.permissions.canComment === false)) {
        reviewHidePopover();
        return;
      }
      // Never capture a selection from an artifact that navigated somewhere else.
      if (review.frameExpected && !reviewUpdateFrameGuard()) {
        reviewHidePopover();
        return;
      }
      const found = reviewSelectionTarget();
      if (!found) {
        review.composedAnchor = null;
        reviewHidePopover();
        return;
      }
      const anchor = reviewAnchorFromSelection(found.target, found.selection);
      if (!anchor) {
        reviewHidePopover();
        return;
      }
      if (review.composedAnchor && reviewSameAnchor(anchor, review.composedAnchor)) {
        reviewHidePopover();
        return;
      }
      review.pendingAnchor = { anchor: anchor, target: found.target, range: found.range };
      reviewShowPopover();
    }, delay);
  }

  /** Same passage (enough to suppress re-showing the toolbar for an anchor already composed). */
  function reviewSameAnchor(a, b) {
    if (!a || !b) return false;
    return a.exact === b.exact && a.start === b.start && a.end === b.end;
  }

  function reviewShowPopover() {
    if (!review || !review.pendingAnchor || reviewComposerOpen() || review.submitting) return;
    const refs = review.refs;
    refs.popover.hidden = false;
    refs.popover.classList.remove('is-open');
    reviewPositionPopover();
    requestAnimationFrame(function () {
      if (review && !refs.popover.hidden) refs.popover.classList.add('is-open');
    });
  }

  /** Anchor rectangle in viewport coordinates (iframe ranges get their frame offset added). */
  function reviewAnchorRect(info) {
    if (!info) return null;
    try {
      const rects = info.range.getClientRects();
      let rect = rects.length ? rects[rects.length - 1] : info.range.getBoundingClientRect();
      if (info.target && info.target.frame) {
        const frameRect = info.target.frame.getBoundingClientRect();
        rect = {
          left: frameRect.left + rect.left,
          top: frameRect.top + rect.top,
          right: frameRect.left + rect.right,
          bottom: frameRect.top + rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      }
      return rect;
    } catch (error) {
      return null;
    }
  }

  /** Place a fixed floating element near the selection, clamped to the viewport. */
  function reviewPositionFloating(element, info, fallbackWidth, fallbackHeight) {
    if (!element || !info) return false;
    const rect = reviewAnchorRect(info);
    if (!rect || (!rect.width && !rect.height)) return false;
    const width = element.offsetWidth || fallbackWidth;
    const height = element.offsetHeight || fallbackHeight;
    const topbar = document.querySelector('[data-topbar]');
    const barBottom = topbar ? topbar.getBoundingClientRect().bottom : 0;
    let top = rect.top - height - 10;
    let originY = '100%';
    if (top < barBottom + 8) {
      top = rect.bottom + 10;
      originY = '0%';
    }
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    top = Math.max(barBottom + 8, Math.min(top, window.innerHeight - height - 8));
    element.style.left = Math.round(left) + 'px';
    element.style.top = Math.round(top) + 'px';
    const originX = Math.max(0, Math.min(100, ((rect.left + rect.width / 2 - left) / width) * 100));
    element.style.setProperty('--sel-origin', originX + '% ' + originY);
    return true;
  }

  function reviewPositionPopover() {
    if (!review || !review.pendingAnchor) return;
    if (!reviewPositionFloating(review.refs.popover, review.pendingAnchor, 240, 36)) {
      reviewHidePopover();
    }
  }

  function reviewPositionInline() {
    if (!review || !review.inline) return;
    if (!reviewPositionFloating(review.refs.inline, review.inline.anchorInfo, 320, 220)) {
      reviewHideInline();
    }
  }

  function reviewHidePopover() {
    if (!review) return;
    const refs = review.refs;
    if (!refs.popover || refs.popover.hidden) return;
    refs.popover.classList.remove('is-open');
    clearTimeout(review.popoverTimer);
    review.popoverTimer = setTimeout(function () {
      if (review && !review.refs.popover.classList.contains('is-open')) {
        review.refs.popover.hidden = true;
      }
    }, 140);
    review.pendingAnchor = null;
  }

  function reviewAnnotationKeydown(event) {
    if (!review || !review.mode) return;
    const combo =
      (event.altKey && event.key === 'Enter') ||
      ((event.metaKey || event.ctrlKey) && event.key === 'Enter');
    if (!combo) return;
    const active = event.target;
    const tag = active && active.tagName ? active.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (review.readonly || (review.permissions && review.permissions.canComment === false)) return;
    const found = reviewSelectionTarget();
    if (!found) return;
    const anchor = reviewAnchorFromSelection(found.target, found.selection);
    if (!anchor) return;
    event.preventDefault();
    review.pendingAnchor = { anchor: anchor, target: found.target, range: found.range };
    reviewStartInlineComposer('comment', review.pendingAnchor);
  }

  /* ----------------------------------------------------------- panel state */

  function reviewIsMobile() {
    try {
      return window.matchMedia('(max-width: 860px)').matches;
    } catch (error) {
      return false;
    }
  }

  function reviewOpenPanel(options) {
    if (!review || review.available === false) return;
    const opts = options || {};
    const wasOpen = review.open;
    review.open = true;
    review.pillDismissed = false;
    reviewHidePopover();
    reviewHideInline();
    const refs = review.refs;
    refs.panel.hidden = false;
    document.body.classList.add('review-open');
    requestAnimationFrame(function () {
      if (review && review.open) refs.panel.classList.add('is-open');
    });
    reviewSyncModalState(true);
    reviewUpdateBadge();
    reviewUpdateHint();
    if (!wasOpen) {
      review.pendingFocusThread = review.pendingFocusThread || '';
      reviewLoadThreads({ quiet: review.threads.length > 0 });
      reviewLoadRevisions({});
    }
    reviewStartPolling();
    if (opts.focus !== false && !wasOpen) {
      reviewFocusPanel();
    }
  }

  function reviewFocusPanel() {
    const refs = review.refs;
    if (reviewComposerOpen()) {
      refs.input.focus();
      return;
    }
    try {
      refs.panel.focus({ preventScroll: true });
    } catch (error) {
      focusEl(refs.panel);
    }
  }

  function reviewClosePanel(options) {
    if (!review) return;
    const opts = options || {};
    const refs = review.refs;
    review.open = false;
    review.pillDismissed = false;
    refs.panel.classList.remove('is-open');
    document.body.classList.remove('review-open');
    reviewSyncModalState(false);
    reviewStopPolling();
    reviewHidePopover();
    review.pendingThread = null;
    if (review.composer) reviewCancelComposer();
    clearTimeout(review.closeTimer);
    review.closeTimer = setTimeout(function () {
      if (review && !review.open) refs.panel.hidden = true;
    }, 200);
    reviewUpdateBadge();
    reviewUpdateHint();
    if (opts.restoreFocus !== false) {
      const toggle = document.querySelector('[data-review-toggle]');
      if (toggle && !toggle.hidden) focusEl(toggle);
    }
  }

  /** Mobile sheet: close it but keep annotate mode armed, and scroll back to the selection. */
  function reviewBackToSelection() {
    if (!review) return;
    const refs = review.refs;
    review.open = false;
    review.pillDismissed = true;
    refs.panel.classList.remove('is-open');
    document.body.classList.remove('review-open');
    reviewSyncModalState(false);
    reviewHidePopover();
    clearTimeout(review.closeTimer);
    review.closeTimer = setTimeout(function () {
      if (review && !review.open) refs.panel.hidden = true;
    }, 200);
    if (review.pendingAnchor) {
      const anchor = review.pendingAnchor;
      setTimeout(function () {
        reviewFlashAnchor(anchor.range);
      }, 240);
    }
    reviewUpdateBadge();
    reviewUpdateHint();
    reviewUpdatePill();
  }

  function reviewSyncModalState(open) {
    if (!review) return;
    const refs = review.refs;
    const mobile = reviewIsMobile();
    const scrim = refs.scrim;
    if (open && mobile) {
      scrim.hidden = false;
      requestAnimationFrame(function () {
        if (review && review.open) scrim.classList.add('is-open');
      });
      refs.panel.setAttribute('aria-modal', 'true');
      if (!refs.panel.contains(document.activeElement)) {
        setTimeout(function () {
          if (review && review.open && reviewIsMobile() && !reviewComposerOpen()) reviewFocusPanel();
        }, 180);
      }
      setReviewBackgroundInert(true);
      document.body.style.overflow = 'hidden';
    } else {
      scrim.classList.remove('is-open');
      clearTimeout(review.scrimTimer);
      review.scrimTimer = setTimeout(function () {
        if (review && !review.open) refs.scrim.hidden = true;
      }, 200);
      refs.panel.setAttribute('aria-modal', 'false');
      setReviewBackgroundInert(false);
      document.body.style.overflow = '';
    }
    reviewUpdatePill();
  }

  let reviewInerted = [];

  function setReviewBackgroundInert(on) {
    if (!review) return;
    if (!on) {
      reviewInerted.forEach(function (element) {
        if (element !== review.refs.panel) element.inert = false;
      });
      reviewInerted = [];
      return;
    }
    if (reviewInerted.length) return;
    let node = review.refs.panel;
    while (node && node !== document.body && node.parentElement) {
      const parent = node.parentElement;
      Array.prototype.forEach.call(parent.children, function (child) {
        if (child === node || child.inert || child === review.refs.scrim) return;
        child.inert = true;
        reviewInerted.push(child);
      });
      node = parent;
    }
    // The scrim itself never needs inert; the panel must stay interactive.
    reviewInerted = reviewInerted.filter(function (element) {
      return element !== review.refs.panel;
    });
  }

  function reviewUpdatePill() {
    if (!review) return;
    const refs = review.refs;
    const show = reviewIsMobile() && review.mode && !review.open && review.pillDismissed;
    if (!refs.pill) return;
    refs.pill.hidden = !show;
    if (show) {
      const text = refs.pillText;
      if (text) {
        const open = review.counts ? review.counts.open : 0;
        text.textContent = open ? 'Feedback · ' + open + ' open' : 'Feedback';
      }
    }
  }

  function reviewStartPolling() {
    if (!review) return;
    reviewStopPolling();
    review.pollTimer = setInterval(function () {
      if (!review || !review.open) return;
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (reviewComposerOpen() || review.refs.list.querySelector('.thread-reply-form')) return;
      if (review.loadingThreads) return;
      reviewLoadThreads({ quiet: true });
    }, 15000);
  }

  function reviewStopPolling() {
    if (!review) return;
    clearInterval(review.pollTimer);
    review.pollTimer = 0;
  }

  /* ---------------------------------------------------------- version UI */

  function reviewLatestHref() {
    const url = new URL(window.location.href);
    url.searchParams.delete('rev');
    return url.pathname + (url.search || '');
  }

  function reviewVersionHref(revisionId) {
    const url = new URL(window.location.href);
    if (revisionId) url.searchParams.set('rev', revisionId);
    else url.searchParams.delete('rev');
    return url.pathname + (url.search || '');
  }

  function reviewApplyPinnedRevision() {
    if (!review) return;
    const params = new URLSearchParams(window.location.search);
    const pinned = params.get('rev') || '';
    if (!pinned) {
      review.viewRevisionId = review.viewRevisionId || '';
      review.readonly = review.serverRevisionIsLatest === false;
      reviewUpdateReadonlyNote();
      reviewUpdateHint();
      return;
    }
    if (!reviewIsRevisionId(pinned)) return;
    review.viewRevisionId = pinned;
    const revisions = review.revisions || [];
    const match = revisions.find(function (revision) {
      return revision.revisionId === pinned;
    });
    if (match) {
      review.revisionNumber = match.number;
      review.readonly = !match.isLatest;
    } else {
      review.readonly = true;
    }
    const latest = revisionLatest(revisions);
    if (latest) review.revisionLatestNumber = latest.number;
    if (review.readonly) reviewEnsureRevisionBanner();
    reviewUpdateReadonlyNote();
    reviewUpdateHint();
    reviewUpdateVersionsEntry();
    reviewSyncArmed();
  }

  function revisionLatest(revisions) {
    if (!revisions || !revisions.length) return null;
    for (let i = revisions.length - 1; i >= 0; i--) {
      if (revisions[i].isLatest) return revisions[i];
    }
    return revisions[revisions.length - 1];
  }

  function reviewEnsureRevisionBanner() {
    if (!review || !review.readonly) return;
    if (document.querySelector('[data-rev-banner]')) {
      reviewEnhanceRevisionBanner();
      return;
    }
    if (!review.revisions || !review.revisions.length) return;
    const match = review.revisions.find(function (revision) {
      return revision.revisionId === review.viewRevisionId;
    });
    if (!match) return;
    const latest = revisionLatest(review.revisions);
    const banner = reviewEl('div', 'rev-banner');
    banner.setAttribute('data-rev-banner', '');
    banner.setAttribute('role', 'status');
    const text = reviewEl('span', 'rev-banner-text');
    text.appendChild(reviewIcon('history'));
    text.appendChild(
      reviewEl(
        'span',
        '',
        'Viewing revision ' +
          match.number +
          ' of ' +
          review.revisions.length +
          ' — latest is v' +
          (latest ? latest.number : review.revisions.length),
      ),
    );
    const link = reviewEl('a', 'rev-banner-link', 'Back to latest');
    link.href = reviewLatestHref();
    banner.appendChild(text);
    banner.appendChild(link);
    document.body.classList.add('has-rev');
    const main =
      document.getElementById('main-viewer') ||
      document.getElementById('main-reader') ||
      document.querySelector('main');
    if (main && main.parentNode) main.parentNode.insertBefore(banner, main);
  }

  function reviewEnhanceRevisionBanner() {
    const banner = document.querySelector('[data-rev-banner]');
    if (!banner) return;
    document.body.classList.add('has-rev');
    const link = banner.querySelector('.rev-banner-link');
    if (link) link.href = reviewLatestHref();
  }

  function reviewOpenVersions() {
    if (!review) return;
    closeMoreMenu(false);
    hideTip();
    review.refs.versionsModal.hidden = false;
    // The Versions item lives in the More popover, which closes before the dialog opens, so
    // restore focus to the visible More trigger instead of the now-hidden menu item.
    review.versionsLastFocus =
      document.querySelector('[data-more]') || document.activeElement;
    document.body.style.overflow = 'hidden';
    setReviewDialogInert(true);
    requestAnimationFrame(function () {
      if (review && !review.refs.versionsModal.hidden) {
        review.refs.versionsModal.classList.add('is-open');
      }
    });
    if (review.revisions) reviewRenderVersions(false);
    else {
      review.refs.versionsLoading.hidden = false;
      review.refs.versionsList.textContent = '';
      reviewLoadRevisions({ openDialog: true });
    }
    const card = review.refs.versionsModal.querySelector('[data-versions-card]');
    if (card) focusEl(card);
  }

  function reviewCloseVersions() {
    if (!review) return;
    const refs = review.refs;
    refs.versionsModal.classList.remove('is-open');
    clearTimeout(review.versionsTimer);
    review.versionsTimer = setTimeout(function () {
      if (review && !refs.versionsModal.classList.contains('is-open')) {
        refs.versionsModal.hidden = true;
      }
    }, 200);
    document.body.style.overflow = '';
    setReviewDialogInert(false);
    let target = review.versionsLastFocus;
    review.versionsLastFocus = null;
    if (!target || !document.contains(target) || target.hidden || target.getClientRects().length === 0) {
      target =
        document.querySelector('[data-more]') ||
        document.querySelector('[data-review-toggle]') ||
        null;
    }
    if (target && document.contains(target) && target.getClientRects().length > 0) focusEl(target);
  }

  let reviewDialogInerted = [];

  function setReviewDialogInert(on) {
    if (!review) return;
    const modal = review.refs.versionsModal;
    if (!on) {
      reviewDialogInerted.forEach(function (element) {
        element.inert = false;
      });
      reviewDialogInerted = [];
      return;
    }
    if (reviewDialogInerted.length) return;
    let node = modal;
    while (node && node !== document.body && node.parentElement) {
      const parent = node.parentElement;
      Array.prototype.forEach.call(parent.children, function (child) {
        if (child === node || child.inert) return;
        child.inert = true;
        reviewDialogInerted.push(child);
      });
      node = parent;
    }
  }

  function reviewRenderVersions(animate) {
    if (!review) return;
    const refs = review.refs;
    refs.versionsLoading.hidden = true;
    refs.versionsError.hidden = true;
    refs.versionsList.textContent = '';
    const revisions = review.revisions || [];
    refs.versionsEmpty.hidden = revisions.length > 0;
    if (!revisions.length) return;
    revisions
      .slice()
      .sort(function (a, b) {
        return (b.number || 0) - (a.number || 0);
      })
      .forEach(function (revision) {
        const item = reviewEl('li', 'version-item');
        const isCurrent = review.viewRevisionId
          ? revision.revisionId === review.viewRevisionId
          : !!revision.isLatest;
        const button = reviewEl('button', 'version-row');
        button.type = 'button';
        button.setAttribute('data-version-open', revision.revisionId);
        if (isCurrent) button.setAttribute('aria-current', 'true');
        const main = reviewEl('span', 'version-main');
        main.appendChild(reviewEl('span', 'version-number', 'v' + revision.number));
        const meta = reviewEl('span', 'version-meta', reviewShortDate(revision.createdAt));
        if (revision.size) meta.textContent += ' · ' + reviewFormatBytes(revision.size);
        if (revision.createdBy && revision.createdBy !== 'bootstrap') {
          meta.textContent += ' · ' + revision.createdBy;
        }
        main.appendChild(meta);
        button.appendChild(main);
        const chips = reviewEl('span', 'version-chips');
        if (revision.isLatest) chips.appendChild(reviewEl('span', 'version-chip', 'Latest'));
        if (isCurrent) chips.appendChild(reviewEl('span', 'version-chip version-chip--current', 'Current'));
        button.appendChild(chips);
        if (!isCurrent) button.appendChild(reviewIcon('chevron-right'));
        item.appendChild(button);
        refs.versionsList.appendChild(item);
      });
    if (animate) {
      refs.versionsList.classList.remove('is-entering');
      requestAnimationFrame(function () {
        if (refs.versionsList) refs.versionsList.classList.add('is-entering');
      });
    }
  }

  function reviewRenderVersionsError(error) {
    if (!review) return;
    const refs = review.refs;
    refs.versionsLoading.hidden = true;
    refs.versionsEmpty.hidden = true;
    refs.versionsList.textContent = '';
    refs.versionsError.hidden = false;
    refs.versionsError.textContent =
      error && error.status === 401
        ? 'Sign in to see version history.'
        : (error && error.message) || 'Version history could not be loaded.';
  }

  function reviewVersionsClick(event) {
    if (!review) return;
    const row = event.target.closest('[data-version-open]');
    if (!row) return;
    const revisionId = row.getAttribute('data-version-open');
    window.location.assign(reviewVersionHref(revisionId));
  }

  /* --------------------------------------------------------------- exports */

  function reviewExportJson() {
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      artifact: review.artifact || {
        project: review.project,
        file: review.file,
        routePath: review.route,
      },
      revision: review.revision || null,
      counts: review.counts || reviewComputeCounts(review.threads),
      threads: review.threads.slice().sort(function (a, b) {
        return String(a.createdAt).localeCompare(String(b.createdAt));
      }),
    };
  }

  function reviewExportMarkdown() {
    const artifact = review.artifact || { project: review.project, file: review.file };
    const lines = [];
    lines.push('# Feedback — ' + (review.title || artifact.routePath || review.file || 'Artifact'));
    lines.push('');
    lines.push(
      'Project: ' +
        (artifact.project || review.project) +
        ' · File: ' +
        (artifact.file || review.file) +
        (review.revisionNumber ? ' · Viewing revision ' + review.revisionNumber : ''),
    );
    lines.push('Exported: ' + reviewShortDate(new Date()));
    if (review.counts) {
      lines.push(
        'Open: ' +
          review.counts.open +
          ' · Addressed: ' +
          review.counts.addressed +
          ' · Resolved: ' +
          review.counts.resolved,
      );
    }
    lines.push('');
    reviewFilteredThreads().forEach(function (thread) {
      const messages = thread.messages || [];
      const first = messages[0] || { body: thread.body || '' };
      lines.push('---');
      lines.push('');
      lines.push(
        '## ' +
          (REVIEW_KIND_LABEL[thread.kind] || 'Comment') +
          ' · ' +
          (REVIEW_STATUS_LABEL[thread.status] || thread.status) +
          (thread.revisionNumber ? ' · v' + thread.revisionNumber : ''),
      );
      lines.push('');
      const anchor = thread.anchor || {};
      lines.push(
        anchor.type === 'document'
          ? '> Whole document'
          : '> ' + String(anchor.exact || '').replace(/\n/g, '\n> '),
      );
      lines.push('');
      lines.push(
        '-' +
          (thread.author && thread.author.name ? ' ' + thread.author.name : '') +
          (thread.createdAt ? ' · ' + thread.createdAt : ''),
      );
      lines.push('');
      lines.push(String(first.body || ''));
      lines.push('');
      if (first.replacement) {
        lines.push('Suggested replacement:');
        lines.push('');
        lines.push('```');
        lines.push(first.replacement);
        lines.push('```');
        lines.push('');
      }
      (thread.replies || []).forEach(function (reply) {
        lines.push(
          '**Reply' +
            (reply.author && reply.author.name ? ' — ' + reply.author.name : '') +
            ':** ' +
            String(reply.body || ''),
        );
        lines.push('');
      });
    });
    if (review.threads.length === 0) lines.push('_No feedback in this view._');
    return lines.join('\n') + '\n';
  }

  function reviewDownload() {
    if (!review) return;
    const format = review.exportFormat || 'md';
    const isJson = format === 'json';
    const content = isJson
      ? JSON.stringify(reviewExportJson(), null, 2) + '\n'
      : reviewExportMarkdown();
    const type = isJson ? 'application/json' : 'text/markdown';
    const base =
      (review.artifact && review.artifact.file ? review.artifact.file.split('/').pop() : review.file) || 'artifact';
    const filename =
      'feedback-' +
      String(base).replace(/[^a-z0-9.-]+/gi, '-').replace(/-+/g, '-') +
      '-' +
      new Date().toISOString().slice(0, 10) +
      (isJson ? '.json' : '.md');
    try {
      const blob = new Blob([content], { type: type + ';charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
      showToast('Feedback downloaded');
      reviewAnnounce('Feedback downloaded');
    } catch (error) {
      showToast('Download failed — use Copy instead.', 'error');
    }
  }

  function reviewCopy() {
    if (!review) return;
    const text = (review.exportFormat || 'md') === 'json'
      ? JSON.stringify(reviewExportJson(), null, 2)
      : reviewExportMarkdown();
    copyText(text).then(function (ok) {
      showToast(ok ? 'Feedback copied' : 'Copy failed — try Download instead.', ok ? 'success' : 'error');
      if (ok) reviewAnnounce('Feedback copied');
    });
  }

  /* ------------------------------------------ create-thread request (shared) */

  /** One POST shape for both the panel composer and the inline selection composer. */
  function reviewThreadPayload(composer, body, replacement, authorName) {
    const payload = {
      kind: composer.kind,
      anchor: composer.anchor,
      body: body,
      authorName: authorName || undefined,
      idempotencyKey: composer.idempotencyKey,
    };
    if (review.artifactId) payload.artifactId = review.artifactId;
    else {
      payload.project = review.project;
      payload.file = review.file;
    }
    payload.revisionId = review.viewRevisionId;
    if (replacement) payload.replacement = replacement;
    return payload;
  }

  function reviewPostThread(payload) {
    return reviewFetch('/api/feedback', { method: 'POST', body: payload });
  }

  /* ------------------------------------------ inline selection composer */

  function reviewInlinePermissionText() {
    if (review && review.readonly) return 'Old revisions are read-only.';
    return review && review.readonlyReason
      ? review.readonlyReason
      : 'A review link is needed to add feedback.';
  }

  function reviewStartInlineComposer(kind, anchorInfo) {
    if (!review || review.available === false) return;
    if (!reviewCanSelectToComment()) {
      showToast(reviewInlinePermissionText(), 'error');
      return;
    }
    if (!anchorInfo || !anchorInfo.anchor || anchorInfo.anchor.type !== 'text') return;
    if (anchorInfo.target && anchorInfo.target.frame && !reviewUpdateFrameGuard()) {
      showToast('The embedded page navigated away from the artifact — reload to comment.', 'error');
      return;
    }
    clearTimeout(review.selectionTimer);
    review.composedAnchor = anchorInfo.anchor;
    reviewHidePopover();
    const refs = review.refs;
    const isReplace = kind === 'replace';
    review.inline = {
      kind: kind,
      anchor: anchorInfo.anchor,
      anchorInfo: anchorInfo,
      target: anchorInfo.target || null,
      idempotencyKey: reviewIdempotencyKey(),
    };
    refs.inlineKicker.textContent =
      kind === 'replace' ? 'Suggest replacement' : kind === 'remove' ? 'Suggest removal' : 'New comment';
    refs.inlineQuote.textContent = reviewClip(anchorInfo.anchor.exact, 180);
    refs.inlineQuote.title = anchorInfo.anchor.exact || '';
    const identity =
      review.permissions && review.permissions.identity && review.permissions.identity.name;
    refs.inlineName.hidden = !!identity;
    refs.inlineName.value = identity || refs.inlineName.value || reviewStoredName();
    refs.inlineBody.value = '';
    refs.inlineReplacement.value = isReplace ? anchorInfo.anchor.exact : '';
    refs.inlineReplacement.hidden = !isReplace;
    reviewShowInlineError('');
    refs.inlineSubmit.disabled = false;
    refs.inlineSubmit.removeAttribute('aria-busy');
    refs.inlineSubmit.textContent = isReplace
      ? 'Suggest replacement'
      : kind === 'remove'
        ? 'Suggest removal'
        : 'Add comment';
    refs.inline.hidden = false;
    refs.inline.classList.remove('is-open');
    reviewPositionInline();
    requestAnimationFrame(function () {
      if (!review || !review.inline) return;
      refs.inline.classList.add('is-open');
      refs.inlineBody.focus();
    });
  }

  function reviewHideInline() {
    if (!review || !review.refs || !review.refs.inline) return;
    const refs = review.refs;
    // Keep the toolbar suppressed for the passage that was just dismissed until the user
    // makes a new selection (mouseup/keyup clears composedAnchor).
    if (review.inline) review.composedAnchor = review.inline.anchor;
    review.inline = null;
    if (refs.inline.hidden) return;
    refs.inline.classList.remove('is-open');
    clearTimeout(review.inlineTimer);
    review.inlineTimer = setTimeout(function () {
      if (review && !review.refs.inline.classList.contains('is-open')) {
        review.refs.inline.hidden = true;
      }
    }, 140);
  }

  function reviewSubmitInline(event) {
    event.preventDefault();
    if (!review || !review.inline || review.submitting) return;
    const refs = review.refs;
    const inline = review.inline;
    const body = refs.inlineBody.value.trim();
    const kind = inline.kind;
    const replacement = kind === 'replace' ? refs.inlineReplacement.value.trim() : '';
    if (!body) {
      reviewShowInlineError('Write a comment before submitting.');
      refs.inlineBody.focus();
      return;
    }
    if (kind === 'replace' && !replacement) {
      reviewShowInlineError('The suggested replacement is empty.');
      refs.inlineReplacement.focus();
      return;
    }
    if (!review.viewRevisionId) {
      reviewShowInlineError('This artifact has no published revision yet — feedback starts with the next publish.');
      return;
    }
    if (inline.target && inline.target.frame && !reviewUpdateFrameGuard()) {
      reviewShowInlineError('The embedded page navigated away from the artifact — reload before commenting.');
      return;
    }
    const identity =
      review.permissions && review.permissions.identity && review.permissions.identity.name;
    const authorName = identity || (refs.inlineName.hidden ? reviewStoredName() : refs.inlineName.value.trim());
    reviewRememberName(authorName);
    const payload = reviewThreadPayload(inline, body, replacement, authorName);
    review.submitting = true;
    refs.inlineSubmit.disabled = true;
    refs.inlineSubmit.setAttribute('aria-busy', 'true');
    reviewShowInlineError('');
    reviewAnnounce('Adding feedback…');
    reviewPostThread(payload)
      .then(function () {
        review.submitting = false;
        refs.inlineSubmit.disabled = false;
        refs.inlineSubmit.removeAttribute('aria-busy');
        reviewHideInline();
        showToast('Feedback added');
        reviewAnnounce('Feedback added');
        reviewLoadThreads({ quiet: true });
      })
      .catch(function (error) {
        review.submitting = false;
        refs.inlineSubmit.disabled = false;
        refs.inlineSubmit.removeAttribute('aria-busy');
        reviewShowApiError(error, 'Feedback could not be added.');
        reviewShowInlineError((error && error.message) || 'Feedback could not be added.');
      });
  }

  /* ------------------------------------------------------------ DOM wiring */

  function reviewFindRefs() {
    const panel = document.getElementById('review-panel');
    if (!panel) return null;
    const refs = {
      panel: panel,
      scrim: document.querySelector('[data-review-scrim]'),
      popover: document.querySelector('[data-review-popover]'),
      pill: document.querySelector('[data-review-pill]'),
      pillText: document.querySelector('[data-review-pill-text]'),
      hint: document.querySelector('[data-review-hint]'),
      status: panel.querySelector('[data-review-status]'),
      scopeWrap: panel.querySelector('[data-review-scope-wrap]'),
      scope: panel.querySelector('[data-review-scope]'),
      note: panel.querySelector('[data-review-note]'),
      live: panel.querySelector('[data-review-live]'),
      loading: panel.querySelector('[data-review-loading]'),
      error: panel.querySelector('[data-review-error]'),
      errorText: panel.querySelector('[data-review-error-text]'),
      retry: panel.querySelector('[data-review-retry]'),
      empty: panel.querySelector('[data-review-empty]'),
      emptyText: panel.querySelector('[data-review-empty-text]'),
      documentButton: panel.querySelector('[data-review-document-empty]'),
      documentAction: panel.querySelector('[data-review-document-action]'),
      frameNote: panel.querySelector('[data-review-frame-note]'),
      inline: document.querySelector('[data-review-inline]'),
      inlineKicker: document.querySelector('[data-review-inline-kicker]'),
      inlineQuote: document.querySelector('[data-review-inline-quote]'),
      inlineName: document.querySelector('[data-review-inline-name]'),
      inlineBody: document.querySelector('[data-review-inline-body]'),
      inlineReplacement: document.querySelector('[data-review-inline-replacement]'),
      inlineError: document.querySelector('[data-review-inline-error]'),
      inlineSubmit: document.querySelector('[data-review-inline-submit]'),
      inlineCancel: document.querySelector('[data-review-inline-cancel]'),
      inlineClose: document.querySelector('[data-review-inline-close]'),
      list: panel.querySelector('[data-review-list]'),
      composer: panel.querySelector('[data-review-composer]'),
      composerKicker: panel.querySelector('[data-review-composer-kicker]'),
      composerQuote: panel.querySelector('[data-review-composer-quote]'),
      kind: panel.querySelector('[data-review-kind]'),
      name: panel.querySelector('[data-review-name]'),
      input: panel.querySelector('[data-review-input]'),
      replacement: panel.querySelector('[data-review-replacement]'),
      formError: panel.querySelector('[data-review-form-error]'),
      submit: panel.querySelector('[data-review-submit]'),
      cancel: panel.querySelector('[data-review-cancel]'),
      foot: panel.querySelector('[data-review-foot]'),
      versionsModal: document.querySelector('[data-versions-modal]'),
      versionsList: document.querySelector('[data-versions-list]'),
      versionsLoading: document.querySelector('[data-versions-loading]'),
      versionsError: document.querySelector('[data-versions-error]'),
      versionsEmpty: document.querySelector('[data-versions-empty]'),
    };
    return refs;
  }

  function reviewReadContext(panel) {
    const params = new URLSearchParams(window.location.search);
    const project = panel.getAttribute('data-review-project') || '';
    const file = panel.getAttribute('data-review-file') || '';
    const route = panel.getAttribute('data-review-route') || '';
    const revisionId = panel.getAttribute('data-review-revision') || '';
    const pinned = params.get('rev') || '';
    const serverLatest = panel.getAttribute('data-review-is-latest');
    return {
      project: project,
      file: file,
      route: route,
      artifactId: panel.getAttribute('data-review-artifact') || '',
      title: panel.getAttribute('data-review-title') || '',
      viewRevisionId: pinned || revisionId || '',
      serverRevisionIsLatest: serverLatest === '' ? null : serverLatest !== 'false',
      revisionNumber: Number(panel.getAttribute('data-review-revision-number')) || 0,
    };
  }

  function reviewBindEvents() {
    const refs = review.refs;
    document.querySelectorAll('[data-review-toggle]').forEach(function (button) {
      button.addEventListener('click', function (event) {
        event.preventDefault();
        if (review.open) reviewClosePanel({ restoreFocus: true });
        else reviewOpenPanel({ focus: true });
      });
    });
    const closeButton = refs.panel.querySelector('[data-review-close]');
    if (closeButton) closeButton.addEventListener('click', function () {
      reviewClosePanel({ restoreFocus: true });
    });
    const backButton = refs.panel.querySelector('[data-review-back]');
    if (backButton) backButton.addEventListener('click', function () {
      reviewBackToSelection();
    });
    if (refs.scrim) refs.scrim.addEventListener('click', function () {
      reviewClosePanel({ restoreFocus: true });
    });
    refs.status.addEventListener('click', function (event) {
      const button = event.target.closest('[data-review-filter]');
      if (!button) return;
      review.statusFilter = button.getAttribute('data-review-filter') || 'open';
      reviewSyncFeedbackUrl();
      reviewRenderThreads();
      reviewUpdateFilters();
      reviewUpdateFooter();
    });
    if (refs.scope) {
      refs.scope.addEventListener('change', function () {
        review.allRevisions = !!refs.scope.checked;
        reviewSyncFeedbackUrl();
        reviewLoadThreads({ quiet: review.threads.length > 0 });
      });
    }
    refs.retry.addEventListener('click', function () {
      reviewLoadThreads({});
      reviewLoadRevisions({});
    });
    refs.list.addEventListener('click', reviewListClick);
    if (refs.popover) {
      refs.popover.addEventListener('mousedown', function (event) {
        event.preventDefault();
      });
      refs.popover.addEventListener('click', function (event) {
        const button = event.target.closest('[data-review-kind]');
        if (!button || !review || !review.pendingAnchor) return;
        reviewStartInlineComposer(
          button.getAttribute('data-review-kind') || 'comment',
          review.pendingAnchor,
        );
      });
    }
    document.addEventListener('pointerdown', function (event) {
      if (!review) return;
      if (refs.inline && !refs.inline.hidden && !refs.inline.contains(event.target)) {
        reviewHideInline();
      }
      if (refs.popover && !refs.popover.hidden && !refs.popover.contains(event.target)) {
        reviewHidePopover();
      }
    });
    if (refs.composer) {
      refs.composer.addEventListener('submit', reviewSubmitComposer);
      refs.cancel.addEventListener('click', reviewCancelComposer);
      refs.input.addEventListener('keydown', function (event) {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          reviewSubmitComposer(event);
        }
      });
    }
    if (refs.inline) {
      refs.inline.addEventListener('submit', reviewSubmitInline);
      refs.inlineCancel.addEventListener('click', reviewHideInline);
      refs.inlineClose.addEventListener('click', reviewHideInline);
      refs.inlineBody.addEventListener('keydown', function (event) {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          reviewSubmitInline(event);
        }
      });
      refs.inlineName.value = reviewStoredName();
    }
    if (refs.name) refs.name.value = reviewStoredName();
    document.querySelectorAll('[data-review-format]').forEach(function (button) {
      button.addEventListener('click', function () {
        review.exportFormat = button.getAttribute('data-review-format') || 'md';
        document.querySelectorAll('[data-review-format]').forEach(function (other) {
          other.setAttribute('aria-pressed', String(other === button));
        });
      });
    });
    document.querySelectorAll('[data-review-copy]').forEach(function (button) {
      button.addEventListener('click', reviewCopy);
    });
    document.querySelectorAll('[data-review-download]').forEach(function (button) {
      button.addEventListener('click', reviewDownload);
    });
    if (refs.pill) {
      refs.pill.addEventListener('click', function () {
        reviewOpenPanel({ focus: true });
      });
    }
    document.querySelectorAll('[data-review-document-empty], [data-review-document-action]').forEach(function (button) {
      button.addEventListener('click', function () {
        reviewStartComposer('comment', {
          anchor: { version: 1, type: 'document' },
          target: null,
          range: null,
        });
      });
    });
    const versionsItem = document.querySelector('[data-action="versions"]');
    if (versionsItem) {
      versionsItem.addEventListener('click', function (event) {
        event.preventDefault();
        reviewOpenVersions();
      });
    }
    if (refs.versionsModal) {
      refs.versionsModal.addEventListener('click', function (event) {
        if (event.target === refs.versionsModal) reviewCloseVersions();
      });
      const close = refs.versionsModal.querySelector('[data-versions-close]');
      if (close) close.addEventListener('click', reviewCloseVersions);
      refs.versionsList.addEventListener('click', reviewVersionsClick);
    }
    document.addEventListener('keydown', reviewGlobalKeydown);
    window.addEventListener('focus', function () {
      if (review && review.open && document.visibilityState === 'visible') {
        reviewLoadThreads({ quiet: true });
      }
    });
    document.addEventListener('visibilitychange', function () {
      if (review && review.open && document.visibilityState === 'visible') {
        reviewLoadThreads({ quiet: true });
      }
    });
    try {
      review.mq = window.matchMedia('(max-width: 860px)');
      if (review.mq.addEventListener) {
        review.mq.addEventListener('change', function () {
          if (review && review.open) reviewSyncModalState(true);
          else reviewUpdatePill();
        });
      }
    } catch (error) {
      /* ignore */
    }
    const frame = document.querySelector('iframe.viewer-frame');
    if (frame) {
      frame.addEventListener('load', function () {
        if (!review) return;
        reviewDetachTargets();
        review.targets = reviewTargetElements();
        review.targets.forEach(reviewAttachTarget);
        reviewInvalidateIndexes();
        reviewUpdateFrameGuard();
        reviewPaintHighlights();
      });
    }
  }

  function reviewGlobalKeydown(event) {
    if (!review) return;
    const share = document.getElementById('share-modal');
    if (share && !share.hidden) return;
    const versionsOpen = review.refs.versionsModal && !review.refs.versionsModal.hidden;
    if (versionsOpen) {
      reviewVersionsKeydown(event);
      return;
    }
    if (event.key === 'Escape') {
      if (reviewInlineOpen()) {
        event.preventDefault();
        reviewHideInline();
        return;
      }
      if (reviewComposerOpen()) {
        event.preventDefault();
        reviewCancelComposer();
        return;
      }
      if (review.refs.popover && !review.refs.popover.hidden) {
        event.preventDefault();
        reviewHidePopover();
        return;
      }
      if (review.open) {
        event.preventDefault();
        reviewClosePanel({ restoreFocus: true });
        return;
      }
      if (review.pill && !review.pill.hidden) {
        event.preventDefault();
        reviewClosePanel({ restoreFocus: true });
      }
      return;
    }
    if (event.key !== 'Tab' || !review.open || !reviewIsMobile()) return;
    const focusables = Array.prototype.slice
      .call(
        review.refs.panel.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      )
      .filter(function (element) {
        return !element.disabled && !element.hidden && element.getClientRects().length > 0;
      });
    if (!focusables.length) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (!review.refs.panel.contains(active)) {
      event.preventDefault();
      focusEl(first);
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      focusEl(last);
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      focusEl(first);
    }
  }

  function reviewVersionsKeydown(event) {
    if (!review) return;
    const modal = review.refs.versionsModal;
    if (event.key === 'Escape') {
      event.preventDefault();
      reviewCloseVersions();
      return;
    }
    // Roving keyboard navigation over revision rows (DESIGN §4): ArrowUp/Down/Home/End move,
    // Enter activates the focused row (native button behaviour).
    const rows = Array.prototype.slice.call(modal.querySelectorAll('[data-version-open]'));
    if (rows.length && ['ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(event.key) >= 0) {
      event.preventDefault();
      const index = rows.indexOf(document.activeElement);
      let next;
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = rows.length - 1;
      else if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % rows.length;
      else next = index < 0 ? rows.length - 1 : (index - 1 + rows.length) % rows.length;
      focusEl(rows[next]);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = Array.prototype.slice
      .call(modal.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])'))
      .filter(function (element) {
        return !element.disabled && element.getClientRects().length > 0;
      });
    if (!focusables.length) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (!modal.contains(active)) {
      event.preventDefault();
      focusEl(first);
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      focusEl(last);
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      focusEl(first);
    }
  }

  function reviewSyncFeedbackUrl() {
    try {
      const url = new URL(window.location.href);
      if (review.statusFilter && review.statusFilter !== 'open') {
        url.searchParams.set('feedback', review.statusFilter);
      } else {
        url.searchParams.delete('feedback');
      }
      if (review.allRevisions) url.searchParams.set('frev', 'all');
      else url.searchParams.delete('frev');
      window.history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
    } catch (error) {
      /* ignore */
    }
  }

  function initReview() {
    const panel = document.getElementById('review-panel');
    if (!panel) return;
    const refs = reviewFindRefs();
    if (!refs || !refs.scrim) return;
    const context = reviewReadContext(panel);
    const params = new URLSearchParams(window.location.search);
    const requestedStatus = params.get('feedback');
    const requestedScope = params.get('frev');
    review = {
      refs: refs,
      project: context.project,
      file: context.file,
      route: context.route,
      artifactId: context.artifactId,
      title: context.title,
      viewRevisionId: context.viewRevisionId,
      revisionNumber: context.revisionNumber,
      serverRevisionIsLatest: context.serverRevisionIsLatest,
      mode: false,
      open: false,
      available: true,
      readonly: false,
      readonlyReason: '',
      statusFilter: REVIEW_STATUS.indexOf(requestedStatus) >= 0 ? requestedStatus : 'open',
      allRevisions: requestedScope === 'all',
      threads: [],
      threadById: new Map(),
      counts: { open: 0, addressed: 0, resolved: 0 },
      permissions: null,
      revisions: null,
      targets: [],
      anchorRanges: new Map(),
      anchorState: new Map(),
      exportFormat: 'md',
      submitting: false,
      loadingThreads: false,
      threadsDirty: false,
      pendingThread: null,
      pendingAnchor: null,
      composer: null,
      pendingFocusThread: '',
      composedAnchor: null,
      frameExpected: null,
      frameReady: true,
      mutationTimer: 0,
      inline: null,
      pillDismissed: false,
      pollTimer: 0,
      selectionTimer: 0,
      popoverTimer: 0,
      closeTimer: 0,
      scrimTimer: 0,
      versionsTimer: 0,
    };
    review.targets = reviewTargetElements();
    review.targets.forEach(reviewAttachTarget);
    review.frameExpected = reviewFrameExpected();
    reviewBindEvents();
    reviewApplyPinnedRevision();
    const hashMatch = String(window.location.hash || '').match(/^#thread-(.+)$/);
    if (hashMatch) review.pendingFocusThread = hashMatch[1];
    reviewUpdateFilters();
    reviewUpdateBadge();
    reviewUpdateHint();
    reviewUpdatePill();
    if (review.pendingFocusThread) {
      reviewApplyHash();
    } else {
      // Warm the badge/count once; failures hide the action or show a read-only reason.
      reviewLoadThreads({ quiet: true });
      reviewLoadRevisions({});
    }
  }

  function reviewApplyHash() {
    if (!review) return;
    const match = String(window.location.hash || '').match(/^#thread-(.+)$/);
    if (!match) return;
    review.pendingFocusThread = match[1];
    review.statusFilter = 'open';
    reviewOpenPanel({ focus: false });
  }

  /** Expose pure helpers for unit tests. */
  try {
    window.ArtifactsReview = {
      findQuote: reviewFindQuote,
      relativeTime: reviewRelativeTime,
      shortDate: reviewShortDate,
      formatBytes: reviewFormatBytes,
      clip: reviewClip,
      isRevisionId: reviewIsRevisionId,
      STATUS_LABEL: REVIEW_STATUS_LABEL,
      KIND_LABEL: REVIEW_KIND_LABEL,
    };
  } catch (error) {
    /* window unavailable (node test harness without stubs) */
  }

  /* -------------------------------------------------------------------- boot */


  onReady(function boot() {
    safe('toast', initToast);
    safe('tooltip', initTooltip);
    safe('theme', initTheme);
    safe('more menu', initMoreMenu);
    safe('share dialog', initShare);
    safe('clipboard', initCopy);
    safe('category popover', initCatPopover);
    safe('project filters', initProjectControls);
    safe('reader toc', initReaderToc);
    safe('reading progress', initReadProgress);
    safe('code copy', initCodeCopy);
    safe('highlight', highlightCode);
    safe('topbar scroll', initTopbarScroll);
    safe('artifact skin', initArtifactSkin);
    safe('keyboard', initKeyboard);
    safe('skip links', initSkipLinks);
    safe('ghost password', initGhostPassword);
    safe('print fallback', initPrintFallback);
    safe('review', initReview);
  });
})();
