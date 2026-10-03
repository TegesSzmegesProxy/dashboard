const done = new Set();
export function injectCss(id, css) {
  if (typeof document === 'undefined' || done.has(id)) return;
  done.add(id);
  const el = document.createElement('style');
  el.setAttribute('data-ts', id);
  el.textContent = css;
  document.head.appendChild(el);
}
