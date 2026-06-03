/**
 * Parses the current URL hash into a key-value state object.
 * Example hash: #group=VPL&mode=focus&focus=12345
 */
export function getURLState() {
  const hash = window.location.hash.substring(1); // remove the '#'
  const params = new URLSearchParams(hash);
  
  return {
    group: params.get('group'),
    type: params.get('type'),
    mode: params.get('mode'),
    view: params.get('view'),
    rot: params.get('rot'),
    focus: params.get('focus'),
    q: params.get('q')
  };
}

let debounceTimeoutId;

/**
 * Incrementally updates the URL hash with new parameters without reloading the page.
 * @param {Object} newParams - Key-value pairs of state to update (e.g., { focus: 21980 })
 * Passing null or undefined for a key will remove it from the URL.
 */
export function updateURLState(newParams) {
  const currentParams = getURLState();
  const merged = { ...currentParams, ...newParams };
  
  const params = new URLSearchParams();
  for (const key in merged) {
    const value = merged[key];
    // Keep the key if it has a valid value, otherwise drop it to keep URL clean
    if (value !== null && value !== undefined && value !== '') {
      params.set(key, value);
    }
  }

  const newHash = params.toString();

  // We debounce the update by 100ms. 
  // This is crucial for UI controls like the rotation slider, 
  // preventing it from triggering thousands of replaceState calls per second and crashing the browser.
  clearTimeout(debounceTimeoutId);
  debounceTimeoutId = setTimeout(() => {
    // Only update if the hash actually changed
    if (window.location.hash !== `#${newHash}`) {
      // replaceState updates the URL without adding a new entry to the browser's "Back" history
      window.history.replaceState(null, '', newHash ? `#${newHash}` : window.location.pathname);
    }
  }, 100);
}
