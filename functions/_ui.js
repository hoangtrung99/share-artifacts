// Shared UI primitives for the shell.
//
// One source of truth for the icon sprite, the pre-paint theme bootstrap and the global
// popovers (theme picker / More menu / toast / tooltip) used by BOTH the Astro shell pages
// and the edge-rendered Function pages. Keep markup and IDs in sync with shell-assets/viewer.js.

export const THEMES = ['coast', 'forest', 'ink', 'paper', 'sepia'];
export const DEFAULT_THEME = 'coast';

const THEME_META = {
  coast: { scheme: 'dark', color: '#0a1119', label: 'Coast' },
  forest: { scheme: 'dark', color: '#0b1410', label: 'Forest' },
  ink: { scheme: 'dark', color: '#12110f', label: 'Ink' },
  paper: { scheme: 'light', color: '#faf8f3', label: 'Paper' },
  sepia: { scheme: 'light', color: '#f5eee0', label: 'Sepia' },
};

export const THEME_BOOTSTRAP = `(function(){try{var ok=${JSON.stringify(THEMES)};var q=new URLSearchParams(location.search).get('theme');var t=q&&ok.indexOf(q)>=0?q:localStorage.getItem('artifacts-theme');if(!t||ok.indexOf(t)<0)t='${DEFAULT_THEME}';var m=${JSON.stringify(
  Object.fromEntries(Object.entries(THEME_META).map(([k, v]) => [k, [v.scheme, v.color]])),
)};var c=m[t]||m['${DEFAULT_THEME}'];document.documentElement.dataset.theme=t;document.documentElement.dataset.scheme=c[0];var e=document.querySelector('meta[name="theme-color"]');if(e)e.setAttribute('content',c[1]);}catch(e){document.documentElement.dataset.theme='${DEFAULT_THEME}';document.documentElement.dataset.scheme='dark';}})();`;

const SPRITE = `<symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></symbol>
<symbol id="i-arrow-left" viewBox="0 0 24 24"><path d="M19 12H5"/><path d="m11 18-6-6 6-6"/></symbol>
<symbol id="i-arrow-right" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></symbol>
<symbol id="i-chevron-right" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></symbol>
<symbol id="i-chevron-down" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol>
<symbol id="i-chevrons-down" viewBox="0 0 24 24"><path d="m6 5 6 6 6-6"/><path d="m6 13 6 6 6-6"/></symbol>
<symbol id="i-chevrons-up" viewBox="0 0 24 24"><path d="m6 11 6-6 6 6"/><path d="m6 19 6-6 6 6"/></symbol>
<symbol id="i-comment" viewBox="0 0 24 24"><path d="M20 14.5a2 2 0 0 1-2 2H8.5L4 20V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z"/></symbol>
<symbol id="i-history" viewBox="0 0 24 24"><path d="M3.2 12a8.8 8.8 0 1 0 2.7-6.2"/><path d="M3 4.5v4.7h4.7"/><path d="M12 8v4.2l2.8 1.7"/></symbol>
<symbol id="i-download" viewBox="0 0 24 24"><path d="M12 4v10"/><path d="m8 10 4 4 4-4"/><path d="M5 18h14"/></symbol>
<symbol id="i-link" viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 7"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1.5-1.5"/></symbol>
<symbol id="i-external" viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></symbol>
<symbol id="i-printer" viewBox="0 0 24 24"><path d="M7 8V4h10v4"/><path d="M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2"/><path d="M7 14h10v6H7z"/></symbol>
<symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></symbol>
<symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/></symbol>
<symbol id="i-eye-off" viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M10.6 6.1A9.9 9.9 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.1 3.8"/><path d="M6.3 7.3A17.3 17.3 0 0 0 2 12s3.5 6 10 6a9.7 9.7 0 0 0 4-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></symbol>
<symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></symbol>
<symbol id="i-more" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-contrast" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-moon" viewBox="0 0 24 24"><path d="M20 13.2A8.2 8.2 0 0 1 10.8 4a8.2 8.2 0 1 0 9.2 9.2Z"/></symbol>
<symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></symbol>
<symbol id="i-close" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></symbol>
<symbol id="i-share" viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/></symbol>
<symbol id="i-logout" viewBox="0 0 24 24"><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="m15 8 4 4-4 4"/><path d="M19 12H9"/></symbol>
<symbol id="i-ghost" viewBox="0 0 24 24"><path d="M5 20V10a7 7 0 0 1 14 0v10l-2.3-1.6L14.4 20l-2.4-1.6L9.6 20l-2.3-1.6Z"/><path d="M9.5 10.5h.01M14.5 10.5h.01"/></symbol>
<symbol id="i-alert" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16.5h.01"/></symbol>
<symbol id="i-inbox" viewBox="0 0 24 24"><path d="M4 13h4l1.5 2.5h5L16 13h4"/><path d="M5 5h14l1 8v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5Z"/></symbol>`;

export const ICON_SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  ${SPRITE}
</svg>`;

/** Inline SVG icon referencing the shared sprite. */
export function icon(name, className = 'icon') {
  return `<svg class="${className}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

export function themePickerButton() {
  return `<button class="icon-btn" type="button" data-theme-picker data-tip="Theme" aria-label="Choose theme" aria-haspopup="listbox" aria-expanded="false">${icon('contrast')}</button>`;
}

/** Global chrome shared by every shell page (theme picker, More menu, toast, tooltip). */
export function shellChrome() {
  const option = (value, label) =>
    `<button class="theme-option" type="button" role="option" data-theme-value="${value}" aria-selected="${
      value === DEFAULT_THEME ? 'true' : 'false'
    }">
    <span class="swatch" aria-hidden="true"></span><span>${label}</span>
    <svg class="icon theme-check" aria-hidden="true"><use href="#i-check"/></svg>
  </button>`;
  return `<div class="theme-popover" id="theme-popover" role="listbox" aria-label="Theme" hidden>
  <p class="micro theme-popover-title">Theme</p>
  ${THEMES.map((t) => option(t, THEME_META[t].label)).join('\n  ')}
</div>

<div class="more-popover" id="more-popover" role="menu" aria-label="More actions" hidden>
  <button class="more-item" type="button" role="menuitem" data-action="versions" hidden><svg class="icon" aria-hidden="true"><use href="#i-history"/></svg><span>Versions</span></button>
  <button class="more-item" type="button" role="menuitem" data-action="copy"><svg class="icon" aria-hidden="true"><use href="#i-link"/></svg><span>Copy link</span></button>
  <button class="more-item" type="button" role="menuitem" data-action="raw"><svg class="icon" aria-hidden="true"><use href="#i-external"/></svg><span>Open raw file</span></button>
  <button class="more-item" type="button" role="menuitem" data-action="print"><svg class="icon" aria-hidden="true"><use href="#i-printer"/></svg><span>Print / save PDF</span></button>
  <button class="more-item" type="button" role="menuitem" data-action="theme"><svg class="icon" aria-hidden="true"><use href="#i-contrast"/></svg><span>Theme…</span></button>
  <button class="more-item" type="button" role="menuitem" data-action="signout"><svg class="icon" aria-hidden="true"><use href="#i-logout"/></svg><span>Sign out</span></button>
</div>

<div class="toast" id="toast" role="status" aria-live="polite"><svg class="icon" aria-hidden="true"><use href="#i-check"/></svg><span id="toast-text"></span></div>
<div class="tip" id="tip" role="tooltip" hidden></div>`;
}
