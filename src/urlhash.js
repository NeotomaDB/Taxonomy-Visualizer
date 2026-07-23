/**
 * Parses the current URL hash into a key-value state object.
 * Example hash: #group=VPL&root=9534&mode=focus&focus=12345
 */
export function getURLState() {
  const hash = window.location.hash.substring(1); // remove the '#'
  const params = new URLSearchParams(hash);
  
  return {
    group: params.get('group'),
    root: params.get('root'),
    type: params.get('type'),
    mode: params.get('mode'),
    view: params.get('view'),
    rot: params.get('rot'),
    focus: params.get('focus'),
    q: params.get('q')
  };
}

let debounceTimeoutId;
let pendingState = null;

const HISTORY_STATE_KEY = 'taxonomyVisualizer';

function mergeURLState(currentState, newParams) {
  return { ...currentState, ...newParams };
}

function serializeURLState(state) {
  const params = new URLSearchParams();
  for (const key in state) {
    const value = state[key];
    if (value !== null && value !== undefined && value !== '') {
      params.set(key, value);
    }
  }
  return params.toString();
}

function buildURL(state) {
  const hash = serializeURLState(state);
  return hash ? `#${hash}` : window.location.pathname;
}

function isCurrentURL(state) {
  const hash = serializeURLState(state);
  return window.location.hash === (hash ? `#${hash}` : '');
}

function withNavigationState(navigationState = {}) {
  const rawHistoryState = window.history.state;
  const currentHistoryState = rawHistoryState && typeof rawHistoryState === 'object'
    ? rawHistoryState
    : {};
  return {
    ...currentHistoryState,
    [HISTORY_STATE_KEY]: {
      ...(currentHistoryState[HISTORY_STATE_KEY] || {}),
      ...navigationState,
    },
  };
}

function replacePendingState() {
  if (!pendingState) return;
  const state = pendingState;
  pendingState = null;
  clearTimeout(debounceTimeoutId);
  debounceTimeoutId = undefined;

  const url = buildURL(state);
  if (!isCurrentURL(state)) {
    window.history.replaceState(withNavigationState(), '', url);
  }
}

/**
 * Incrementally updates the URL hash with new parameters without reloading the page.
 * @param {Object} newParams - Key-value pairs of state to update (e.g., { focus: 21980 })
 * Passing null or undefined for a key will remove it from the URL.
 */
export function updateURLState(newParams) {
  pendingState = mergeURLState(pendingState || getURLState(), newParams);

  // We debounce the update by 100ms. 
  // This is crucial for UI controls like the rotation slider, 
  // preventing it from triggering thousands of replaceState calls per second and crashing the browser.
  clearTimeout(debounceTimeoutId);
  debounceTimeoutId = setTimeout(() => {
    replacePendingState();
  }, 100);
}

/**
 * Creates a browser Back/Forward checkpoint.
 *
 * Any pending fine-grained state is first committed to the current entry, so
 * the previous screen keeps its latest search, focus, rotation, and view mode.
 */
export function pushURLState(newParams, navigationState = {}) {
  replacePendingState();
  const nextState = mergeURLState(getURLState(), newParams);
  const nextURL = buildURL(nextState);

  if (isCurrentURL(nextState)) {
    window.history.replaceState(withNavigationState(navigationState), '', nextURL);
    return;
  }

  window.history.pushState(withNavigationState(navigationState), '', nextURL);
}

/**
 * Marks the document's initial history entry as owned by this application.
 */
export function initializeURLHistory(navigationState = {}) {
  replacePendingState();
  window.history.replaceState(
    withNavigationState(navigationState),
    '',
    `${window.location.pathname}${window.location.hash}`,
  );
}

/**
 * Replaces the current browser entry with the app's clean initial URL and
 * navigation state. This intentionally removes every shareable view setting
 * from the current entry (group, search, focus, rotation, and so on).
 */
export function resetURLHistory(navigationState = {}) {
  replacePendingState();
  const rawHistoryState = window.history.state;
  const currentHistoryState = rawHistoryState && typeof rawHistoryState === 'object'
    ? rawHistoryState
    : {};

  window.history.replaceState(
    {
      ...currentHistoryState,
      [HISTORY_STATE_KEY]: navigationState,
    },
    '',
    window.location.pathname,
  );
}

export function getURLNavigationState(historyState = window.history.state) {
  return historyState?.[HISTORY_STATE_KEY] || null;
}
