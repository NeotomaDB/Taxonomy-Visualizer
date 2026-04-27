import { renderCollapsibleTree } from './collapsibleTree.js';
import { NON_BIO_GROUPS } from './taxaViewConfig.js';

export async function renderNonBioInitView(taxaSelectOptions) {
    const rows = [];

    // Convert array-like HTMLSelectElement options or similar to standard array
    const optionsArray = Array.from(taxaSelectOptions);

    NON_BIO_GROUPS.forEach(groupId => {
        const option = optionsArray.find(opt => opt.value === groupId);
        // Only include if it actually exists in the current data dropdown!
        if (option) {
            rows.push({
                taxonid: groupId,
                taxonname: option.text || groupId,
                ids_root_to_leaf: ["ROOT_NB", groupId],
                names_root_to_leaf: ["Non-biological Taxa", option.text || groupId],
                taxagroupid: groupId,
                isSyntheticGroup: true // Treat as a group entry
            });
        }
    });

    // Clear previous charts
    d3.select('#chart').selectAll('*').remove();

    // Hide the tree view toggle since this view is hardcoded to a tree structure
    const toggleDiv = document.getElementById('treeViewToggle');
    if (toggleDiv) {
        toggleDiv.style.display = 'none';
        toggleDiv.style.visibility = 'hidden';
    }

    await renderCollapsibleTree({
        rows: rows,
        allRowsForSynonyms: [],
        selector: '#chart',
        rootId: "ROOT_NB",
        rootName: "Non-biological Taxa",
        expandAll: true,
        dx: 30,
        dy: 180, // Generous horizontal spacing for taxa group names
        anchorIds: new Set()
    });
}
