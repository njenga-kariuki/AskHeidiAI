const fs = require('fs');
const path = require('path');
const { parse } = require('papaparse');

// Safe CSV validation - only checks structure without affecting system
(async () => {
  try {
    const csvPath = process.argv[2] || path.join(process.cwd(), 'server/data/advice.csv');
    console.log(`Validating CSV file: ${csvPath}`);
    
    if (!fs.existsSync(csvPath)) {
      throw new Error(`File not found: ${csvPath}`);
    }
    
    // Read file content
    const csvData = fs.readFileSync(csvPath, 'utf-8');
    
    // Parse CSV without any side effects
    const parseResult = parse(csvData, {
      header: true,
      skipEmptyLines: true,
    });
    
    if (parseResult.errors.length > 0) {
      console.warn('CSV parsing warnings:', parseResult.errors);
    }
    
    if (!parseResult.data || parseResult.data.length === 0) {
      throw new Error('No data parsed from CSV');
    }
    
    // Validate required columns
    const requiredColumns = ['Category', 'SubCategory', 'Advice', 'AdviceContext', 
                            'SourceTitle', 'SourceType', 'SourceLink'];
    
    const firstRow = parseResult.data[0];
    const missingColumns = requiredColumns.filter(col => !(col in firstRow));
    
    if (missingColumns.length > 0) {
      throw new Error(`Missing required columns: ${missingColumns.join(', ')}`);
    }
    
    // Count valid rows
    let validRows = 0;
    let invalidRows = 0;
    
    for (const row of parseResult.data) {
      if (requiredColumns.every(col => typeof row[col] === 'string' && row[col].trim() !== '')) {
        validRows++;
      } else {
        invalidRows++;
      }
    }
    
    console.log('CSV Validation Summary:');
    console.log(`- Total rows: ${parseResult.data.length}`);
    console.log(`- Valid rows: ${validRows}`);
    console.log(`- Invalid rows: ${invalidRows}`);
    console.log('CSV validation complete!');
    
    if (invalidRows > 0) {
      console.warn(`Warning: Found ${invalidRows} invalid rows in the CSV file.`);
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (error) {
    console.error('Error during validation:', error);
    process.exit(1);
  }
})(); 