// ─── Nav dropdown — toggle mobile (click/tap) ─────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  var btn  = document.getElementById('nav-user-btn');
  var menu = btn && btn.closest('.nav-user-menu');
  if (!btn || !menu) return;

  btn.addEventListener('click', function (e) {
    var open = menu.classList.toggle('open');
    btn.setAttribute('aria-expanded', open);
    e.stopPropagation();
  });

  document.addEventListener('click', function () {
    menu.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
  });
});

// ─── Service Worker ───────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js');
  });
}

// ─── Thème dark/light/auto ────────────────────────────────────────────────
(function () {
  var KEY = 'sc-theme';
  var ICONS = { auto: '🌗', dark: '🌙', light: '☀️' };
  var TITLES = { auto: 'Thème auto (système)', dark: 'Thème sombre', light: 'Thème clair' };
  var CYCLE = { auto: 'dark', dark: 'light', light: 'auto' };

  function applyTheme(theme) {
    document.documentElement.classList.remove('dark', 'light');
    if (theme === 'dark') document.documentElement.classList.add('dark');
    if (theme === 'light') document.documentElement.classList.add('light');
  }

  function updateBtn(theme) {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.textContent = ICONS[theme] || ICONS.auto;
    btn.title = TITLES[theme] || TITLES.auto;
    btn.setAttribute('aria-label', TITLES[theme] || TITLES.auto);
  }

  function cycle() {
    var current = localStorage.getItem(KEY) || 'auto';
    var next = CYCLE[current] || 'auto';
    if (next === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
    applyTheme(next);
    updateBtn(next);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var saved = localStorage.getItem(KEY) || 'auto';
    updateBtn(saved);
    var btn = document.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', cycle);
  });
}());
