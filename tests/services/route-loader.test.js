import { describe, expect, it, vi } from 'vitest';
import { createRouteLoader } from '../../js/services/route-loader.js';

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

describe('route loader', () => {
  it('re-renders once the route data arrives when the route is still current', async () => {
    const pull = vi.fn().mockResolvedValue(true);
    const render = vi.fn();
    let hash = '#/statistics';
    const load = createRouteLoader({ pull, render, currentHash: () => hash });

    await load('#/statistics');

    expect(pull).toHaveBeenCalledWith('#/statistics');
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('does not re-render when nothing new was loaded', async () => {
    const render = vi.fn();
    const load = createRouteLoader({ pull: vi.fn().mockResolvedValue(false), render, currentHash: () => '#/' });

    await load('#/');

    expect(render).not.toHaveBeenCalled();
  });

  it('skips the re-render when the user already navigated elsewhere', async () => {
    const gate = deferred();
    const render = vi.fn();
    let hash = '#/statistics';
    const load = createRouteLoader({ pull: () => gate.promise, render, currentHash: () => hash });

    const pending = load('#/statistics');
    hash = '#/doodle';
    gate.resolve(true);
    await pending;

    expect(render).not.toHaveBeenCalled();
  });

  it('reports failures without throwing', async () => {
    const onError = vi.fn();
    const error = new Error('offline');
    const load = createRouteLoader({ pull: vi.fn().mockRejectedValue(error), render: vi.fn(), currentHash: () => '#/', onError });

    await expect(load('#/')).resolves.toBe(false);
    expect(onError).toHaveBeenCalledWith(error);
  });
});
