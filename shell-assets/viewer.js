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
      if (programmaticFocus) return;
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
      var background = parseColor(bodyStyle.backgroundColor);
      if (!background || background.a === 0) background = parseColor(htmlStyle.backgroundColor);
      if (!background || background.a === 0) return;
      background = composite(background, white);
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
  });
})();
