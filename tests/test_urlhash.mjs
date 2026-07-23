import test from 'node:test';
import assert from 'node:assert/strict';

function createWindow(initialHash = '') {
  const calls = [];
  const location = {
    pathname: '/index.html',
    hash: initialHash,
  };

  function applyURL(url) {
    const hashIndex = url.indexOf('#');
    location.pathname = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
    location.hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  }

  const history = {
    state: null,
    replaceState(state, _title, url) {
      this.state = state;
      applyURL(url);
      calls.push({ method: 'replace', state, url });
    },
    pushState(state, _title, url) {
      this.state = state;
      applyURL(url);
      calls.push({ method: 'push', state, url });
    },
  };

  return { location, history, calls };
}

const fakeWindow = createWindow('#group=VPL');
globalThis.window = fakeWindow;

const {
  getURLNavigationState,
  getURLState,
  initializeURLHistory,
  pushURLState,
  resetURLHistory,
  updateURLState,
} = await import(`../src/urlhash.js?test=${Date.now()}`);

test('parses shareable tree root state', () => {
  fakeWindow.location.hash = '#group=VPL&root=9534&mode=focus';
  assert.deepEqual(getURLState(), {
    group: 'VPL',
    root: '9534',
    type: null,
    mode: 'focus',
    view: null,
    rot: null,
    focus: null,
    q: null,
  });
});

test('pushes semantic navigation while retaining the previous fine-grained state', () => {
  fakeWindow.calls.length = 0;
  fakeWindow.location.pathname = '/index.html';
  fakeWindow.location.hash = '#group=VPL';
  fakeWindow.history.state = null;

  initializeURLHistory({ treeDepth: 0 });
  updateURLState({ q: 'Pinus' });
  pushURLState({ root: 9534, focus: null }, { treeDepth: 1 });

  assert.equal(fakeWindow.calls.at(-2).method, 'replace');
  assert.equal(fakeWindow.calls.at(-2).url, '#group=VPL&q=Pinus');
  assert.equal(fakeWindow.calls.at(-1).method, 'push');
  assert.equal(fakeWindow.calls.at(-1).url, '#group=VPL&root=9534&q=Pinus');
  assert.deepEqual(getURLNavigationState(), { treeDepth: 1 });
});

test('fine-grained updates replace instead of pushing', async () => {
  fakeWindow.calls.length = 0;
  fakeWindow.location.pathname = '/index.html';
  fakeWindow.location.hash = '#group=VPL&root=9534';

  updateURLState({ rot: 42 });
  await new Promise(resolve => setTimeout(resolve, 120));

  assert.equal(fakeWindow.calls.length, 1);
  assert.equal(fakeWindow.calls[0].method, 'replace');
  assert.equal(fakeWindow.calls[0].url, '#group=VPL&root=9534&rot=42');
});

test('resets the current entry to the initial URL and supplied navigation state', () => {
  fakeWindow.calls.length = 0;
  fakeWindow.location.pathname = '/index.html';
  fakeWindow.location.hash = '#group=VPL&root=9534&q=Pinus';
  fakeWindow.history.state = { unrelatedState: true, taxonomyVisualizer: { treeDepth: 2 } };

  resetURLHistory({ treeDepth: 0, resetEpoch: 'reload-1' });

  assert.equal(fakeWindow.calls.length, 1);
  assert.equal(fakeWindow.calls[0].method, 'replace');
  assert.equal(fakeWindow.calls[0].url, '/index.html');
  assert.deepEqual(fakeWindow.history.state, {
    unrelatedState: true,
    taxonomyVisualizer: { treeDepth: 0, resetEpoch: 'reload-1' },
  });
});
