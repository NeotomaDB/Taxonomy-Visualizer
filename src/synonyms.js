// Synonym management for taxonomic names
// Handles bidirectional mapping between valid and invalid taxon IDs/names

class SynonymManager {
  constructor() {
    // ID mappings
    this.idToValidId = new Map(); // Maps any ID (valid or invalid) to its valid ID
    this.validIdToAllIds = new Map(); // Maps valid ID to Set of all related IDs
    
    // Name mappings
    this.nameToValidId = new Map(); // Maps any name (valid or invalid) to its valid ID
    this.validIdToAllNames = new Map(); // Maps valid ID to Set of all related names
    
    // Metadata
    this.validIdToInfo = new Map(); // Stores complete info for each valid taxon
    this.isLoaded = false;
  }
  
  /**
   * Load and process synonym data from all_synonyms.json
   */
  async load() {
    if (this.isLoaded) return;
    
    try {
      const response = await fetch('data/all_synonyms.json');
      const synonymData = await response.json();
      
      // Build mappings
      synonymData.forEach(entry => {
        const validId = entry.valid_id;
        const validName = entry.valid_name;
        const synonyms = entry.synonyms || [];
        
        // Initialize sets for this valid ID
        const allIds = new Set([validId]);
        const allNames = new Set([validName]);
        
        // Map valid ID to itself
        this.idToValidId.set(validId, validId);
        
        // Map valid name to valid ID (case-insensitive)
        this.nameToValidId.set(validName.toLowerCase(), validId);
        
        // Process each synonym
        synonyms.forEach(syn => {
          const invalidId = syn.invalid_id;
          const invalidName = syn.invalid_name;
          
          // Map invalid ID to valid ID
          this.idToValidId.set(invalidId, validId);
          
          // Map invalid name to valid ID (case-insensitive)
          this.nameToValidId.set(invalidName.toLowerCase(), validId);
          
          // Add to sets
          allIds.add(invalidId);
          allNames.add(invalidName);
        });
        
        // Store complete sets
        this.validIdToAllIds.set(validId, allIds);
        this.validIdToAllNames.set(validId, allNames);
        
        // Store complete info
        this.validIdToInfo.set(validId, {
          validId: validId,
          validName: validName,
          taxagroupid: entry.taxagroupid,
          synonyms: synonyms
        });
      });
      
      this.isLoaded = true;
      console.log(`Loaded ${synonymData.length} synonym entries`);
      console.log(`Total ID mappings: ${this.idToValidId.size}`);
      console.log(`Total name mappings: ${this.nameToValidId.size}`);
    } catch (error) {
      console.error('Failed to load synonym data:', error);
    }
  }
  
  /**
   * Get the valid ID for any given ID (valid or invalid)
   * @param {number} id - Taxon ID
   * @returns {number|null} Valid ID or null if not found
   */
  getValidId(id) {
    return this.idToValidId.get(id) || null;
  }
  
  /**
   * Get the valid ID for any given name (valid or invalid)
   * @param {string} name - Taxon name
   * @returns {number|null} Valid ID or null if not found
   */
  getValidIdByName(name) {
    return this.nameToValidId.get(name.toLowerCase()) || null;
  }
  
  /**
   * Get all related IDs (including the valid ID and all invalid IDs) for a given ID
   * @param {number} id - Any taxon ID (valid or invalid)
   * @returns {Set<number>} Set of all related IDs, or empty Set if not found
   */
  getAllSynonymIds(id) {
    const validId = this.getValidId(id);
    if (!validId) return new Set();
    return this.validIdToAllIds.get(validId) || new Set();
  }
  
  /**
   * Get all related names (including the valid name and all invalid names) for a given ID
   * @param {number} id - Any taxon ID (valid or invalid)
   * @returns {Set<string>} Set of all related names, or empty Set if not found
   */
  getAllSynonymNames(id) {
    const validId = this.getValidId(id);
    if (!validId) return new Set();
    return this.validIdToAllNames.get(validId) || new Set();
  }
  
  /**
   * Check if an ID is an invalid (synonym) ID
   * @param {number} id - Taxon ID
   * @returns {boolean} True if this is an invalid ID
   */
  isInvalidId(id) {
    const validId = this.getValidId(id);
    return validId !== null && validId !== id;
  }
  
  /**
   * Check if a name is an invalid (synonym) name
   * @param {string} name - Taxon name
   * @returns {boolean} True if this is an invalid name
   */
  isInvalidName(name) {
    const validId = this.getValidIdByName(name);
    if (!validId) return false;
    const info = this.validIdToInfo.get(validId);
    return info && info.validName.toLowerCase() !== name.toLowerCase();
  }
  
  /**
   * Get complete synonym information for a given ID
   * @param {number} id - Any taxon ID (valid or invalid)
   * @returns {object|null} Complete synonym info or null if not found
   */
  getSynonymInfo(id) {
    const validId = this.getValidId(id);
    if (!validId) return null;
    return this.validIdToInfo.get(validId) || null;
  }
  
  /**
   * Get the valid name for any given ID
   * @param {number} id - Any taxon ID (valid or invalid)
   * @returns {string|null} Valid name or null if not found
   */
  getValidName(id) {
    const info = this.getSynonymInfo(id);
    return info ? info.validName : null;
  }
  
  /**
   * Check if synonym data has been loaded
   * @returns {boolean} True if data is loaded
   */
  isReady() {
    return this.isLoaded;
  }
}

// Create singleton instance
const synonymManager = new SynonymManager();

// Export functions
export async function initSynonyms() {
  await synonymManager.load();
}

export function getAllSynonymIds(id) {
  return synonymManager.getAllSynonymIds(id);
}

export function getAllSynonymNames(id) {
  return synonymManager.getAllSynonymNames(id);
}

export function isInvalidId(id) {
  return synonymManager.isInvalidId(id);
}

export function getSynonymInfo(id) {
  return synonymManager.getSynonymInfo(id);
}

export function isSynonymsReady() {
  return synonymManager.isReady();
}

/**
 * Check if a taxon NAME is listed as invalid in the synonym data.
 * Returns null if not invalid, or {validName, synonymtype, recdatemodified} if it is.
 */
export function getInvalidNameInfo(name) {
  if (!synonymManager.isReady()) return null;
  const validId = synonymManager.getValidIdByName(name);
  if (!validId) return null;
  const info = synonymManager.validIdToInfo.get(validId);
  if (!info) return null;
  // Only flag as invalid if the name doesn't match the valid name
  if (info.validName.toLowerCase() === name.toLowerCase()) return null;
  // Find the specific synonym entry for this name to get type/date
  const synEntry = (info.synonyms || []).find(
    s => s.invalid_name.toLowerCase() === name.toLowerCase()
  );
  return {
    validName: info.validName,
    validId,
    synonymtype: synEntry ? synEntry.synonymtype : null,
    recdatemodified: synEntry ? synEntry.recdatemodified : null,
  };
}
