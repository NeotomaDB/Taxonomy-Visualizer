import { FIRST_TIME_TOUR_STEPS } from './steps.js';
import {
  markFirstTourCompleted,
  markFirstTourSkipped,
  resetFirstTourState,
  shouldAutoStartFirstTour,
} from './state.js';

const AUTO_START_DELAY_MS = 900;
const CLICK_TAXON_STEP_INDEX = 1;
const TWO_LEVEL_STEP_INDEX = 2;
const SEARCH_STEP_INDEX = 5;
const COMPARE_STEP_INDEX = 6;

let activeTour = null;
let currentStepIndex = -1;
let stepStateTimeoutId = null;

function getDriverFactory() {
  return window.driver?.js?.driver || null;
}

function syncToggle(toggle, expanded, collapseLabel, expandLabel) {
  if (!toggle) return;
  toggle.textContent = expanded ? '-' : '+';
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.setAttribute('aria-label', expanded ? collapseLabel : expandLabel);
  toggle.dataset.tooltip = expanded ? 'Collapse' : 'Expand';
}

function expandTourSurface() {
  const controlBox = document.getElementById('visualizerControlBox');
  const controlToggle = document.getElementById('visualizerControlToggle');
  if (controlBox?.classList.contains('is-collapsed')) {
    controlBox.classList.remove('is-collapsed');
    syncToggle(controlToggle, true, 'Collapse visualizer controls', 'Expand visualizer controls');
  }

  const legend = document.getElementById('color-legend');
  const legendToggle = document.getElementById('legendToggle');
  if (legend?.classList.contains('is-collapsed')) {
    legend.classList.remove('is-collapsed');
    syncToggle(legendToggle, true, 'Collapse legend', 'Expand legend');
  }
}

function openTaxonGroupDropdown() {
  const customSelect = document.querySelector('.custom-select');
  customSelect?.classList.add('open');
  updateTourDropdownPosition();
}

function closeTaxonGroupDropdown() {
  document.querySelector('.custom-select')?.classList.remove('open');
}

function updateTourDropdownPosition() {
  if (!document.body.classList.contains('onboarding-two-level-step')) return;

  const trigger = document.querySelector('.custom-select-trigger');
  const options = document.querySelector('.custom-options');
  if (!trigger || !options) return;

  const rect = trigger.getBoundingClientRect();
  options.style.setProperty('--tour-dropdown-left', `${rect.left}px`);
  options.style.setProperty('--tour-dropdown-top', `${rect.bottom + 6}px`);
  options.style.setProperty('--tour-dropdown-width', `${rect.width}px`);
}

function bindTourDropdownPositioning() {
  window.addEventListener('resize', updateTourDropdownPosition);
  window.addEventListener('scroll', updateTourDropdownPosition, true);
}

function clearPendingStepState() {
  window.clearTimeout(stepStateTimeoutId);
  stepStateTimeoutId = null;
}

function setTaxonType(type) {
  const targetButton = type === 'nonbio'
    ? document.getElementById('nonBioTaxonBtn')
    : document.getElementById('bioTaxonBtn');
  if (targetButton && !targetButton.classList.contains('active')) {
    targetButton.click();
  }
}

function setTaxonGroup(groupValue) {
  const select = document.getElementById('taxagroupSelect');
  if (!select || select.value === groupValue) return;

  select.value = groupValue;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function clearSearchQuery() {
  const searchInput = document.getElementById('searchInput');
  if (!searchInput || !searchInput.value) return;

  searchInput.value = '';
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
}

function runSearchQueryForStep(query, stepIndex, delay = 700) {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.value = query;
  }

  stepStateTimeoutId = window.setTimeout(() => {
    if (currentStepIndex !== stepIndex) return;
    document.getElementById('searchBtn')?.click();
  }, delay);
}

function prepareStepDemoState(activeIndex) {
  clearPendingStepState();

  if (activeIndex === TWO_LEVEL_STEP_INDEX) {
    setTaxonType('bio');
    setTaxonGroup('');
    clearSearchQuery();
    return;
  }

  if (activeIndex === SEARCH_STEP_INDEX) {
    setTaxonType('bio');
    setTaxonGroup('MAM');
    runSearchQueryForStep('bison', SEARCH_STEP_INDEX);
    return;
  }

  if (activeIndex === COMPARE_STEP_INDEX) {
    setTaxonType('bio');
    setTaxonGroup('MAM');
    runSearchQueryForStep('cf. Bison latifrons, cf. Bison alaskensis', COMPARE_STEP_INDEX);
  }
}

function setSecondaryTourHighlight(selector, isActive) {
  document.querySelector(selector)?.classList.toggle('onboarding-secondary-highlight', isActive);
}

function syncStepContext(activeIndex) {
  currentStepIndex = activeIndex;
  prepareStepDemoState(activeIndex);

  document.body.classList.toggle('onboarding-click-taxon-step', activeIndex === CLICK_TAXON_STEP_INDEX);

  const isTwoLevelStep = activeIndex === TWO_LEVEL_STEP_INDEX;
  document.body.classList.toggle('onboarding-two-level-step', isTwoLevelStep);
  if (isTwoLevelStep) {
    openTaxonGroupDropdown();
    window.requestAnimationFrame(updateTourDropdownPosition);
  } else {
    closeTaxonGroupDropdown();
  }
  setSecondaryTourHighlight('#stage', isTwoLevelStep);
}

function createTour() {
  const driverFactory = getDriverFactory();
  if (!driverFactory) {
    console.warn('Driver.js is not available; onboarding tour was not started.');
    return null;
  }

  let closedByUser = false;

  const tour = driverFactory({
    steps: FIRST_TIME_TOUR_STEPS,
    animate: true,
    allowClose: true,
    allowKeyboardControl: true,
    disableActiveInteraction: false,
    overlayColor: '#111827',
    overlayOpacity: 0.35,
    popoverClass: 'neotoma-onboarding-popover',
    popoverOffset: 12,
    progressText: '{{current}} / {{total}}',
    showButtons: ['next', 'previous', 'close'],
    showProgress: true,
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Done',
    onHighlighted: (_element, _step, options) => {
      syncStepContext(options.state?.activeIndex);
    },
    onCloseClick: (_element, _step, options) => {
      closedByUser = true;
      markFirstTourSkipped();
      syncStepContext(-1);
      options.driver.destroy();
    },
    onDestroyed: (_element, _step, options) => {
      activeTour = null;
      syncStepContext(-1);
      if (closedByUser) return;

      const activeIndex = options.state?.activeIndex ?? 0;
      if (activeIndex >= FIRST_TIME_TOUR_STEPS.length - 1) {
        markFirstTourCompleted();
      } else {
        markFirstTourSkipped();
      }
    },
  });

  return tour;
}

export function startOnboardingTour({ resetState = false } = {}) {
  if (resetState) resetFirstTourState();
  expandTourSurface();
  syncStepContext(-1);

  activeTour?.destroy();
  activeTour = createTour();
  if (!activeTour) return;

  activeTour.drive();
}

export function initOnboarding() {
  bindTourDropdownPositioning();

  const restartButton = document.getElementById('takeTourBtn');
  restartButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    document.getElementById('viewNav')?.classList.remove('open');
    document.getElementById('viewNavTrigger')?.setAttribute('aria-expanded', 'false');
    startOnboardingTour({ resetState: true });
  });

  window.NeotomaOnboarding = {
    start: () => startOnboardingTour({ resetState: true }),
    reset: resetFirstTourState,
  };

  if (shouldAutoStartFirstTour()) {
    window.setTimeout(() => startOnboardingTour(), AUTO_START_DELAY_MS);
  }
}
