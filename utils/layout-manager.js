// Compatibility shim for legacy references to utils/layout-manager.js.
// Loads the active layout manager implementation from js/utils/layout-manager.js.
(() => {
  const activeScriptPath = 'js/utils/layout-manager.js';
  const hasActiveScript = Array.from(document.scripts).some((script) => {
    const src = script.getAttribute('src') || '';
    return src.endsWith(activeScriptPath) || src.endsWith(`./${activeScriptPath}`);
  });

  if (hasActiveScript) {
    return;
  }

  const script = document.createElement('script');
  script.src = activeScriptPath;
  script.defer = true;
  document.head.appendChild(script);
})();
