# Taxonomy interaction regression matrix

Last run: 2026-07-24
Target: `index.html` served from a fresh local origin  
Result: PASS, except external API links were not testable in the isolated browser environment.

| Area | Scenario | Expected result | Status |
|---|---|---|---|
| Initial view | Open Explorer | Biological Major Groups tree renders | PASS (1 SVG, 77 nodes) |
| View mode | Explorer → Data Steward | Steward summary is shown and URL stores `view=steward` | PASS |
| View mode | Data Steward → Explorer | Summary is hidden and Explorer is restored | PASS |
| Taxon type | Biological → Non-biological | Dropdown switches to 15 non-biological groups plus Major Groups | PASS |
| Group load | Open CHM | Chemical substance tree renders and URL stores group/type | PASS (1 SVG, 667 nodes) |
| Name search | Search `Steroid` | One result with the expected path | PASS |
| Search selection | MAM → search `bison` → select `?Bison latifrons` | Search input and URL query update to the selected terminal taxon | PASS |
| Search history | MAM → search `bison` → select `?Bison latifrons` → browser Back twice | First Back returns to the 28 `bison` results; second Back returns to the MAM Whole View | PASS |
| Steward selection | Open a search result → switch to Data Steward | The selected taxon, breadcrumb and Taxon Details render on the first click | PASS |
| Steward return | Switch the selected taxon back to Explorer | Explorer detail returns and the Steward Taxon Details panel is cleared | PASS |
| ID search | Search `27491` | Correct full taxon name is shown | PASS |
| Quoted search | Search `"24-methylcholest-5,22-dien-3β-ol"` | Treated as one name, not comparison | PASS |
| Comparison | Search `"Steroid", "Chemical compound"` | Two-taxon comparison panel is shown | PASS |
| Focus view | Switch after comparison | Focus tree renders and control becomes active | PASS (9 nodes) |
| Whole view | Return from Focus view | Full CHM tree and active state are restored | PASS (667 nodes) |
| Tree navigation | Search `Steroid` → Go to Tree | Child tree renders and Back becomes available | PASS (5 nodes) |
| Back navigation | Return from child tree | CHM root tree is restored and Back is hidden | PASS |
| Native Back | MAM → search `Canidae` → Go to Tree → browser Back | Group, search, selected node and Focus mode are restored | PASS |
| Native Forward | Continue with browser Forward | `root=5910` child tree and in-page Back are restored | PASS |
| Page reload | Reload from any group/search/detail state | URL state is cleared and Biological Major Groups renders | PASS |
| Steward anomaly | Open VPL in Data Steward | Orphan/anomaly status is visible | PASS (1,654 unplaced/orphan; 1 anomaly) |
| Anomaly details | Open details | Inconsistent-path detail panel renders | PASS |
| URL restore | Load `group=CHM&type=nonbio&q=27491` | Group, type, query and result restore | PASS |
| Small tree | Open ACR | Collapsible tree renders | PASS (27 visible nodes) |
| Synonym | Search `Micrhystridium ariakense` | Resolves to `Mecsekia ariakense` with synonym explanation | PASS |
| Metadata | Open search detail | Author, validator and publication sections render | PASS |
| Onboarding | Welcome → Close | Tour opens and can be dismissed | PASS |
| External links | Fetch remote external-taxa metadata | Remote API is available | NOT TESTED — network blocked in test environment |

## Automated structural coverage

`test_tree_golden.mjs` compares all 51 taxon groups between legacy and split payloads. It requires exact parity for root ID, input rows, node count, edges, leaves, depth and a structure hash. Name-record hashes may differ only for the approved groups `CHM`, `DIA`, `DIN`, `INS` and `LAB`.
