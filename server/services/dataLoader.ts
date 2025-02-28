import Papa from 'papaparse';
import fs from 'fs';
import { AdviceEntry, SearchAdviceEntry } from '@shared/schema';
import path from 'path';
import { vectorSearch } from '../services/vectorSearch';

// Type guard for raw CSV data
interface RawCSVRow {
  Category: string;
  SubCategory: string;
  Advice: string;
  AdviceContext: string;
  SourceTitle: string;
  SourceType: string;
  SourceLink: string;
  MsgSourceTitle?: string;
  SourceSummary?: string;
}

function isValidRawRow(row: unknown): row is RawCSVRow {
  const r = row as RawCSVRow;
  return (
    typeof r?.Category === 'string' &&
    typeof r?.SubCategory === 'string' &&
    typeof r?.Advice === 'string' &&
    typeof r?.AdviceContext === 'string' &&
    typeof r?.SourceTitle === 'string' &&
    typeof r?.SourceType === 'string' &&
    typeof r?.SourceLink === 'string' &&
    (r?.MsgSourceTitle === undefined || typeof r?.MsgSourceTitle === 'string') &&
    (r?.SourceSummary === undefined || typeof r?.SourceSummary === 'string')
  );
}

export class DataLoader {
  private static instance: DataLoader;
  private adviceData: SearchAdviceEntry[] = [];

  private static SEARCH_TERM_MAPPINGS: Record<string, string[]> = {
    'fundraising': ['raise money', 'raising capital', 'funding round', 'raise funds'],
    'hiring': ['recruitment', 'recruiting', 'talent acquisition', 'build team'],
    'revenue': ['sales', 'arr', 'mrr', 'income'],
    'product': ['product market fit', 'pmf', 'product development'],
    'pitch': ['pitch deck', 'investor presentation', 'investor deck'],
    'board': ['board of directors', 'bod', 'board meeting'],
    'valuation': ['409a', 'cap table', 'valuation'],
    'metrics': ['kpi', 'okr', 'metrics', 'measurement'],
    'strategy': ['go to market', 'gtm', 'strategic planning'],
    'investment': ['venture capital', 'vc', 'angel investment']
  };

  private constructor() {}

  public static getInstance(): DataLoader {
    if (!DataLoader.instance) {
      DataLoader.instance = new DataLoader();
    }
    return DataLoader.instance;
  }

  private preprocessText(text: string): string {
    if (!text) return '';
    
    // Preserve common business terms and patterns before general cleaning
    const preservePatterns = {
      numbers: /\$?\d+(?:\.\d+)?[KMBkmb]?\b/g,  // Matches $5M, 10K, etc.
      businessTerms: /\b(?:409a|b2b|b2c|saas|roi|cac|ltv|arpu|ebitda|ipo)\b/gi,  // Common business terms
      versions: /v\d+(?:\.\d+)*(?:-[a-z]+)?/gi,  // v1.0, v2.0-beta
      percentages: /\d+%/g,
    };

    // Create a map of preserved terms and their placeholders
    const preserved = new Map<string, string>();
    let processedText = text;

    // Preserve patterns by replacing with placeholders
    Object.entries(preservePatterns).forEach(([type, pattern]) => {
      processedText = processedText.replace(pattern, (match) => {
        const placeholder = `__${type}_${preserved.size}__`;
        preserved.set(placeholder, match);
        return placeholder;
      });
    });

    // Apply standard text cleaning
    processedText = processedText
      .replace(/\s+/g, ' ')  // Normalize whitespace
      .replace(/[.,!?;:'"]/g, ' ')  // Convert punctuation to spaces
      .replace(/\(|\)/g, ' ')  // Convert parentheses to spaces
      .trim()
      .toLowerCase();

    // Restore preserved terms
    preserved.forEach((original, placeholder) => {
      processedText = processedText.replace(placeholder, original.toLowerCase());
    });

    // Add mapped variations
    const normalized = processedText.toLowerCase();
    Object.entries(DataLoader.SEARCH_TERM_MAPPINGS).forEach(([key, variations]) => {
      if (variations.some(v => normalized.includes(v))) {
        processedText = `${processedText} ${key}`;
      }
    });

    return processedText;
  }

  private validateSearchEntry(entry: SearchAdviceEntry): boolean {
    const isValid = !!(
      entry?.advice?.trim() &&
      entry?.category?.trim() &&
      entry?.subCategory?.trim() &&
      entry?.rawAdvice &&
      entry?.rawAdviceContext !== undefined
    );

    if (!isValid) {
      console.warn('Invalid search entry:', {
        hasAdvice: !!entry?.advice,
        hasCategory: !!entry?.category,
        hasSubCategory: !!entry?.subCategory,
        hasRawAdvice: !!entry?.rawAdvice,
        hasRawContext: entry?.rawAdviceContext !== undefined
      });
    }

    return isValid;
  }

  private readAndCleanFile(filePath: string): string {
    const content = fs.readFileSync(filePath, { encoding: 'utf-8' });
    return content
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();
  }

  public async loadData(filePath: string): Promise<void> {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const cleanedContent = this.readAndCleanFile(filePath);
      
      const parseResult = Papa.parse(cleanedContent, {
        header: true,
        skipEmptyLines: true,
      });

      if (parseResult.errors.length > 0) {
        console.warn('CSV parsing warnings:', parseResult.errors);
      }

      if (!parseResult.data || parseResult.data.length === 0) {
        throw new Error('No data parsed from CSV');
      }

      const processedEntries: SearchAdviceEntry[] = [];
      let skippedRows = 0;
      let invalidRows = 0;

      for (const row of parseResult.data) {
        if (!isValidRawRow(row)) {
          invalidRows++;
          continue;
        }

        try {
          const entry: SearchAdviceEntry = {
            category: row.Category.trim(),
            subCategory: row.SubCategory.trim(),
            advice: this.preprocessText(row.Advice),
            adviceContext: this.preprocessText(row.AdviceContext),
            sourceTitle: row.SourceTitle.trim(),
            sourceType: row.SourceType.trim(),
            sourceLink: row.SourceLink.trim(),
            msgSourceTitle: row.MsgSourceTitle?.trim(),
            sourceSummary: row.SourceSummary?.trim(),
            rawAdvice: row.Advice,
            rawAdviceContext: row.AdviceContext
          };

          if (this.validateSearchEntry(entry)) {
            processedEntries.push(entry);
          } else {
            skippedRows++;
          }
        } catch (err) {
          console.error('Error processing row:', { row, error: err });
          skippedRows++;
        }
      }

      console.log('Data Processing Summary:', {
        totalRows: parseResult.data.length,
        validEntries: processedEntries.length,
        invalidRows,
        skippedRows,
        processingRate: `${((processedEntries.length / parseResult.data.length) * 100).toFixed(1)}%`
      });

      if (processedEntries.length === 0) {
        throw new Error('No valid entries found after processing');
      }

      this.adviceData = processedEntries;

      const processed = this.getData();
      if (processed.length > 0) {
        const sampleProcessed = processed[0];
        console.log('Format Validation:', {
          hasRequiredFields: Object.keys(sampleProcessed).sort().join(','),
          maintainsFormat: Object.keys(sampleProcessed).length === 7 && 
            'advice' in sampleProcessed &&
            'category' in sampleProcessed &&
            'subCategory' in sampleProcessed
        });
      }

    } catch (error) {
      const err = error as Error;
      console.error('Data loading error:', {
        message: err.message,
        stack: err.stack,
        type: err.name
      });
      throw new Error(`Failed to load advice data: ${err.message}`);
    }
  }

  public getData(): AdviceEntry[] {
    // Return processed version for vector search and chat
    const processed = this.adviceData.map(entry => {
      const processedEntry = {
        category: entry.category,
        subCategory: entry.subCategory,
        advice: entry.advice,
        adviceContext: entry.adviceContext,
        sourceTitle: entry.sourceTitle,
        sourceType: entry.sourceType,
        sourceLink: entry.sourceLink,
        msgSourceTitle: entry.msgSourceTitle,
        sourceSummary: entry.sourceSummary,
      };

      return processedEntry;
    });

    // Validate processed data
    console.log('getData Validation:', {
      totalEntries: processed.length,
      sampleEntry: processed[0] ? Object.keys(processed[0]).sort().join(',') : 'no entries',
      maintainsFormat: processed.every(entry => 
        Object.keys(entry).length >= 7 && // Allow for optional msgSourceTitle
        'advice' in entry &&
        'category' in entry &&
        'subCategory' in entry
      )
    });

    return processed;
  }

  public getCategories(): string[] {
    return [...new Set(this.adviceData.map(entry => entry.category))].sort();
  }

  public getSubCategories(): string[] {
    return [...new Set(this.adviceData.map(entry => entry.subCategory))].sort();
  }

  public getRawAdviceByProcessed(processedAdvice: string, processedContext: string): { rawAdvice: string; rawAdviceContext: string } | undefined {
    const entry = this.adviceData.find(e => 
      e.advice === processedAdvice && 
      e.adviceContext === processedContext
    );

    if (!entry) {
      return undefined;
    }

    return {
      rawAdvice: entry.rawAdvice,
      rawAdviceContext: entry.rawAdviceContext
    };
  }

  private calculateCounts(): { categoryCounts: Record<string, number>, subCategoryCounts: Record<string, number> } {
    const categoryCounts: Record<string, number> = {};
    const subCategoryCounts: Record<string, number> = {};

    this.adviceData.forEach(entry => {
      // Count categories
      categoryCounts[entry.category] = (categoryCounts[entry.category] || 0) + 1;
      
      // Count subcategories
      subCategoryCounts[entry.subCategory] = (subCategoryCounts[entry.subCategory] || 0) + 1;
    });

    return { categoryCounts, subCategoryCounts };
  }

  public searchAdvice(params: {
    query?: string;
    category?: string;
    subCategory?: string;
    page: number;
    pageSize: number;
  }): {
    entries: SearchAdviceEntry[];
    total: number;
    from: number;
    to: number;
    totalPages: number;
    categories: string[];
    subCategories: string[];
    categoryCounts: Record<string, number>;
    subCategoryCounts: Record<string, number>;
  } {
    const { query, category, subCategory, page, pageSize } = params;
    
    let filtered = [...this.adviceData];

    // Apply filters using processed text for search with weighted scoring
    if (query) {
      const searchTerm = this.preprocessText(query).toLowerCase();
      const terms = searchTerm.split(' ').filter(term => term.length > 0);
      
      // Score and filter entries
      const scoredEntries = filtered.map(entry => {
        let score = 0;
        let hasMatch = false;

        // Check for exact phrase match first if multiple terms
        if (terms.length > 1 && (
          entry.advice.toLowerCase().includes(searchTerm) || 
          entry.adviceContext.toLowerCase().includes(searchTerm)
        )) {
          score += 2; // Bonus for exact phrase match
          hasMatch = true;
        }

        // Then score individual terms
        for (const term of terms) {
          // Content match (3x weight)
          if (entry.advice.toLowerCase().includes(term) || 
              entry.adviceContext.toLowerCase().includes(term)) {
            score += 3;
            hasMatch = true;
          }
          
          // Category/SubCategory match (1x weight)
          if (entry.category.toLowerCase().includes(term) || 
              entry.subCategory.toLowerCase().includes(term)) {
            score += 1;
            hasMatch = true;
          }
        }

        return { entry, score, hasMatch };
      });

      // Filter out non-matches and sort by score
      filtered = scoredEntries
        .filter(item => item.hasMatch)
        .sort((a, b) => b.score - a.score)
        .map(item => item.entry);
    }

    // Apply category and subcategory filters (unchanged)
    if (category) {
      filtered = filtered.filter(entry => entry.category === category);
    }

    if (subCategory) {
      filtered = filtered.filter(entry => entry.subCategory === subCategory);
    }

    // Calculate pagination (unchanged)
    const total = filtered.length;
    const totalPages = Math.ceil(total / pageSize);
    const from = (page - 1) * pageSize;
    const to = Math.min(from + pageSize, total);

    // Get counts
    const { categoryCounts, subCategoryCounts } = this.calculateCounts();

    return {
      entries: filtered.slice(from, to),
      total,
      from: from + 1,
      to,
      totalPages,
      categories: this.getCategories(),
      subCategories: this.getSubCategories(),
      categoryCounts,
      subCategoryCounts,
    };
  }
}