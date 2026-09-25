// Deploy identity for parallel GitHub Pages previews (see
// .github/features/preview-deployments.md). Main → id ''; a branch preview served
// at /…/preview/<slug>/ → id '<slug>'. Main keeps all legacy key/cache names.

export function getDeployId(pathname = '') {
  const m = /\/preview\/([a-z0-9-]+)(\/|$)/.exec(pathname);
  return m ? m[1] : '';
}

export function slugifyBranch(branch) {
  return String(branch).toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

export function nsPrefix(id) {
  return id ? `preview-${id}:` : '';
}

export function getCacheName(version, id) {
  return id ? `mexicano-${id}-v${version}` : `mexicano-v${version}`;
}

export function isOwnCache(name, id) {
  const re = id ? new RegExp(`^mexicano-${id}-v\\d+$`) : /^mexicano-v\d+$/;
  return re.test(name);
}

export function currentDeployId() {
  try { return getDeployId(self.location.pathname); } catch { return ''; }
}

// Patch Storage.prototype so localStorage/sessionStorage keys are transparently
// prefixed. Instance-level overrides are impossible (Storage named-property
// setter would store them as items), hence the prototype patch.
export function installStorageNamespace(proto, id) {
  const prefix = nsPrefix(id);
  if (!prefix) return () => {};
  const orig = {
    getItem: proto.getItem,
    setItem: proto.setItem,
    removeItem: proto.removeItem,
    key: proto.key,
    clear: proto.clear,
    length: Object.getOwnPropertyDescriptor(proto, 'length'),
  };
  const ownKeys = (store) => {
    const out = [];
    const n = orig.length.get.call(store);
    for (let i = 0; i < n; i++) {
      const k = orig.key.call(store, i);
      if (k && k.startsWith(prefix)) out.push(k);
    }
    return out;
  };
  proto.getItem = function (k) { return orig.getItem.call(this, prefix + k); };
  proto.setItem = function (k, v) { return orig.setItem.call(this, prefix + k, v); };
  proto.removeItem = function (k) { return orig.removeItem.call(this, prefix + k); };
  proto.key = function (i) {
    const k = ownKeys(this)[i];
    return k === undefined ? null : k.slice(prefix.length);
  };
  proto.clear = function () { ownKeys(this).forEach(k => orig.removeItem.call(this, k)); };
  Object.defineProperty(proto, 'length', {
    configurable: true,
    enumerable: orig.length.enumerable,
    get() { return ownKeys(this).length; },
  });
  return () => {
    proto.getItem = orig.getItem;
    proto.setItem = orig.setItem;
    proto.removeItem = orig.removeItem;
    proto.key = orig.key;
    proto.clear = orig.clear;
    Object.defineProperty(proto, 'length', orig.length);
  };
}
