/**
 * Tests for the refresh-token queueing behavior in api.js.
 *
 * Covers:
 *   - Two concurrent 401s share a single /auth/token/refresh/ call.
 *   - Refresh failure clears auth and redirects to /login.
 *   - Non-401 errors do NOT trigger a refresh.
 *   - The refresh endpoint itself does not recurse on 401.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import axios from 'axios';

vi.mock('axios', async () => {
  // Mock both the bare axios.post (used for /auth/token/refresh/) and
  // axios.create (used to build the `api` instance). The created
  // instance is a real-ish object with interceptors so the module under
  // test can attach its handlers.
  const interceptors = {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  };
  const instance = vi.fn();          // calling api(config) → mocked
  instance.interceptors = interceptors;
  instance.defaults = { headers: { common: {} } };
  instance.get = vi.fn();
  instance.post = vi.fn();
  instance.patch = vi.fn();

  const mock = {
    create: vi.fn(() => instance),
    post: vi.fn(),
    __instance: instance,
  };
  return { default: mock, ...mock };
});

// Stub window.location so redirects don't blow up jsdom.
const originalLocation = window.location;
beforeEach(() => {
  delete window.location;
  window.location = { href: '' };
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  window.location = originalLocation;
});

async function loadApi() {
  vi.resetModules();
  const mod = await import('./api.js');
  return mod;
}

function getResponseErrorHandler() {
  // The api module calls instance.interceptors.response.use(success, error).
  // The mocked .use captured both args; pull the error handler.
  const instance = axios.__instance;
  const call = instance.interceptors.response.use.mock.calls[0];
  return { onSuccess: call[0], onError: call[1] };
}

describe('api.js refresh token queueing', () => {
  it('shares a single in-flight refresh across two concurrent 401s', async () => {
    localStorage.setItem('access_token', 'old-access');
    localStorage.setItem('refresh_token', 'old-refresh');

    await loadApi();
    const { onError } = getResponseErrorHandler();
    const instance = axios.__instance;

    // axios.post (bare) returns the refreshed token. Add a tiny delay
    // so both 401s arrive while the refresh is still pending.
    let resolveRefresh;
    axios.post.mockReturnValue(
      new Promise(res => {
        resolveRefresh = () => res({ data: { access: 'new-access', refresh: 'new-refresh' } });
      })
    );

    // The replayed request (api(original)) resolves with a successful response.
    instance.mockResolvedValue({ data: { ok: true } });

    const err1 = {
      response: { status: 401, data: {} },
      config: { url: '/foo', headers: {} },
    };
    const err2 = {
      response: { status: 401, data: {} },
      config: { url: '/bar', headers: {} },
    };

    const p1 = onError(err1);
    const p2 = onError(err2);

    // Both 401s should now be awaiting the same refresh promise.
    expect(axios.post).toHaveBeenCalledTimes(1);

    resolveRefresh();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toEqual({ data: { ok: true } });
    expect(r2).toEqual({ data: { ok: true } });
    expect(axios.post).toHaveBeenCalledTimes(1); // still only one refresh call
    expect(localStorage.getItem('access_token')).toBe('new-access');
    expect(localStorage.getItem('refresh_token')).toBe('new-refresh');

    // Both replays carry the new token.
    const replays = instance.mock.calls;
    expect(replays).toHaveLength(2);
    expect(replays[0][0].headers.Authorization).toBe('Bearer new-access');
    expect(replays[1][0].headers.Authorization).toBe('Bearer new-access');
  });

  it('clears auth and redirects to /login when refresh fails', async () => {
    localStorage.setItem('access_token', 'old-access');
    localStorage.setItem('refresh_token', 'bad-refresh');
    localStorage.setItem('db_user', '{"id":1}');

    await loadApi();
    const { onError } = getResponseErrorHandler();

    axios.post.mockRejectedValue({ response: { status: 401 } });

    const err = {
      response: { status: 401, data: {} },
      config: { url: '/foo', headers: {} },
    };

    // The handler swallows the failed refresh, clears auth, redirects,
    // and then falls through to reject with the original error.
    await expect(onError(err)).rejects.toBeDefined();
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(localStorage.getItem('db_user')).toBeNull();
    expect(window.location.href).toBe('/login');
  });

  it('cascading 401s after a failed refresh do not pile on more refresh calls', async () => {
    localStorage.setItem('access_token', 'old-access');
    localStorage.setItem('refresh_token', 'bad-refresh');

    await loadApi();
    const { onError } = getResponseErrorHandler();

    axios.post.mockRejectedValue({ response: { status: 401 } });

    const mkErr = url => ({
      response: { status: 401, data: {} },
      config: { url, headers: {} },
    });

    const p1 = onError(mkErr('/foo'));
    const p2 = onError(mkErr('/bar'));
    await Promise.allSettled([p1, p2]);

    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('does not trigger refresh on non-401 errors', async () => {
    localStorage.setItem('access_token', 'a');
    localStorage.setItem('refresh_token', 'r');

    await loadApi();
    const { onError } = getResponseErrorHandler();

    const err = {
      response: { status: 500, data: {} },
      config: { url: '/foo', headers: {} },
    };

    await expect(onError(err)).rejects.toBe(err);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('does not recurse when the 401 came from the refresh endpoint itself', async () => {
    localStorage.setItem('access_token', 'a');
    localStorage.setItem('refresh_token', 'r');

    await loadApi();
    const { onError } = getResponseErrorHandler();

    const err = {
      response: { status: 401, data: {} },
      config: { url: '/auth/token/refresh/', headers: {} },
    };

    await expect(onError(err)).rejects.toBe(err);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('does not refresh if no refresh_token is present', async () => {
    localStorage.setItem('access_token', 'a');
    // no refresh_token

    await loadApi();
    const { onError } = getResponseErrorHandler();

    const err = {
      response: { status: 401, data: {} },
      config: { url: '/foo', headers: {} },
    };

    await expect(onError(err)).rejects.toBe(err);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('clears refreshTokenPromise after settle so subsequent expiries can refresh again', async () => {
    localStorage.setItem('access_token', 'a');
    localStorage.setItem('refresh_token', 'r');

    await loadApi();
    const { onError } = getResponseErrorHandler();
    const instance = axios.__instance;

    axios.post
      .mockResolvedValueOnce({ data: { access: 'access-1', refresh: 'refresh-1' } })
      .mockResolvedValueOnce({ data: { access: 'access-2', refresh: 'refresh-2' } });
    instance.mockResolvedValue({ data: { ok: true } });

    await onError({
      response: { status: 401, data: {} },
      config: { url: '/foo', headers: {} },
    });
    await onError({
      response: { status: 401, data: {} },
      config: { url: '/bar', headers: {} },
    });

    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('access_token')).toBe('access-2');
  });
});
