let externalTaxaIndex = null;
let externalDatabasesMap = null;
let fetchPromise = null;

// Fetch exactly once on page load (or on first click)
async function fetchExternalData() {
  if (externalTaxaIndex && externalDatabasesMap) return;
  if (fetchPromise) return fetchPromise;

  fetchPromise = Promise.all([
    fetch("https://api.neotomadb.org/v1.5/dbtables/externaltaxa?limit=50000"),
    fetch("https://api.neotomadb.org/v1.5/dbtables/externaldatabases?limit=1000")
  ]).then(async ([taxaRes, dbRes]) => {
    const taxaJson = await taxaRes.json();
    const dbJson = await dbRes.json();

    const taxaData = taxaJson.data || taxaJson;
    const dbData = dbJson.data || dbJson;

    // Index databases by extdatabaseid
    externalDatabasesMap = new Map();
    if (Array.isArray(dbData)) {
      dbData.forEach(db => {
        externalDatabasesMap.set(Number(db.extdatabaseid), db);
      });
    }

    // Index external taxa by taxonid
    externalTaxaIndex = new Map();
    if (Array.isArray(taxaData)) {
      taxaData.forEach(row => {
        const taxonID = Number(row.taxonid);
        if (!externalTaxaIndex.has(taxonID)) {
          externalTaxaIndex.set(taxonID, []);
        }
        externalTaxaIndex.get(taxonID).push(row);
      });
    }
  }).catch(err => {
    console.error("Failed to fetch Neotoma external taxa metadata:", err);
  });

  return fetchPromise;
}

// Kickoff fetch in background immediately so it's ready when user clicks
fetchExternalData();

export async function fetchAndRenderExternalLinks(taxonId, containerElement, currentClickIdRef) {
  if (!containerElement || !taxonId) return;

  containerElement.innerHTML = `<span style="font-size: 11px; color: #888; font-style: italic;">Loading external links...</span>`;

  try {
    // Wait for the tables to load (usually instant if already loaded)
    await fetchExternalData();

    // Race condition check: if user clicked another node while we waited
    if (currentClickIdRef && currentClickIdRef.value !== taxonId) {
      return;
    }

    containerElement.innerHTML = ''; // Clear loading

    const numericTaxonId = Number(taxonId);
    const matchedRows = externalTaxaIndex ? externalTaxaIndex.get(numericTaxonId) || [] : [];
    
    if (matchedRows.length === 0) return;

    const fragment = document.createDocumentFragment();

    // Map rows to link objects first so we can sort them
    let parsedLinks = [];

    matchedRows.forEach(row => {
      const db = externalDatabasesMap.get(Number(row.extdatabaseid));
      if (!db) return;

      let dbName = db.extdatabasename || 'External';
      let finalUrl = row.url;

      // Generate URL from urlmask if not provided directly
      if (!finalUrl && db.urlmask) {
        finalUrl = db.urlmask.replace('<ID>', row.exttaxonid);
      } else if (!finalUrl && db.url) {
        // Fallback if no mask but we have base URL
        finalUrl = db.url.endsWith('/') ? `${db.url}${row.exttaxonid}` : `${db.url}/${row.exttaxonid}`;
      }
      
      if (!finalUrl) return;

      // Assign a distinct color and shorten the display name for aesthetics
      let badgeColor = '#6b7280'; // default gray
      const lowerName = dbName.toLowerCase();
      
      if (lowerName.includes('gbif')) { badgeColor = '#4caf50'; dbName = 'GBIF'; }
      else if (lowerName.includes('wikidata')) { badgeColor = '#9e9e9e'; dbName = 'WikiData'; }
      else if (lowerName.includes('algaebase')) { badgeColor = '#0284c7'; dbName = 'AlgaeBase'; }
      else if (lowerName.includes('ncbi')) { badgeColor = '#6b7280'; dbName = 'NCBI'; }
      else if (lowerName.includes('tropicos')) { badgeColor = '#d97706'; dbName = 'Tropicos'; }
      else if (lowerName.includes('drexel') || lowerName.includes('diatom')) { badgeColor = '#0891b2'; dbName = 'Diatom (ANSP)'; }
      else if (lowerName.includes('eol')) { badgeColor = '#059669'; dbName = 'EOL'; }

      parsedLinks.push({ dbName, finalUrl, badgeColor, extdatabasename: db.extdatabasename });
    });

    // Sort links alphabetically by their shortened database name 
    // so that e.g. "GBIF 1" and "GBIF 2" are grouped together.
    parsedLinks.sort((a, b) => a.dbName.localeCompare(b.dbName));

    const seenUrls = new Set();
    const dbNameCounts = new Map();

    parsedLinks.forEach(link => {
      // Deduplicate identical URLs
      if (seenUrls.has(link.finalUrl)) return;
      seenUrls.add(link.finalUrl);

      // Handle multiple different links for the same database
      let count = dbNameCounts.get(link.dbName) || 0;
      count++;
      dbNameCounts.set(link.dbName, count);
      const displayName = count > 1 ? `${link.dbName} ${count}` : link.dbName;

      const a = document.createElement('a');
      a.href = link.finalUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = `View on ${link.extdatabasename}`;
      a.style.cssText = `
        display: inline-flex;
        align-items: center;
        padding: 2px 6px;
        background-color: ${link.badgeColor};
        color: white;
        font-size: 10px;
        font-weight: 600;
        text-decoration: none;
        border-radius: 4px;
        font-family: 'Figtree', sans-serif;
        transition: filter 0.2s;
        white-space: nowrap;
      `;
      a.innerText = displayName;
      
      a.onmouseover = () => a.style.filter = 'brightness(1.1)';
      a.onmouseout = () => a.style.filter = 'brightness(1)';

      fragment.appendChild(a);
    });

    // If there were multiple of the same DB, go back and rename the first one from "DB" to "DB 1"
    dbNameCounts.forEach((totalCount, dbName) => {
      if (totalCount > 1) {
        for (const child of fragment.childNodes) {
          if (child.innerText === dbName) {
            child.innerText = `${dbName} 1`;
            break;
          }
        }
      }
    });
    
    containerElement.appendChild(fragment);

  } catch (error) {
    console.error("Error rendering external taxa:", error);
    containerElement.innerHTML = '';
  }
}
