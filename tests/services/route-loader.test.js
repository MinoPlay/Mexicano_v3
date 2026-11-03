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

  it('calls onLoaded after every successful pull, even with nothing new', async () => {
    const onLoaded = vi.fn();
    const load = createRouteLoader({
      pull: vi.fn().mockResolvedValue(false), render: vi.fn(), currentHash: () => '#/', onLoaded,
    });

    await load('#/');

    expect(onLoaded).toHaveBeenCalledTimes(1);
  });

  it('does not call onLoaded when the pull fails', async () => {
    const onLoaded = vi.fn();
    const load = createRouteLoader({
      pull: vi.fn().mockRejectedValue(new Error('offline')), render: vi.fn(), currentHash: () => '#/', onLoaded,
    });

    await load('#/');

    expect(onLoaded).not.toHaveBeenCalled();
  });

  it('signals loading while the pull is pending and clears it after render', async () => {
    const gate = deferred();
    const events = [];
    const load = createRouteLoader({
      pull: () => gate.promise,
      render: () => events.push('render'),
      currentHash: () => '#/',
      onLoadingChange: (v) => events.push(v),
    });

    const pending = load('#/');
    expect(events).toEqual([true]);
    gate.resolve(true);
    await pending;

    expect(events).toEqual([true, 'render', false]);
  });

  it('clears loading on failure', async () => {
    const onLoadingChange = vi.fn();
    const load = createRouteLoader({ pull: vi.fn().mockRejectedValue(new Error('x')), render: vi.fn(), currentHash: () => '#/', onLoadingChange });

    await load('#/');

    expect(onLoadingChange.mock.calls).toEqual([[true], [false]]);
  });

  it('stays loading until all overlapping loads finish', async () => {
    const a = deferred();
    const b = deferred();
    const gates = [a, b];
    const onLoadingChange = vi.fn();
    const load = createRouteLoader({ pull: () => gates.shift().promise, render: vi.fn(), currentHash: () => '#/', onLoadingChange });

    const p1 = load('#/');
    const p2 = load('#/');
    a.resolve(false);
    await p1;
    expect(onLoadingChange.mock.calls).toEqual([[true]]);
    b.resolve(false);
    await p2;
    expect(onLoadingChange.mock.calls).toEqual([[true], [false]]);
  });
});
