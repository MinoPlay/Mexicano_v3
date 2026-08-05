/**
 * PAT-in-URL Bootstrap — pure helpers.
 * Parse a PAT carried in a shareable link and build such links.
 * See .github/features/pat-url-bootstrap.md
 */

/** Strip `pat` from a hash-query string like `/?pat=x&foo=1`; return cleaned hash body. */
function stripPatFromHashBody(body) {
  const qi = body.indexOf('?');
  if (qi === -1) return body;
  const path = body.slice(0, qi);
  const params = new URLSearchParams(body.slice(qi + 1));
  params.delete('pat');
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}

/**
 * Read `pat` from a URL (search query first, then hash query) and return a
 * cleaned URL with the `pat` param removed.
 * @param {string} href
 * @returns {{ pat: string|null, cleanUrl: string }}
 */
export function parsePatFromUrl(href) {
  const url = new URL(href);

  let pat = url.searchParams.get('pat');
  if (pat && pat.trim()) {
    url.searchParams.delete('pat');
    return { pat: pat.trim(), cleanUrl: url.href };
  }

  // Hash query form: #/...?pat=...
  const hash = url.hash; // includes leading '#'
  if (hash) {
    const body = hash.slice(1);
    const qi = body.indexOf('?');
    if (qi !== -1) {
      const hp = new URLSearchParams(body.slice(qi + 1)).get('pat');
      if (hp && hp.trim()) {
        url.hash = `#${stripPatFromHashBody(body)}`;
        return { pat: hp.trim(), cleanUrl: url.href };
      }
    }
  }

  return { pat: null, cleanUrl: href };
}

/**
 * Build a shareable URL that carries the PAT in the search part.
 * @param {string} baseUrl
 * @param {string} pat
 * @returns {string}
 */
export function buildPatUrl(baseUrl, pat) {
  const url = new URL(baseUrl);
  url.searchParams.set('pat', pat);
  return url.href;
}
