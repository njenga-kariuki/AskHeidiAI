const path = require('path');

// Import the initializeSystem function from claude.js
// Note: We need to use require syntax for JavaScript
const { initializeSystem } = require('../services/claude');

// Force regeneration of embeddings
(async () => {
  try {
    console.log('Starting forced embedding regeneration...');
    const csvPath = path.join(process.cwd(), 'server/data/advice.csv');
    await initializeSystem(csvPath);
    console.log('Embedding regeneration complete!');
    process.exit(0);
  } catch (error) {
    console.error('Error during regeneration:', error);
    process.exit(1);
  }
})(); 