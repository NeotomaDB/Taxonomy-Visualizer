const COMPLETED_KEY = 'neotoma:onboarding:firstTour:v1:completed';
const SKIPPED_KEY = 'neotoma:onboarding:firstTour:v1:skipped';

function canUseLocalStorage() {
  try {
    const testKey = 'neotoma:onboarding:test';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return true;
  } catch (_error) {
    return false;
  }
}

const storageAvailable = typeof window !== 'undefined' && canUseLocalStorage();

function getFlag(key) {
  if (!storageAvailable) return false;
  return window.localStorage.getItem(key) === 'true';
}

function setFlag(key) {
  if (!storageAvailable) return;
  window.localStorage.setItem(key, 'true');
}

function clearFlag(key) {
  if (!storageAvailable) return;
  window.localStorage.removeItem(key);
}

export function shouldAutoStartFirstTour() {
  return !getFlag(COMPLETED_KEY) && !getFlag(SKIPPED_KEY);
}

export function markFirstTourCompleted() {
  setFlag(COMPLETED_KEY);
  clearFlag(SKIPPED_KEY);
}

export function markFirstTourSkipped() {
  setFlag(SKIPPED_KEY);
}

export function resetFirstTourState() {
  clearFlag(COMPLETED_KEY);
  clearFlag(SKIPPED_KEY);
}
