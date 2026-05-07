// View Switch functionality: Switch between Whole View and Focus View
// Focus View shows only the highlighted path, Whole View shows the full tree

import { updateURLState } from './urlhash.js';

let currentHighlightedPath = null; // The currently highlighted node path
let currentMatchIds = new Set(); // IDs of the matched search result taxa
let isFocusView = false; // Current view state
let originalRows = null; // Store original rows for restoring
let originalRootInfo = null; // Store original root info
let renderFunction = null; // Store the render function reference
let allRowsForSynonyms = null; // Store all rows for synonyms
let isShowingFocusViewWarning = false; // Flag to prevent repeated warnings

/**
 * Initialize view switch functionality
 * @param {Function} renderFn - Function to render the tree (takes rows, rootId, rootName, allRowsForSynonyms)
 * @param {Array} rows - Original rows data
 * @param {Object} rootInfo - Root info {rootId, rootName}
 * @param {String} taxagroupid - Current taxagroupid
 * @param {Array} allRows - All rows for synonyms
 */
// Store event handlers to allow removal
let wholeViewHandler = null;
let focusViewHandler = null;

export function initViewSwitch(renderFn, rows, rootInfo, taxagroupid, allRows) {
  renderFunction = renderFn;
  originalRows = rows;
  originalRootInfo = rootInfo;
  allRowsForSynonyms = allRows;
  
  const wholeViewBtn = document.getElementById('wholeViewBtn');
  const focusViewBtn = document.getElementById('focusViewBtn');
  
  // Remove existing event listeners if any
  if (wholeViewBtn && wholeViewHandler) {
    wholeViewBtn.removeEventListener('click', wholeViewHandler);
  }
  if (focusViewBtn && focusViewHandler) {
    focusViewBtn.removeEventListener('click', focusViewHandler);
  }
  
  // Create new handlers
  wholeViewHandler = () => {
    if (!isFocusView) return; // Already in whole view
    switchToWholeView();
  };
  
  focusViewHandler = () => {
    if (isFocusView) return; // Already in focus view
    switchToFocusView();
  };
  
  // Add event listeners
  if (wholeViewBtn) {
    wholeViewBtn.addEventListener('click', wholeViewHandler);
  }
  
  if (focusViewBtn) {
    focusViewBtn.addEventListener('click', focusViewHandler);
  }
  
  updateButtonState();
}

/**
 * Set the currently highlighted path
 * @param {Object} node - The highlighted node (d3.hierarchy node)
 */
export function setHighlightedPath(node) {
  if (!node) {
    currentHighlightedPath = null;
    return;
  }
  
  // Store the path from root to this node
  const ancestors = node.ancestors().reverse();
  currentHighlightedPath = {
    node: node,
    path: ancestors, // Root to node
    pathIds: ancestors.map(n => n.data.id)
  };
  
  // Clear warning when path is set
  isShowingFocusViewWarning = false;
  hideFocusViewWarning();
  
  console.log('setHighlightedPath called', {
    nodeName: node.data.name,
    nodeId: node.data.id,
    pathIds: currentHighlightedPath.pathIds,
    isFocusView
  });
  
  // If we're already in Focus View due to an active search result set, the
  // current filtered tree is already correct. In that case we only need to
  // update the in-place highlight, not trigger another full re-render.
  if (isFocusView && currentMatchIds.size === 0) {
    switchToFocusView();
  }
}

/**
 * Set the matched node IDs from search results
 * @param {Set|Array} matchIds - Set or array of matched result node IDs
 */
export function setMatchIds(matchIds) {
  currentMatchIds = matchIds instanceof Set ? matchIds : new Set(matchIds);
  // Clear warning when matches are set
  if (currentMatchIds.size > 0) {
    isShowingFocusViewWarning = false;
    hideFocusViewWarning();
  }
  console.log('setMatchIds called', {
    count: currentMatchIds.size,
    ids: Array.from(currentMatchIds).slice(0, 10)
  });
}

/**
 * Clear the highlighted path
 */
export function clearHighlightedPath() {
  currentHighlightedPath = null;
  currentMatchIds.clear();
  if (isFocusView) {
    switchToWholeView();
  }
}

/**
 * Programmatically switch into Focus View using the current match/path state.
 */
export async function activateFocusView() {
  await switchToFocusView();
}

/**
 * Switch to Focus View - show only the highlighted path
 */
async function switchToFocusView() {
  console.log('switchToFocusView called', {
    hasPath: !!currentHighlightedPath,
    hasMatchIds: currentMatchIds.size > 0,
    hasRows: !!originalRows,
    hasRenderFn: !!renderFunction,
    pathIds: currentHighlightedPath?.pathIds,
    matchIdsCount: currentMatchIds.size
  });
  
  // Check if we have match IDs or highlighted path
  if (currentMatchIds.size === 0 && !currentHighlightedPath) {
    // Show friendly message in info panel instead of blocking alert
    if (!isShowingFocusViewWarning) {
      isShowingFocusViewWarning = true;
      showFocusViewWarning();
      // Auto-hide after 5 seconds
      setTimeout(() => {
        hideFocusViewWarning();
        isShowingFocusViewWarning = false;
      }, 5000);
    }
    return;
  }
  
  if (!originalRows || !renderFunction) {
    console.warn('Cannot switch to Focus View: missing data or render function', {
      originalRows: !!originalRows,
      renderFunction: !!renderFunction
    });
    return;
  }
  
  isFocusView = true;
  isShowingFocusViewWarning = false;
  hideFocusViewWarning();
  updateButtonState();
  updateURLState({ mode: 'focus' });
  
  let filteredRows = [];
  
  if (currentMatchIds.size > 0) {
    filteredRows = originalRows.filter(row => {
      const rowIds = (row.ids_root_to_leaf || []).map(id => Number(id));
      const leafId = rowIds[rowIds.length - 1];
      return currentMatchIds.has(Number(row.taxonid)) || currentMatchIds.has(Number(leafId));
    });
    
    console.log('Filtered by match IDs:', {
      originalCount: originalRows.length,
      filteredCount: filteredRows.length,
      matchIdsCount: currentMatchIds.size,
      sampleMatchIds: Array.from(currentMatchIds).slice(0, 5)
    });

    if (filteredRows.length === 0 && currentHighlightedPath) {
      const highlightedNodeId = currentHighlightedPath.pathIds[currentHighlightedPath.pathIds.length - 1];
      filteredRows = originalRows.filter(row => {
        const rowIds = (row.ids_root_to_leaf || []).map(id => Number(id));
        return rowIds.includes(Number(highlightedNodeId));
      });
      
      console.log('Fell back to highlighted node ID after zero exact match rows:', {
        filteredCount: filteredRows.length,
        nodeId: highlightedNodeId
      });
    }
  } else if (currentHighlightedPath) {
    // Fallback: use highlighted path if no match IDs available
    const highlightedNodeId = currentHighlightedPath.pathIds[currentHighlightedPath.pathIds.length - 1];
    filteredRows = originalRows.filter(row => {
      const rowIds = (row.ids_root_to_leaf || []).map(id => Number(id));
      return rowIds.includes(Number(highlightedNodeId));
    });
    
    console.log('Filtered by highlighted node ID:', {
      originalCount: originalRows.length,
      filteredCount: filteredRows.length,
      nodeId: highlightedNodeId
    });
  }
  
  if (filteredRows.length === 0) {
    console.warn('No rows found for Focus View', {
      hasMatchIds: currentMatchIds.size > 0,
      hasPath: !!currentHighlightedPath
    });
    return;
  }
  
  // Re-render with filtered data
  console.log('Rendering with filtered data...', filteredRows.length, 'rows');
  await renderFunction(filteredRows, originalRootInfo.rootId, originalRootInfo.rootName, allRowsForSynonyms);
  console.log('Rendering complete');
}

/**
 * Switch to Whole View - show the full tree
 */
async function switchToWholeView() {
  if (!originalRows || !renderFunction) {
    console.warn('Cannot switch to Whole View: missing original data');
    return;
  }
  
  isFocusView = false;
  updateButtonState();
  updateURLState({ mode: 'whole' });
  
  // Re-render with original data
  await renderFunction(originalRows, originalRootInfo.rootId, originalRootInfo.rootName, allRowsForSynonyms);
}

/**
 * Update the button state based on current view
 */
function updateButtonState() {
  const wholeViewBtn = document.getElementById('wholeViewBtn');
  const focusViewBtn = document.getElementById('focusViewBtn');
  
  if (wholeViewBtn) {
    if (isFocusView) {
      wholeViewBtn.classList.remove('active');
    } else {
      wholeViewBtn.classList.add('active');
    }
  }
  
  if (focusViewBtn) {
    if (isFocusView) {
      focusViewBtn.classList.add('active');
    } else {
      focusViewBtn.classList.remove('active');
    }
  }
}

/**
 * Check if currently in Focus View
 */
export function isInFocusView() {
  return isFocusView;
}

/**
 * Reset view state (called when tree is reloaded)
 */
export function resetViewState() {
  isFocusView = false;
  currentHighlightedPath = null;
  currentMatchIds.clear();
  isShowingFocusViewWarning = false;
  hideFocusViewWarning();
  updateButtonState();
}

/**
 * Show warning message in info panel when trying to use Focus View without selection
 */
function showFocusViewWarning() {
  const panel = document.getElementById('info');
  if (!panel) return;
  
  panel.innerHTML = `
    <div style="
      padding: 12px 16px;
      background-color: #fff3cd;
      border: 1px solid #ffc107;
      border-radius: 6px;
      color: #856404;
      font-size: 14px;
      line-height: 1.5;
    ">
      <div style="font-weight: 600; margin-bottom: 4px;">⚠️ Focus View Unavailable</div>
      <div>Please search for a taxon or click on a node in the tree first, then switch to Focus View.</div>
      <button onclick="this.parentElement.style.display='none'" style="
        margin-top: 8px;
        padding: 4px 12px;
        background: #ffc107;
        color: #856404;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
      ">Dismiss</button>
    </div>
  `;
  panel.style.display = 'block';
}

/**
 * Hide warning message
 */
function hideFocusViewWarning() {
  const panel = document.getElementById('info');
  if (panel && isShowingFocusViewWarning) {
    // Only hide if it's showing the warning (check for warning content)
    const warningContent = panel.querySelector('div[style*="background-color: #fff3cd"]');
    if (warningContent) {
      panel.style.display = 'none';
      panel.innerHTML = '';
    }
  }
}
