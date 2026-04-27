# Neotoma Taxonomy Visualizer Architecture

This document outlines the core architecture of the Neotoma Taxonomy Visualizer, divided into data structure preparation, visualization rules, and the primary rendering pipeline.

---

## 1. Data Structure

### 1.1 Source Data Formats
The core taxonomic data is ingested from Neotoma database exports, formatted as JSON (e.g., `taxonpaths.json`). Each record represents a lineage path from the root down to a specific taxon leaf node, this can not be modified in any circumstances.
Key fields include:
*   `taxonid`: The unique numerical identifier for the leaf taxon.
*   `taxonname`: The string name of the leaf taxon.
*   `ids_root_to_leaf`: Comma-separated string or array of IDs representing the taxonomic hierarchy from the root to the leaf.
*   `names_root_to_leaf`: Comma-separated string or array of names corresponding to the IDs.
*   `taxagroupid`: A 3-letter code defining the broad taxonomic category (e.g., `MAM` for Mammals, `DIA` for Diatoms).

### 1.2 Synonym Metadata
this can not be modified in any circumstances.
Synonym relationships (historical or invalid taxonomic names) are stored semi-separately and injected into canonical nodes during the tree build process:
*   Invalid names are **not** created as structural nodes in the taxonomy tree.
*   Instead, they are appended as `synonymMetadata` objects onto their valid canonical counterparts.
*   This approach ensures legacy nomenclature remains highly searchable via reverse-lookup maps (`invalidIdToCanonicalId`) without corrupting the current phylogenetic structure.

### 1.3 Synthetic Nodes & Anchors
Because raw tabular paths can sometimes bypass logical groupings, the application injects specific structural nodes:
*   **Synthetic Routing Nodes**: Nodes like `Fish (Synthetic)` or `Vertebrates undiff. (Synthetic)` are added to intercept flat paths (e.g., for `FSH`, `HRP`, `VER`) to force them into a cohesive visual cluster under Eukaryota/Animalia. Additionally, massive deeply-nested groups like Vascular Plants (`VPL`) utilize `SYNTHETIC_GROUP_ROOTS` configured with `sliceAfterName`. This physically cuts out long, unbranched intermediate chains (like `Viridiplantae -> Streptophyta -> Embryophyta`) substituting them with a single synthetic root node for enhanced top-level clarity.
*   **Anchors**: Defined via `anchor_analysis.json` and explicit built-ins (e.g., `Bacillariophyta` for Diatoms). Anchors specify where a given `taxagroupid` sub-tree logically begins. In the "Major Groups" top-level view, the tree prunes paths precisely at these anchors to avoid generating overly dense charts right away.

---

## 2. Visualization Rules

The tool adapts its visualization strategy depending on the scale and nature of the selected `taxagroupid`.

### 2.1 View Types & Conditionals
*   **Collapsible Tree View (Left-to-Right layout)**
    *   **Trigger Condition**: Utilized automatically if a taxonomic group contains fewer than 50 unique nodes, OR if the group has a flat/irregular structure forced via `FORCE_LIST_TREE_GROUPS` (e.g., `WCH` [Water chemistry], `LAB` [Laboratory], `CHO` [Chromista]).
    *   **Spacing Adjustments**: Employs dynamic parameter passing; sparse groups like `FOR` (Foraminifera), `SIL` (Silicoflagellates), and `CHO` apply increased vertical spacing (`dx: 45`) so the labels are easily legible side-by-side.
*   **Radial Dendrogram View (Circular layout)**
    *   **Trigger Condition**: The primary view for any standard biological group containing more than 50 nodes (e.g., Mammals, Plants). Designed to display highly branched evolutionary relationships compactly.

### 2.2 Expansion & Collapse Logic
*   **Global Expansion (`EXPAND_ALL_GROUPS` & `EXPAND_ALL_COLLAPSIBLE`)**: Certain smaller biological groups (e.g., `FOR`, `SIL`, `CHO`, `SPO`, `CNI`) are configured to trigger fully expanded upon load.
*   **Overview Collapse & Rate Limiting (`ONE_LEVEL_RADIAL_GROUPS`)**: For deeply nested, massive hierarchies (e.g., `MAM`, `VPL` reaching up to 19,000 nodes), the tree is initialized showing only the top-most anchor and primary structural subcategories. Sub-level children are assigned to a hidden `_children` property rather than `children`. This prevents extreme framerate drops.
*   **Categorical Collapsing**: Ambiguous, high-density categories—such as "Chemical Substance," "Algae," "Plantae undiff."—are algorithmically detected and collapsed by default to prevent visual crowding. All collapsible groups are styled with a unified hex `#7cafae`.
*   **Intelligent Nested Expansion**: When users click a `+` toggle on a collapsed node:
    - If the node's recursive, hidden sub-tree contains **less than 10 nodes total**, it automatically expands "all the way down" securely to the leaves, skipping tedious click-throughs.
    - If strictly >10, it safely opens only 1 discrete level. 
*   **Toggle Interface UI Rules**:
    - **Hover Mechanics**: Toggle buttons on the innermost radial hierarchy (Depth 1) are `ALWAYS` visible. Every subsequent depth $\ge 2$ utilizes strict `HOVER` rules to reduce global visual noise.
    - **Stability**: Expander nodes utilize an extended, invisible SVG "pill" (`rect` overlay) as a hit area, preserving hover states when moving mouse cursors outwards along linkage lines.

### 2.3 Dealing with Uncertainty & Anomalies
*   **Uncertainty Grouping (`groupUncertainLeaves`)**: When multiple leaf nodes at the same tier begin with "Unknown..." or "Undetermined...", the system automatically groups them into a single expandable synthetic parent (e.g., `Unknown (14)`).
*   **Anomalies & Orphan Branches**: If a taxonomy path lacks the expected hierarchical anchor or skips crucial parent nodes, it is pruned from the central rendering tree to maintain clean topology. Crucially, missing-ancestor detection is calculated dynamically *relative to the current active visual root* rather than the rigid master database root. These pruned instances are subsequently itemized into an expandable **Anomaly Bar** interface.

---

## 3. Visualization Functions & Pipeline

### 3.1 Data Preparation (`src/data.js` & `index.html`)
1.  **`convertTaxonPaths(data)`**: Validates arrays and injects the necessary synthetic routing nodes for loose taxonomic groups.
2.  **`filterRowsByGroup(rows, taxagroupid)`**: Uses the anchor map to identify the most sensible root for a given group, filtering and truncating the dataset to extract the sub-hierarchy perfectly.
3.  **`pathsToTree(rows)`**: Recursively transforms the filtered flat path lists into nested Javascript tree objects (`id`, `name`, `children`).
4.  **`attachSynonymMetadata(tree, map)`**: Applies synonym data arrays onto the valid canonical nodes mapping references.

### 3.2 View Control (`index.html`)
*   **`loadTreeForGroup(taxagroupid)`**: The master controller function. It evaluates the selected dataset size, checks for forcing arrays (`FORCE_LIST_TREE_GROUPS` / `EXPAND_ALL`), executes `detectAnomalies()`, and mounts either the Radial or Collapsible renderer.

### 3.3 Radial Layout Toolkit (`taxon_group_viz.js`)
*   **`renderMammalTree()`**: Coordinates the primary D3 radial generation.
    *   **`reorderTreeForGrouping()` & `computeLeafOrder()`**: Reorders leaf nodes so phylogenetically related sisters group cleanly together rather than strict alphabetically.
    *   **`customSeparation(a, b)`**: Calculates layout angles dynamically. If two nodes belong to distinct taxonomic super-groups, a wider angular gap (`groupPadding`) is applied compared to close sibling clusters.
    *   **`update()`**: Master D3 update loop. Handles transitions in mapping Cartesian/Polar coordinates onto nodes.
    *   **`setupSearch()` & `labelCulling()`**: Mounts decoupled abstractions. `labelCulling` calculates angular overlap at high capacities; it avoids extreme 60-FPS loop jitter by intentionally caching scale parameters (`lastK`) so that strictly translating/panning does not re-invoke geometry matrix recalcs.

### 3.4 Collapsible Layout Toolkit (`src/collapsibleTree.js`)
*   **`renderCollapsibleTree()`**: Coordinates D3's linear tree rendering logic.
    *   **Alphabetical Enforcing**: Sorts sibling arrays strictly by name, providing better index-like usability for small lists over phylogenetic precision.
    *   **Layout Definition**: Generates positional geometry via `d3.tree().nodeSize([dx, dy])` mapping to orthogonal Cartesian links instead of radial curves.
    *   **Animation Lifecycle**: Employs coordinate caching (`x0`, `y0`) upon structural toggling, creating the fluid "folding" and "unfolding" slide transitions across the X-axis.

### 3.5 Interaction & Search Engine (`src/search.js` & `src/highlight.js`)
*   **FOCUS_VIEW_GROUPS Logic**: Large databanks (`INS`, `DIA`, `VPL`) implement `isFocusView` optimization logic. By intercepting node interactions, the view drops un-searched outer nodes entirely, isolating only the matched leaf paths.
*   **Dual-Taxa Comparison**: Comma-separated query strings construct partitioned Match Groups. Calculates the Lowest Common Ancestor (LCA) dynamically.
*   **Full Lineage Comparison Widget**: A floating interface rebuilds and details out the complete lineage path from root up to the shared LCA, highlighting explicit points of split divergence across two taxa variants concurrently.
