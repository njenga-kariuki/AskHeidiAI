import { AdviceEntry, VectorSearchResult } from './types';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class VectorSearch {
  private openai: OpenAI;
  private embeddings: { entry: AdviceEntry; vector: Float32Array }[] = [];
  private categoryEmbeddings: Map<string, Float32Array> = new Map();
  private cacheFilePath: string;
  private vectorDimension: number = 3072; // text-embedding-3-large dimension

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
    this.cacheFilePath = this.getCachePath();
  }

  private getCachePath(): string {
    // Try multiple possible locations
    const possiblePaths = [
      path.join(process.cwd(), 'cache', 'vectorCache.json'),
      path.join(__dirname, '..', 'cache', 'vectorCache.json'),
      path.join(process.env.DATA_DIR || '', 'vectorCache.json')
    ];
    
    for (const p of possiblePaths) {
      const dir = path.dirname(p);
      try {
        // Ensure directory exists
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        // Test write access
        fs.accessSync(dir, fs.constants.W_OK);
        return p;
      } catch (e) {
        console.warn(`Cache path ${p} not usable:`, e);
        continue;
      }
    }
    
    throw new Error('No writable cache location found');
  }

  private constructSearchText(entry: AdviceEntry): string {
    return `${entry.category} ${entry.subCategory} ${entry.advice} ${entry.adviceContext}`.trim();
  }

  // --- Caching Methods ---
  private loadCache(): boolean {
    const backupPath = `${this.cacheFilePath}.backup`;
    
    try {
      // Try loading primary cache
      if (fs.existsSync(this.cacheFilePath)) {
        const rawData = fs.readFileSync(this.cacheFilePath, 'utf8');
        const cache = JSON.parse(rawData);
        
        // Convert stored arrays back to Float32Array
        this.categoryEmbeddings = new Map(cache.categoryEmbeddings.map(([key, value]: [string, number[]]) => 
          [key, new Float32Array(value)]
        ));
        this.embeddings = cache.embeddings.map((item: any) => ({
          entry: item.entry,
          vector: new Float32Array(item.vector)
        }));
        
        // Create backup of valid cache
        fs.writeFileSync(backupPath, rawData);
        console.log('Loaded embeddings from primary cache');
        return true;
      }
      
      // Try loading backup if primary fails
      if (fs.existsSync(backupPath)) {
        const backupData = fs.readFileSync(backupPath, 'utf8');
        const cache = JSON.parse(backupData);
        
        // Convert stored arrays back to Float32Array
        this.categoryEmbeddings = new Map(cache.categoryEmbeddings.map(([key, value]: [string, number[]]) => 
          [key, new Float32Array(value)]
        ));
        this.embeddings = cache.embeddings.map((item: any) => ({
          entry: item.entry,
          vector: new Float32Array(item.vector)
        }));
        console.log('Loaded embeddings from backup cache');
        return true;
      }
    } catch (error) {
      console.error('Error loading cache:', error);
    }
    return false;
  }

  private validateCache(cache: any): boolean {
    const requiredKeys = ['version', 'categoryEmbeddings', 'embeddings', 'model'];
    if (!requiredKeys.every(key => key in cache)) {
      console.warn('Cache missing required keys');
      return false;
    }
    
    // Version check
    if (cache.version !== '1.0') {
      console.warn('Cache version mismatch');
      return false;
    }
    
    // Model check
    if (cache.model !== "text-embedding-3-large") {
      console.warn('Cache model mismatch');
      return false;
    }
    
    return true;
  }

  private saveCache(): void {
    const cache = {
      version: '1.0',
      model: "text-embedding-3-large",
      // Convert Float32Array back to regular arrays for JSON serialization
      categoryEmbeddings: Array.from(this.categoryEmbeddings.entries()).map(([key, value]) => 
        [key, Array.from(value)]
      ),
      embeddings: this.embeddings.map(item => ({
        entry: item.entry,
        vector: Array.from(item.vector)
      })),
    };
    try {
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(cache), 'utf8');
      console.log('Saved embeddings to cache.');
    } catch (error) {
      console.error('Error saving cache:', error);
    }
  }
  // ---------------------

  public async initialize(entries: AdviceEntry[]): Promise<void> {
    console.log(`Starting vector initialization with ${entries.length} entries`);
    
    let useCache = false;
    try {
      useCache = this.loadCache();
    } catch (error) {
      console.error('Cache load failed:', error);
    }

    if (useCache) {
      console.log('Using cached embeddings');
      return;
    }

    // If cache fails, use a lock file to prevent multiple processes from regenerating
    const lockFile = `${this.cacheFilePath}.lock`;
    
    try {
      if (fs.existsSync(lockFile)) {
        console.log('Another process is generating embeddings, waiting...');
        // Wait for lock to be released
        await this.waitForLock(lockFile);
        // Try loading cache again
        if (this.loadCache()) {
          return;
        }
      }

      // Create lock
      fs.writeFileSync(lockFile, new Date().toISOString());

      // Generate embeddings
      await this.generateEmbeddings(entries);
      
      // Save cache
      this.saveCache();
    } finally {
      // Always clean up lock
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
      }
    }
  }

  private async waitForLock(lockFile: string, timeout = 300000): Promise<void> {
    const start = Date.now();
    while (fs.existsSync(lockFile)) {
      if (Date.now() - start > timeout) {
        throw new Error('Timeout waiting for embeddings generation');
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  private async generateEmbeddings(entries: AdviceEntry[]): Promise<void> {
    try {
      // Create embeddings for unique categories
      const uniqueCategories = [...new Set(entries.map(e => e.category))];
      console.log(`Processing ${uniqueCategories.length} unique categories...`);
      for (const category of uniqueCategories) {
        console.log(`Getting embedding for category: ${category}`);
        const vector = await this.getEmbedding(category);
        this.categoryEmbeddings.set(category, vector);
      }

      // Create embeddings for each entry
      console.log(`Processing ${entries.length} entries...`);
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        console.log(`Getting embedding for entry ${i + 1}/${entries.length}: ${entry.category} - ${entry.subCategory}`);
        const searchText = this.constructSearchText(entry);
        const vector = await this.getEmbedding(searchText);
        this.embeddings.push({ entry, vector });

        // Log progress every 50 entries
        if ((i + 1) % 50 === 0) {
          console.log(`Progress: ${i + 1}/${entries.length} entries processed`);
        }
      }

      console.log(`Vector initialization complete. Total embeddings: ${this.embeddings.length}`);
    } catch (error) {
      console.error('Error during vector initialization:', error);
      throw error;
    }
  }

  private async getEmbedding(text: string): Promise<Float32Array> {
    try {
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-large",
        input: text
      });
      // Convert to Float32Array for better performance
      return new Float32Array(response.data[0].embedding);
    } catch (error) {
      console.error('Error getting embedding:', error);
      throw error;
    }
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    // Optimized cosine similarity calculation
    // Same mathematical result, but more efficient computation
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;
    
    // Single loop for all calculations - more cache-friendly
    const length = a.length;
    for (let i = 0; i < length; i++) {
      const aVal = a[i];
      const bVal = b[i];
      dotProduct += aVal * bVal;
      magnitudeA += aVal * aVal;
      magnitudeB += bVal * bVal;
    }
    
    // Avoid redundant sqrt calls by combining them
    const magnitude = Math.sqrt(magnitudeA * magnitudeB);
    return magnitude > 0 ? dotProduct / magnitude : 0;
  }

  public async search(query: string, threshold: number = 0.5): Promise<VectorSearchResult[]> {
    console.log(`Searching for query: "${query}" with threshold ${threshold}`);
    console.log(`Current number of embeddings: ${this.embeddings.length}`);

    try {
      // Get the main query vector
      const mainQueryVector = await this.getEmbedding(query);

      // Get category similarities - pre-allocate map for efficiency
      const categorySimilarities = new Map<string, number>();
      for (const [category, vector] of this.categoryEmbeddings.entries()) {
        const sim = this.cosineSimilarity(mainQueryVector, vector);
        categorySimilarities.set(category, sim);
        console.log(`Category: ${category}, Similarity: ${sim}`);
      }

      // Pre-allocate results array for better memory efficiency
      const allResults: VectorSearchResult[] = new Array(this.embeddings.length);
      
      // Calculate similarities for all entries
      for (let index = 0; index < this.embeddings.length; index++) {
        const { entry, vector } = this.embeddings[index];
        const directSimilarity = this.cosineSimilarity(mainQueryVector, vector);
        const categorySimilarity = categorySimilarities.get(entry.category) || 0;

        // Combined similarity score
        const combinedSimilarity = (directSimilarity * 1.0) + (categorySimilarity * 0.0);

        // Detailed logging for the first 3 entries
        if (index < 3) {
          console.log(`Entry ${index + 1}:`);
          console.log(`   Direct Similarity: ${directSimilarity}`);
          console.log(`   Category Similarity: ${categorySimilarity}`);
          console.log(`   Combined Similarity: ${combinedSimilarity}`);
        }

        allResults[index] = {
          entry,
          similarity: combinedSimilarity
        };
      }

      // Use more efficient sorting - sort in place
      allResults.sort((a, b) => b.similarity - a.similarity);

      // Log top 3 similarities before filtering
      console.log('Top 3 similarities:', 
        allResults.slice(0, 3).map(r => ({
          similarity: r.similarity,
          category: r.entry.category,
          subCategory: r.entry.subCategory,
          sourceTitle: r.entry.sourceTitle
        }))
      );

      // Apply threshold and get top results - use a single pass
      const results: VectorSearchResult[] = [];
      for (let i = 0; i < allResults.length && results.length < 10; i++) {
        if (allResults[i].similarity >= threshold) {
          results.push(allResults[i]);
        }
      }

      console.log(`Found ${results.length} results above threshold ${threshold}`);

      // Log detailed information about selected results
      console.log('Selected results:', 
        results.map(r => ({
          similarity: r.similarity,
          category: r.entry.category,
          subCategory: r.entry.subCategory,
          sourceTitle: r.entry.sourceTitle
        }))
      );

      return results;
    } catch (error) {
      console.error('Error during search:', error);
      throw error;
    }
  }
}

// Create and export singleton instance
export const vectorSearch = new VectorSearch(process.env.OPENAI_API_KEY || '');
