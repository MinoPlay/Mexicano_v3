// Side-effect module: in a /preview/<slug>/ deploy, namespace localStorage and
// sessionStorage so previews never share state with main. No-op on main.
import { currentDeployId, installStorageNamespace } from './deploy-env.js';

if (typeof Storage !== 'undefined') installStorageNamespace(Storage.prototype, currentDeployId());
