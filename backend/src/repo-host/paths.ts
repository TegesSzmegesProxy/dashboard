const HTTP_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

/** A verb token as written in code, or null when it means "any method". */
export function normalizeMethod(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const upper = raw
    .toUpperCase()
    .replace(/MAPPING$/, '')
    .replace(/^HTTP/, '');
  return HTTP_METHODS.has(upper) ? upper : null;
}

/**
 * Converts framework path syntax to the policy's `:param` form:
 * `{id}`, `{id:int}`, `<id>`, `<int:id>`, `[id]`, `:id(\d+)`, `(?P<id>...)`.
 * Returns null for values that are not plausible request paths.
 */
export function normalizeRoutePath(raw: string): string | null {
  let path = raw.trim().replace(/^['"`]|['"`]$/g, '');
  if (path.length === 0 || path.length > 1024) return null;
  path = path.split(/[?#]/)[0];
  path = path
    .replace(/^\^/, '')
    .replace(/\$$/, '')
    .replace(/\(\?P<(\w+)>[^)]*\)/g, ':$1')
    .replace(/\{(\w+)(?::[^}]*)?\}/g, ':$1')
    .replace(/<(?:\w+:)?(\w+)>/g, ':$1')
    .replace(/\[\.{3}(\w+)\]/g, ':$1')
    .replace(/\[(\w+)\]/g, ':$1')
    .replace(/:(\w+)\([^)]*\)/g, ':$1')
    .replace(/\*\*?/g, '*');
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\/{2,}/g, '/');
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  if (/\s/.test(path) || /[<>"'`\\]/.test(path)) return null;
  return path;
}

export function joinRoutePaths(prefix: string, path: string): string | null {
  if (!prefix || prefix === '/') return normalizeRoutePath(path);
  return normalizeRoutePath(`${prefix}/${path}`);
}

export function candidateKey(method: string | null, path: string): string {
  return `${method ?? '*'} ${path}`;
}

/** Minimal glob: `*` (no slash), `**` (any depth), `?`; no braces. */
export function globToRegExp(glob: string): RegExp {
  let pattern = '';
  for (let index = 0; index < glob.length; index++) {
    const character = glob[index];
    if (character === '*') {
      if (glob[index + 1] === '*') {
        pattern += '.*';
        index++;
        if (glob[index + 1] === '/') index++;
      } else {
        pattern += '[^/]*';
      }
    } else if (character === '?') {
      pattern += '[^/]';
    } else {
      pattern += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${pattern}$`);
}
