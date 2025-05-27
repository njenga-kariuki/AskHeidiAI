import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { generateStage1Response, generateStage2Response } from "./services/claude";
import { insertMessageSchema, feedbackSchema, searchResponseSchema } from "@shared/schema";
import { ZodError } from "zod";
import path from 'path';
import fs from 'fs';
import { DataLoader } from "./services/dataLoader";
import crypto from 'crypto';

export function registerRoutes(app: Express): Server {
  app.get('/health', (req, res) => {
    const healthFile = path.join(process.cwd(), 'health.txt');
    try {
      // Check if health file exists and is recent
      const stats = fs.statSync(healthFile);
      const lastUpdate = new Date(stats.mtime);
      const isRecent = (Date.now() - lastUpdate.getTime()) < 120000; // 2 minutes
      
      if (!isRecent) {
        throw new Error('Health check file is stale');
      }
      
      res.status(200).json({
        status: 'healthy',
        lastUpdate: lastUpdate.toISOString(),
        uptime: process.uptime()
      });
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.post("/api/chat", async (req, res) => {
    const requestId = crypto.randomUUID();
    console.log(`[${requestId}] Starting chat request`);

    try {
      const { query } = insertMessageSchema.parse(req.body);
      console.log(`[${requestId}] Validated query:`, query);
      
      // Create initial message
      const message = await storage.createMessage({ query });
      console.log(`[${requestId}] Created message:`, message.id);
      
      res.json({ messageId: message.id });
    } catch (error) {
      console.error(`[${requestId}] Error creating message:`, error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMsg });
    }
  });

  app.get("/api/chat/stream", async (req, res) => {
    const requestId = crypto.randomUUID();
    console.log(`[${requestId}] Starting chat stream`);
    
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Handle client disconnect
    req.on('close', () => {
      console.log(`[${requestId}] Client disconnected`);
    });

    try {
      // Get the latest message from storage
      const messages = await storage.getLatestMessages(1);
      if (!messages.length) {
        throw new Error('No message found to process');
      }
      const message = messages[0];
      
      console.log(`[${requestId}] Processing message:`, message.id);

      // Send message ID to client
      res.write(`data: ${JSON.stringify({ type: 'init', messageId: message.id })}\n\n`);

      // Stage 1: Generate response (not streamed to client)
      console.log(`[${requestId}] Starting Stage 1 generation`);
      const stage1Response = await generateStage1Response(message.query);
      console.log(`[${requestId}] Completed Stage 1`);
      
      await storage.updateMessage(message.id, { stage1Response });

      // Stage 2: Stream style transformation
      console.log(`[${requestId}] Starting Stage 2 streaming`);
      const stage2Stream = await generateStage2Response(stage1Response, message.query);
      const iterator = stage2Stream[Symbol.asyncIterator]();

      let finalResponse = '';
      try {
        while (true) {
          const { value: chunk, done } = await iterator.next();
          if (done) break;
          
          if (chunk) {
            finalResponse += chunk;
            res.write(`data: ${JSON.stringify({ 
              type: 'content', 
              content: chunk 
            })}\n\n`);
          }
        }
      } catch (streamError) {
        console.error(`[${requestId}] Stream processing error:`, streamError);
        throw streamError;
      }

      // Update storage with final response
      const updatedMessage = await storage.updateMessage(message.id, { finalResponse });
      
      // Send completion event with updated message
      res.write(`data: ${JSON.stringify({ type: 'complete', message: updatedMessage })}\n\n`);
      res.end();
      console.log(`[${requestId}] Request completed successfully`);

    } catch (error) {
      console.error(`[${requestId}] Error processing request:`, error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      res.write(`data: ${JSON.stringify({ type: 'error', error: errorMsg })}\n\n`);
      res.end();
    }
  });

  app.post("/api/chat/:id/feedback", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const feedback = feedbackSchema.parse(req.body);

      const message = await storage.updateMessage(id, feedback);
      res.json(message);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ message: "Invalid feedback data" });
      } else {
        res.status(500).json({ message: "Failed to save feedback" });
      }
    }
  });

  app.get("/api/advice/search", async (req, res) => {
    try {
      const dataLoader = DataLoader.getInstance();
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = 10;

      const searchResults = dataLoader.searchAdvice({
        query: req.query.q as string,
        category: req.query.category as string,
        subCategory: req.query.subCategory as string,
        page,
        pageSize,
      });

      const response = {
        ...searchResults,
        categories: dataLoader.getCategories(),
        subCategories: dataLoader.getSubCategories(),
      };

      // Validate response matches schema
      const validated = searchResponseSchema.parse(response);
      res.json(validated);
    } catch (error) {
      console.error("Search request error:", error);
      res.status(500).json({ message: "Failed to process search request" });
    }
  });

  app.get("/api/reports/chat-analysis", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 25, 150);
      const format = (req.query.format as string)?.toLowerCase() || 'html';
      const showFeedback = req.query.showFeedback === 'true';
      const currentView = (req.query.view as string) || 'detailed'; // Default to detailed view
      
      // --- Overview Stats Calculation ---
      // Fetch ALL completed messages for overview stats
      const allCompletedMessages = (await storage.getAllMessages()) // Use getAllMessages() instead of getLatestMessages(Infinity)
        .filter(msg => msg.stage1Response && msg.finalResponse);

      const now = new Date();
      const intervals = {
        day: Array(7).fill(0), // Trailing 7 days by day
        week: 0,              // Trailing week total
        twoWeeks: 0,          // Trailing 2 week total
        month: 0,             // Trailing month total
        threeMonths: 0,       // Trailing 3 month total
        lifetime: allCompletedMessages.length, // Total lifetime is just the count
      };
      const confidenceCounts = {
        high_confidence: 0,
        medium_confidence: 0,
        low_confidence: 0,
        unknown: 0,
      };

      const oneDayMs = 24 * 60 * 60 * 1000;
      const sevenDaysAgo = new Date(now.getTime() - 7 * oneDayMs);
      const fourteenDaysAgo = new Date(now.getTime() - 14 * oneDayMs);
      const oneMonthAgo = new Date(now);
      oneMonthAgo.setMonth(now.getMonth() - 1);
      const threeMonthsAgo = new Date(now);
      threeMonthsAgo.setMonth(now.getMonth() - 3);

      allCompletedMessages.forEach(msg => {
        const createdAt = msg.createdAt ? new Date(msg.createdAt) : null;
        if (!createdAt) return; // Skip if no creation date

        // Time Interval Calculations
        const diffDays = Math.floor((now.getTime() - createdAt.getTime()) / oneDayMs);
        if (diffDays < 7) {
          intervals.day[6 - diffDays]++; // Index 0 is 6 days ago, index 6 is today
          intervals.week++;
        }
        if (diffDays < 14) {
          intervals.twoWeeks++;
        }
        if (createdAt >= oneMonthAgo) {
          intervals.month++;
        }
        if (createdAt >= threeMonthsAgo) {
          intervals.threeMonths++;
        }

        // Confidence Level Calculation
        const level = msg.metadata?.confidenceAnalysis?.level || 'unknown';
        if (confidenceCounts.hasOwnProperty(level)) {
          confidenceCounts[level]++;
        } else {
          confidenceCounts.unknown++; // Fallback for unexpected levels
        }
      });
      // --- End Overview Stats Calculation ---


      // --- Original Logic for Table View (potentially limited & filtered) ---
      // Get potentially limited messages for the table/CSV view
      const messagesForTable = (await storage.getLatestMessages(limit));

      // Initial filter for completed responses for the table view
      let filteredMessages = messagesForTable.filter(msg =>
        msg.stage1Response && msg.finalResponse
      );

      // Further filter if feedback view is selected for the table view
      if (currentView === 'feedback') {
        filteredMessages = filteredMessages.filter(msg => 
          // Include if thumbsUp is not null OR feedback text exists
          msg.thumbsUp !== null || (msg.feedback && msg.feedback.trim() !== '')
        );
      }

      if (format === 'csv') {
        // Handle Question Only View for CSV
        if (currentView === 'question_only') {
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', 'attachment; filename=chat-analysis-questions.csv');
          
          // CSV header for Question Only view
          res.write('Timestamp,Query,Confidence_Level\n');
          
          filteredMessages.forEach(message => {
            const timestamp = message.createdAt?.toISOString() || '';
            const query = message.query.replace(/"/g, '""');
            const confidenceLevel = message.metadata?.confidenceAnalysis?.level || 'unknown';
            
            // Construct and write the CSV row
            const row = [
              `"${timestamp}"`,
              `"${query}"`,
              `"${confidenceLevel}"`
            ];
            res.write(row.join(',') + '\n');
          });
          
          res.end();
          return; // End response here for question_only CSV
        } 

        // Existing CSV logic for other views
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=chat-analysis.csv');
        
        // CSV header - adjust based on max number of prompt entries (up to 8)
        let header = 'Timestamp,Query';
        const MAX_PROMPT_ENTRIES_CSV = 8; // Define max columns for consistency if needed
        for (let i = 1; i <= MAX_PROMPT_ENTRIES_CSV; i++) {
          header += `,Advice_${i}_Category_Source,Advice_${i}_Content`;
        }
        // Always include Feedback column in CSV header
        header += ',Stage_1_Response,Final_Response,Thumbs_Up,Feedback\n'; 
        
        res.write(header);
        
        filteredMessages.forEach(message => {
          const timestamp = message.createdAt?.toISOString() || '';
          const query = message.query.replace(/"/g, '""');
          
          // Use promptEntries if available, otherwise fall back gracefully
          // For CSV, we still need a consistent structure, maybe leave blank or use displayEntries?
          // Let's prioritize promptEntries and leave blank if not present for CSV consistency.
          const adviceForCSV = message.metadata?.promptEntries || [];

          const stage1Response = (message.stage1Response || '').replace(/"/g, '""');
          const finalResponse = (message.finalResponse || '').replace(/"/g, '""');
          const thumbsUp = message.thumbsUp === null ? '' : message.thumbsUp.toString();
          const feedback = (message.feedback || '').replace(/"/g, '""');
          
          // Combine all fields with proper CSV escaping
          const row = [
            `"${timestamp}"`,
            `"${query}"`
          ];
          
          // Add advice entries from promptEntries (up to MAX_PROMPT_ENTRIES_CSV)
          adviceForCSV.slice(0, MAX_PROMPT_ENTRIES_CSV).forEach(entry => {
            const categorySource = `${entry.entry.category} | ${entry.entry.sourceTitle}`;
            const content = `${entry.entry.advice} - ${entry.entry.adviceContext}`;
            row.push(`"${categorySource.replace(/"/g, '""')}"`);
            row.push(`"${content.replace(/"/g, '""').replace(/\n/g, ' ')}"`);
          });
          
          // Pad with empty entries if less than MAX_PROMPT_ENTRIES_CSV
          const emptyEntriesNeeded = MAX_PROMPT_ENTRIES_CSV - adviceForCSV.length;
          for (let i = 0; i < emptyEntriesNeeded * 2; i++) {
            row.push('""');
          }
          
          // Add remaining fields (Remove Other_Advice_Count)
          row.push(`"${stage1Response}"`);
          row.push(`"${finalResponse}"`);
          row.push(`"${thumbsUp}"`);
          
          // Always add feedback to CSV row
          row.push(`"${feedback}"`);
          
          res.write(row.join(',') + '\n');
        });
        
        res.end();
      } else {
        res.setHeader('Content-Type', 'text/html');
        
        res.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Chat Analysis Report</title>
            <style>
              body { 
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
                margin: 20px; 
                max-width: 1400px; 
                margin: 20px auto; 
                line-height: 1.5; /* Slightly increased line height */
                color: #212529; /* Darker gray for text */
                background-color: #f8f9fa; /* Light background for body */
              }
              table { 
                border-collapse: collapse; 
                width: 100%; 
                margin-top: 20px; /* Increased margin */
                box-shadow: none; /* Removed shadow */
                border: 1px solid #dee2e6; /* Lighter table border */
                border-spacing: 0;
              }
              th, td { 
                border: none; /* Remove cell borders initially */
                border-bottom: 1px solid #dee2e6; /* Use bottom borders for rows */
                padding: 16px; /* Increased padding */
                text-align: left; 
                vertical-align: top; 
              }
              tr:last-child td { 
                border-bottom: none; /* No border for last row */
              } 
              th { 
                background-color: #e9ecef; /* Lighter header */
                font-weight: 600;
                border-bottom-width: 2px; /* Thicker bottom border for header */
              }
              tr:nth-child(even) { 
                background-color: #ffffff; /* White background for even rows */
              } 
              tr:nth-child(odd) { 
                background-color: #f8f9fa; /* Light gray for odd rows (matches body) */
              }
              .controls { 
                margin-bottom: 25px; 
                background-color: #ffffff; /* White background for controls */
                padding: 1rem 1.5rem; /* More padding */
                border-radius: 8px; /* Slightly larger radius */
                border: 1px solid #dee2e6; /* Add border */
                display: flex; /* Use flexbox for alignment */
                align-items: center;
                gap: 15px; /* Spacing between control items */
              }
              .download-btn { 
                background-color: #0d6efd; /* Bootstrap primary blue */ 
                color: white; 
                padding: 0.5rem 1rem; 
                text-decoration: none; 
                border-radius: 4px; 
                border: none;
                font-weight: 500;
                display: inline-block;
                transition: background-color 0.15s ease-in-out;
              }
              .download-btn:hover {
                background-color: #0b5ed7; /* Darker blue on hover */
              }
              .limit-select { 
                padding: 0.4rem 0.8rem; 
                border-radius: 4px;
                border: 1px solid #ced4da;
                background-color: #fff;
              }
              .view-radio {
                margin-right: 5px; /* Reduced margin */
                display: inline-flex;
                align-items: center;
              }
              .view-radio input[type="radio"] {
                margin-right: 5px;
              }
              .view-indicator {
                display: none;
                margin: -10px 0 15px 0; /* Adjust margin */
                padding: 0.5rem 1rem;
                background-color: #e2f0fb; /* Light blue indicator */
                border: 1px solid #cfe2ff; /* Blue border */
                border-radius: 4px;
                color: #0a58ca; /* Blue text */
                font-weight: 500; /* Slightly bolder */
                text-align: center;
              }
              .hidden-section {
                display: none;
              }
              /* Section Styling */
              .query-section,
              .advice-section,
              .response-section,
              .feedback-section { /* Added feedback-section here */
                margin-bottom: 1rem; 
                padding: 1rem; 
                border: 1px solid #e9ecef; /* Lighter border */
                border-radius: 6px;
                background-color: #ffffff; /* White background for sections */
              }
              .query-section { /* Specific style for query section */
                 border-left: 4px solid #6c757d; /* Gray left border */
                 padding-left: 1.25rem;
              }
               .advice-section { /* Specific style for advice section */
                 border-left: 4px solid #ffc107; /* Yellow left border */
                 padding-left: 1.25rem;
              }
              .stage1-response { /* Specific style for stage1 */
                 border-left: 4px solid #adb5bd; /* Lighter Gray left border */
                 padding-left: 1.25rem;
              }
              .final-response { /* Specific style for final */
                 border-left: 4px solid #198754; /* Green left border */
                 padding-left: 1.25rem;
              }
              .feedback-section { /* Specific style for feedback */
                 border-left: 4px solid #0dcaf0; /* Cyan left border */
                 padding-left: 1.25rem;
                 margin-top: 1rem; /* Ensure margin top */
                 padding-top: 1rem; /* Ensure padding top */
                 border-top: none; /* Remove duplicate top border */
              }

              .query-timestamp {
                color: #6c757d; /* Bootstrap secondary text color */
                font-size: 0.85em;
                margin-bottom: 5px;
              }
              .query-text {
                font-size: 1.1em; /* Slightly smaller */
                color: #212529;
                margin-bottom: 0;
                font-weight: 500;
                padding: 0; /* Remove internal padding/background */
                background-color: transparent;
                border-radius: 0;
                border-left: none;
              }
               .query-confidence {
                  margin-top: 8px; 
                  font-size: 0.85em;
                  color: #6c757d;
               }
               .query-confidence strong { font-weight: 600; } 
               .text-green-700 { color: #198754; } /* Match Bootstrap success */
               .text-yellow-700 { color: #ffc107; } /* Match Bootstrap warning */
               .text-red-700 { color: #dc3545; } /* Match Bootstrap danger */
               .text-gray-500 { color: #6c757d; } /* Match Bootstrap secondary */

              .advice-title,
              .response-title {
                font-weight: 600; /* Bolder titles */
                color: #212529;
                margin-bottom: 0.75rem;
                font-size: 1.05em; /* Slightly smaller */
                padding-bottom: 0.5rem;
                border-bottom: 1px solid #dee2e6;
              }
              .advice-block {
                margin-bottom: 0.75rem;
                padding: 0.75rem;
                border: 1px solid #e9ecef;
                border-radius: 4px;
                background-color: #f8f9fa; /* Light background for blocks */
                box-shadow: none;
              }
               .advice-block:last-child {
                  margin-bottom: 0;
               }
              .advice-rank {
                font-weight: 500; /* Normal weight */
                color: #6c757d;
                display: inline-block;
                margin-right: 8px;
                background-color: #e9ecef; /* Lighter background */
                padding: 2px 6px;
                border-radius: 3px;
                font-size: 0.8em; /* Smaller */
              }
              .advice-metadata {
                color: #6c757d;
                font-size: 0.85em; /* Smaller */
                display: inline-block;
              }
              .advice-content { 
                margin: 8px 0 0 0; /* Reduced margin */
              }
              .advice-text {
                color: #212529;
                display: block;
                margin-bottom: 5px;
              }
              .advice-context {
                color: #6c757d;
                font-style: italic;
                display: block;
                border-left: 2px solid #dee2e6;
                padding-left: 10px;
                margin-top: 5px;
                font-size: 0.95em;
              }
              .response-content {
                white-space: pre-wrap;
                color: #212529;
                line-height: 1.5;
                padding: 0; /* Remove extra padding */
                background-color: transparent;
                border-radius: 0;
                border: none;
              }
              /* Removed feedback-indicator styles as it's no longer used */

              /* View-specific styles (Screen) */
              body.view-simplified .advice-section,
              body.view-simplified .stage1-response {
                display: none;
              }
              body.view-feedback .advice-section,
              body.view-feedback .stage1-response {
                display: none;
              }
              /* Detailed and Stage views show all by default, JS handles fine-tuning if needed */

              /* CSS for Question Only View */
              body.view-question_only .advice-section,
              body.view-question_only .stage1-response, /* Target specific class */
              body.view-question_only .final-response,  /* Target specific class */
              body.view-question_only .feedback-section {
                display: none;
              }
              /* Detailed and Stage views show all by default, CSS handles hiding for others */

              /* CSS for Overview View */
              #overview-section {
                  padding: 1rem 1.5rem;
                  border: 1px solid #dee2e6;
                  border-radius: 8px;
                  background-color: #ffffff;
                  margin-bottom: 25px;
              }
              #overview-section h2 {
                margin-top: 0;
                margin-bottom: 1rem;
                font-size: 1.4em;
                border-bottom: 1px solid #dee2e6;
                padding-bottom: 0.5rem;
              }
              #overview-section h3 {
                 margin-top: 1.5rem;
                 margin-bottom: 0.5rem;
                 font-size: 1.1em;
              }
              #overview-section ul {
                 list-style: none;
                 padding-left: 0;
              }
              #overview-section li {
                 margin-bottom: 0.3rem;
                 color: #495057; /* Slightly darker gray */
              }
               #overview-section li strong {
                 color: #212529; /* Darker text for numbers */
                 min-width: 40px; /* Align numbers slightly */
                 display: inline-block;
                 text-align: right;
                 margin-right: 10px;
               }

              body.view-overview table { /* Hide table in overview */
                  display: none;
              }
              body:not(.view-overview) #overview-section { /* Hide overview section unless view=overview */
                  display: none;
              }

              @media print {
                @page {
                  margin: 0.4cm;
                  size: auto;
                }
                body {
                  margin: 0;
                  padding: 0;
                  max-width: none;
                  font-size: 9pt;
                  color: black;
                  line-height: 1.3;
                }
                .controls {
                  display: none;
                }
                .no-print {
                  display: none !important;
                }
                table {
                  border-collapse: collapse;
                  width: 100%;
                  box-shadow: none;
                }
                table, td {
                  border-color: #999;
                }
                td {
                  border-top: none;
                  padding: 8px;
                }
                thead {
                  display: none;
                }
                tr {
                  break-inside: avoid;
                  page-break-inside: avoid;
                }
                table {
                  -webkit-print-color-adjust: exact;
                  print-color-adjust: exact;
                }
                th { 
                  background-color: #f4f4f4 !important;
                }
                thead {
                  display: table-header-group;
                  break-inside: avoid;
                }
                thead tr {
                  break-inside: avoid;
                  break-after: avoid;
                }
                thead th {
                  position: static !important;
                }
                .query-text {
                  font-size: 10pt;
                  padding: 5px;
                  background-color: #f8f9fa !important;
                  border-left-color: #2c3e50 !important;
                }
                .advice-block {
                  border-color: #ccc;
                  box-shadow: none;
                  margin-bottom: 8px;
                  padding: 8px;
                }
                .response-section {
                  background-color: #f8f9fa !important;
                  border-left-color: #999 !important;
                  padding: 8px;
                  margin: 10px 0;
                }
                .final-response {
                  background-color: #f1f8f1 !important;
                  border-left-color: #4CAF50 !important;
                }
                .stage1-response {
                  background-color: #f8f9fa !important;
                  border-left-color: #6c757d !important;
                }
                .selected-advice-section {
                  background-color: #f1f8f1 !important;
                  border-left-color: #4CAF50 !important;
                  padding: 8px;
                  margin: 10px 0;
                  display: none !important;
                }
                .other-advice-section {
                  background-color: #fff8f0 !important;
                  border-left-color: #FFA500 !important;
                  padding: 8px;
                  margin: 10px 0;
                  display: none !important;
                }
                .advice-section {
                  background-color: #f8f9fa !important;
                  padding: 8px;
                  margin: 10px 0;
                  display: block !important;
                }
                .stage1-response {
                  display: block !important;
                }
                .final-response {
                  display: block !important;
                }
                .response-content {
                  background-color: white !important;
                  border-color: #ccc !important;
                }
                .advice-rank {
                  background-color: #f4f4f4 !important;
                }
                .advice-context {
                  border-left-color: #ccc !important;
                }
                .feedback-indicator {
                  border-top-color: #ccc !important;
                }
                h1 {
                  font-size: 16pt;
                  margin-bottom: 10px;
                }
                a {
                  color: #000 !important;
                  text-decoration: underline;
                }

                /* Print CSS for Question Only View */
                body.view-question_only .advice-section,
                body.view-question_only .stage1-response,
                body.view-question_only .final-response,
                body.view-question_only .feedback-section {
                   display: none !important;
                }
                /* Print CSS for Simplified View */
                body.view-simplified .advice-section,
                body.view-simplified .stage1-response,
                body.view-simplified .feedback-section {
                   display: none !important;
                }
                /* Ensure necessary sections are displayed for other print views */
                body.view-simplified .final-response {
                  display: block !important;
                }
              </style>
          </head>
          <body>
            <h1>Ask Heidi AI Chat Analysis</h1>
            <div class="controls">
              <a href="?format=csv${req.query.limit ? '&limit=' + req.query.limit : ''}${req.query.view ? '&view=' + req.query.view : ''}" class="download-btn">Download CSV</a>
              <select class="limit-select" onchange="updateQueryParam('limit', this.value)">
                <option value="25" ${limit === 25 ? 'selected' : ''}>Last 25</option>
                <option value="50" ${limit === 50 ? 'selected' : ''}>Last 50</option>
                <option value="100" ${limit === 100 ? 'selected' : ''}>Last 100</option>
                <option value="150" ${limit === 150 ? 'selected' : ''}>Last 150</option>
              </select>
              <span style="margin-left: 20px; font-weight: bold;">View:</span>
              <label class="view-radio">
                <input type="radio" name="reportView" value="simplified" onchange="updateQueryParam('view', this.value)" ${currentView === 'simplified' ? 'checked' : ''}>
                Simplified
              </label>
              <label class="view-radio">
                <input type="radio" name="reportView" value="detailed" onchange="updateQueryParam('view', this.value)" ${currentView === 'detailed' ? 'checked' : ''}>
                Detailed
              </label>
              <label class="view-radio">
                <input type="radio" name="reportView" value="feedback" onchange="updateQueryParam('view', this.value)" ${currentView === 'feedback' ? 'checked' : ''}>
                Feedback
              </label>
              <label class="view-radio">
                <input type="radio" name="reportView" value="question_only" onchange="updateQueryParam('view', this.value)" ${currentView === 'question_only' ? 'checked' : ''}>
                Question Only
              </label>
              <label class="view-radio">
                <input type="radio" name="reportView" value="overview" onchange="updateQueryParam('view', this.value)" ${currentView === 'overview' ? 'checked' : ''}>
                Overview
              </label>
            </div>
            <div id="viewIndicator" class="view-indicator"></div>
            <script>
              // Helper function to update URL query parameters and reload
              function updateQueryParam(key, value) {
                const url = new URL(window.location.href);
                if (value === false || value === '' || value === null) {
                  url.searchParams.delete(key);
                } else {
                  url.searchParams.set(key, value);
                }
                window.location.href = url.toString();
              }
              
              // Function to apply styles based on view (will be filled in next step)
              function applyViewStyles(view) {
                console.log("Applying styles for view:", view);
                // Add view class to body for CSS targeting (including print)
                document.body.className = 'view-' + view;
                
                const viewIndicator = document.getElementById('viewIndicator');
                let indicatorText = '';

                // Rely purely on CSS classes added to body tag for hiding/showing sections

                // Set indicator text
                if (view === 'simplified') indicatorText = 'Simplified View: Query & Final Response';
                else if (view === 'detailed') indicatorText = 'Detailed View: Query, Advice, Stage 1, Final Response';
                else if (view === 'feedback') indicatorText = 'Feedback View: Showing only entries with feedback text';
                else if (view === 'question_only') indicatorText = 'Question Only View: Query, Timestamp & Confidence';
                else if (view === 'overview') indicatorText = 'Overview: High-level Statistics';

                if (view !== 'detailed') { // Show indicator for non-default views
                  viewIndicator.textContent = indicatorText;
                  viewIndicator.style.display = 'block';
                } else {
                  viewIndicator.style.display = 'none';
                }
              }

              document.addEventListener('DOMContentLoaded', function() {
                const currentView = new URLSearchParams(window.location.search).get('view') || 'detailed';
                applyViewStyles(currentView);
              });
            </script>
            <!-- Overview Section -->
            <div id="overview-section">
              <h2>Chat Analysis Overview</h2>

              <h3>Question Quantity</h3>
              
              <h4>Daily Breakdown (Past 7 Days)</h4>
              <ul>
                ${intervals.day.slice().reverse().map((count, i) => {
                  const date = new Date(now.getTime() - i * oneDayMs);
                  const dateString = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' });
                  const dayName = date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Los_Angeles' });
                  return `<li>${dateString} (${dayName}): <strong>${count}</strong></li>`;
                }).join('')}
              </ul>

              <h4>Summary Totals</h4>
              <ul>
                <li>Past 7 Days Total: <strong>${intervals.week}</strong></li>
                <li>Past 14 Days Total: <strong>${intervals.twoWeeks}</strong></li>
                <li>Past Month Total: <strong>${intervals.month}</strong></li>
                <li>Past 3 Months Total: <strong>${intervals.threeMonths}</strong></li>
                <li>Total Lifetime: <strong>${intervals.lifetime}</strong></li>
              </ul>

              <h3>Questions by Confidence Level</h3>
               <ul>
                <li>High Confidence: <strong>${confidenceCounts.high_confidence}</strong></li>
                <li>Medium Confidence: <strong>${confidenceCounts.medium_confidence}</strong></li>
                <li>Low Confidence: <strong>${confidenceCounts.low_confidence}</strong></li>
                <li>Unknown: <strong>${confidenceCounts.unknown}</strong></li>
              </ul>
            </div>
            <!-- End Overview Section -->

            <table>
              <thead class="print-once">
                <tr>
                  <th class="no-print">Chat Analysis</th>
                </tr>
              </thead>
              <tbody>
        `);

        filteredMessages.forEach(message => {
          const timestamp = message.createdAt 
            ? new Date(message.createdAt).toLocaleDateString('en-US', { 
                year: 'numeric', month: 'short', day: 'numeric', 
                hour: 'numeric', minute: '2-digit', /* second: '2-digit', */
                timeZoneName: 'short', timeZone: 'America/Los_Angeles' 
              })
            : '';
          
          // Use promptEntries if available, otherwise use displayEntries for older messages
          const adviceEntries = message.metadata?.promptEntries || message.metadata?.displayEntries || [];
          // Determine title based on which data source was used
          const adviceTitle = message.metadata?.promptEntries 
            ? `Advice Sent to AI (${adviceEntries.length})` 
            : message.metadata?.displayEntries 
              ? `Top Advice Retrieved (${adviceEntries.length})` // Title for fallback
              : 'Advice Data Unavailable';
          
          // Generate HTML for the advice items (use rank for displayEntries fallback)
          const adviceHtml = adviceEntries.map((entry, index) => `
            <div class="advice-block">
              <div>
                <span class="advice-rank">
                  ${message.metadata?.promptEntries ? `Input ${index + 1}` : `Rank ${index + 1}`} (Score: ${entry.similarity.toFixed(3)})
                </span>
                <span class="advice-metadata">${entry.entry.category} | ${entry.entry.sourceTitle}</span>
              </div>
              <div class="advice-content">
                <span class="advice-text">${entry.entry.advice}</span>
                <span class="advice-context"> - ${entry.entry.adviceContext}</span>
              </div>
            </div>
          `).join('') || '';

          const thumbsUp = message.thumbsUp === null ? '-' : (message.thumbsUp ? '👍' : '👎');
          
          // Extract confidence level for display
          const confidenceLevel = message.metadata?.confidenceAnalysis?.level || 'unknown';
          const confidenceText = confidenceLevel.split('_')[0].toUpperCase();
          const confidenceColorClass = 
            confidenceLevel === 'high_confidence' ? 'text-green-700' :
            confidenceLevel === 'medium_confidence' ? 'text-yellow-700' :
            confidenceLevel === 'low_confidence' ? 'text-red-700' :
            'text-gray-500';
          
          // Construct conditional feedback section HTML
          let feedbackSectionHtml = '';
          if (message.thumbsUp !== null || (message.feedback && message.feedback.trim() !== '')) {
            const feedbackCommentHtml = message.feedback && message.feedback.trim() !== '' 
              ? `<div><strong>Comment:</strong><div style="white-space: pre-wrap; margin-top: 4px;">${message.feedback}</div></div>` 
              : '';
            feedbackSectionHtml = `
              <div class="feedback-section" style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #eee;">
                 <h4 style="margin-bottom: 8px; font-weight: bold;">Feedback Provided:</h4>
                 <div><strong>Rating:</strong> ${thumbsUp}</div>
                 ${feedbackCommentHtml}
              </div>
            `;
          }

          // ---> MODIFICATION: Conditionally generate row HTML based on view
          if (currentView === 'question_only') {
            // Simplified row structure for Question Only view
            res.write(`
              <tr>
                <td style="padding: 10px 16px; line-height: 1.4;"> 
                  <span style="font-size: 0.85em; color: #6c757d; margin-right: 15px; white-space: nowrap;">${timestamp}</span>
                  <span style="font-size: 0.9em; margin-right: 15px; white-space: nowrap;">Confidence: <strong class="${confidenceColorClass}">${confidenceText}</strong></span>
                  <span style="font-weight: 500;">${message.query}</span> 
                </td>
              </tr>
            `);
          } else {
            // Existing detailed row structure for other views
            res.write(`
              <tr>
                <td>
                  <div class="query-section">
                    <div class="query-timestamp">${timestamp}</div>
                    <div class="query-text">${message.query}</div>
                    <div class="query-confidence" style="margin-top: 6px; font-size: 0.9em;">
                      Confidence: <strong class="${confidenceColorClass}">${confidenceText}</strong>
                    </div>
                  </div>
                  <div class="advice-section">
                    <div class="advice-title">${adviceTitle}</div>
                    ${adviceHtml}
                  </div>
                  <div class="response-section stage1-response">
                    <div class="response-title">Initial Response (Stage 1)</div>
                    <div class="response-content">${(message.stage1Response || '').replace(/[•â€¢]/g, '&#8226;')}</div>
                  </div>
                  <div class="response-section final-response">
                    <div class="response-title">Final Response (Stage 2)</div>
                    <div class="response-content">${(message.finalResponse || '').replace(/[•â€¢]/g, '&#8226;')}</div>
                  </div>
                  
                  ${feedbackSectionHtml}
                </td>
              </tr>
            `);
          }
          // ---> END MODIFICATION
        });

        res.write(`
              </tbody>
            </table>
          </body>
          </html>
        `);
        res.end();
      }
    } catch (error) {
      console.error('Error generating report:', error);
      res.status(500).json({ error: 'Failed to generate report' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}