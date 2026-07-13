/**
 * Configuration for the initial view behaviors of different taxa groups.
 * Centralizing logic here makes adding new groups or changing tree styles easier.
 */

// Groups that always use the vertically collapsible (linear) tree,
// usually because their hierarchy is extremely flat, irregular, or radial view looks bad.
export const FORCE_LIST_TREE_GROUPS = new Set(['WCH', 'LAB', 'CHO', 'BRZ', 'PLA', 'PRO', 'PRZ', 'ROT', 'VER']);

export const NON_BIO_GROUPS = new Set(['WCH', 'BIM', 'AQU', 'PHY', 'MAG', 'CHM', 'SED', 'LOI', 'LAB', 'CAR', 'ISO', 'CHR', 'UPA', 'DNA', 'PHT']);

// Groups where the collapsible list tree should be completely expanded at initialization.
export const EXPAND_ALL_COLLAPSIBLE = new Set([
    'SPO', 'CNI', 'BRC', 'ANL', 'MOL', 'NEM', 'FLT', 'ECH', 'ROT', 'BRZ', 'FUN', 'CHO', 'FOR', 'SIL', 'PLA', 'PRO', 'PRZ', 'VER', 'ISO',
]);

// Small/manageable groups using the radial view where all nodes are force-expanded.
export const EXPAND_ALL_RADIAL = new Set([
    'SPO', 'CNI', 'BRC', 'ANL', 'MOL', 'NEM', 'FLT', 'ECH', 'ROT', 'BRZ', 'FUN', 'FOR', 'SIL', 'CHO',
]);

// Large groups for radial view where we show only the top/anchor level and orders/classes,
// immediately collapsing deeper nodes.
export const ONE_LEVEL_RADIAL_GROUPS = new Set(['MAM', 'AVE', 'DIA']);

// VPL uses the same radial-overview mechanism, but its first visible tier is too sparse.
// Keep a few more levels visible on first render so the opening layout reads less like
// two disconnected arcs while still avoiding a full 18k-node expansion.
export const THREE_LEVEL_RADIAL_GROUPS = new Set(['VPL']);

export function getRadialOverviewDepth(taxagroupid) {
    if (THREE_LEVEL_RADIAL_GROUPS.has(taxagroupid)) return 3;
    if (ONE_LEVEL_RADIAL_GROUPS.has(taxagroupid)) return 1;
    return null;
}

// Groups that trigger the focus view mode or unique search optimizations.
// These large groups benefit from filtered Focus View searches instead of
// expanding every matching path in the radial tree.
export const FOCUS_VIEW_GROUPS = new Set(['INS', 'MAM', 'AVE', 'DIA', 'VPL']);

export const SEARCH_COLLAPSIBLE_MATCH_THRESHOLD = 5;

// Group-specific semantic label rules for dense radial trees. Nodes and links
// remain fully rendered; only label eligibility changes as users zoom.
export const RADIAL_SEMANTIC_LABEL_CONFIG = {
    ALG: {
        targetScreenFontPx: 11,
        targetScreenNodeRadiusPx: 3.5,
        targetScreenLeafNodeRadiusPx: 2.25,
        collisionPaddingPx: 4,
        viewportPaddingPx: 8,
        tiers: [
            { minScale: 0, maxInternalDepth: 5, maxLeafDepth: -1 },
            { minScale: 1.5, maxInternalDepth: 8, maxLeafDepth: -1 },
            { minScale: 2.5, maxInternalDepth: Infinity, maxLeafDepth: 8 },
            { minScale: 4, maxInternalDepth: Infinity, maxLeafDepth: Infinity },
        ],
    },
};

export function getRadialSemanticLabelConfig(taxagroupid) {
    return RADIAL_SEMANTIC_LABEL_CONFIG[taxagroupid] || null;
}

export function shouldAutoFocusCollapsibleSearch(taxagroupid) {
    if (!taxagroupid) return false;
    if (NON_BIO_GROUPS.has(taxagroupid)) return false;
    if (FORCE_LIST_TREE_GROUPS.has(taxagroupid)) return false;
    if (EXPAND_ALL_RADIAL.has(taxagroupid)) return false;
    if (FOCUS_VIEW_GROUPS.has(taxagroupid)) return false;
    if (getRadialOverviewDepth(taxagroupid) != null) return false;
    return true;
}

// Major-group nodes use the teal collapsed-group styling and default overview collapse.
export const MAJOR_GROUP_DISPLAY_NAMES = new Set([
    'chemical substance',
    'chemical compound',
    'fungi',
    'algae',
    'plantae undiff.',
    'prokaryota',
    'chromista',
    'cnidaria',
    'annelida',
    'plantae',
    'tracheophyta',
    'vascular plants',
    'bryozoa',
    'arthropoda',
    'mammalia',
    'vertebrata',
    'unknown',
    'rhizophagidae',
    'cybocephalidae',
    'invertebrata',
    'ostomidae',
]);

export function isMajorGroupDisplayName(name) {
    return MAJOR_GROUP_DISPLAY_NAMES.has(String(name || '').trim().toLowerCase());
}

// Define layout spacing overrides for linear tree views. 
// Narrow horizontal spans (e.g., dy=130) prevent visually disconnected layouts 
// when names are longer, giving it a list-like rather than scattered feel.
export function getTreeViewSpacing(taxagroupid) {
    const customSpacingGroups = new Set(['FOR', 'SIL', 'CHO', 'BRZ', 'PLA']);
    if (customSpacingGroups.has(taxagroupid)) {
        return { dx: 25, dy: 130 };
    }
    return { dx: 25, dy: null };
}
