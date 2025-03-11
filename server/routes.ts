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
      const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);
      const format = (req.query.format as string)?.toLowerCase() || 'html';
      const showFeedback = req.query.showFeedback === 'true';
      
      // Get messages and filter for complete ones
      const messages = (await storage.getLatestMessages(limit));
      const filteredMessages = messages.filter(msg => 
        msg.stage1Response && msg.finalResponse && msg.metadata?.displayEntries
      );

      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=chat-analysis.csv');
        
        // CSV header for up to 8 advice entries
        let header = 'Timestamp,Query';
        for (let i = 1; i <= 8; i++) {
          header += `,Advice_${i}_Category_Source,Advice_${i}_Content`;
        }
        header += ',Other_Advice_Count,Stage_1_Response,Final_Response,Thumbs_Up' + (showFeedback ? ',Feedback' : '') + '\n';
        
        res.write(header);
        
        filteredMessages.forEach(message => {
          const timestamp = message.createdAt?.toISOString() || '';
          const query = message.query.replace(/"/g, '""');
          
          // Enhanced advice display with ranking and scores
          const allAdvice = message.metadata?.displayEntries || [];
          
          // For the default view, just show the top entries (up to 8)
          // We don't have a way to know exactly which ones were used in the response
          const responseAdvice = allAdvice.slice(0, 8);
          const otherAdvice = allAdvice.slice(8);
          
          const selectedAdviceHtml = responseAdvice.map((entry, index) => `
            <div class="advice-block">
              <div>
                <span class="advice-rank">Rank ${index + 1}</span>
                <span class="advice-metadata">${entry.entry.category} | ${entry.entry.sourceTitle} - Score: ${entry.similarity.toFixed(3)}</span>
              </div>
              <div class="advice-content">
                <span class="advice-text">${entry.entry.advice}</span>
                <span class="advice-context"> - ${entry.entry.adviceContext}</span>
              </div>
            </div>
          `).join('') || '';
          
          const otherAdviceHtml = otherAdvice.map((entry, index) => `
            <div class="advice-block">
              <div>
                <span class="advice-rank">Rank ${allAdvice.indexOf(entry) + 1}</span>
                <span class="advice-metadata">${entry.entry.category} | ${entry.entry.sourceTitle} - Score: ${entry.similarity.toFixed(3)}</span>
              </div>
              <div class="advice-content">
                <span class="advice-text">${entry.entry.advice}</span>
                <span class="advice-context"> - ${entry.entry.adviceContext}</span>
              </div>
            </div>
          `).join('') || '';
          
          // Original combined advice display - show all response advice items
          const selectedAdviceOriginal = responseAdvice.map((entry, index) => `
            <div class="advice-block">
              <div>
                <span class="advice-rank">Rank ${index + 1}</span>
                <span class="advice-metadata">${entry.entry.category} | ${entry.entry.sourceTitle} - Score: ${entry.similarity.toFixed(3)}</span>
              </div>
              <div class="advice-content">
                <span class="advice-text">${entry.entry.advice}</span>
                <span class="advice-context"> - ${entry.entry.adviceContext}</span>
              </div>
            </div>
          `).join('') || '';

          const stage1Response = (message.stage1Response || '').replace(/"/g, '""');
          const finalResponse = (message.finalResponse || '').replace(/"/g, '""');
          const thumbsUp = message.thumbsUp === null ? '' : message.thumbsUp.toString();
          const feedback = (message.feedback || '').replace(/"/g, '""');
          
          // Combine all fields with proper CSV escaping
          const row = [
            `"${timestamp}"`,
            `"${query}"`
          ];
          
          // Add advice entries (up to 8 possible entries)
          responseAdvice.forEach(entry => {
            const categorySource = `${entry.entry.category} | ${entry.entry.sourceTitle}`;
            const content = `${entry.entry.advice} - ${entry.entry.adviceContext}`;
            row.push(`"${categorySource.replace(/"/g, '""')}"`);
            row.push(`"${content.replace(/"/g, '""').replace(/\n/g, ' ')}"`);
          });
          
          // Pad with empty entries if less than 8
          const emptyEntriesNeeded = 8 - responseAdvice.length;
          for (let i = 0; i < emptyEntriesNeeded * 2; i++) {
            row.push('""');
          }
          
          // Add remaining fields
          row.push(`"${otherAdvice.length}"`);
          row.push(`"${stage1Response}"`);
          row.push(`"${finalResponse}"`);
          row.push(`"${thumbsUp}"`);
          
          if (showFeedback) {
            row.push(`"${feedback}"`);
          }
          
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
                font-family: Arial, sans-serif; 
                margin: 20px; 
                max-width: 1400px; 
                margin: 20px auto; 
                line-height: 1.4;
                color: #333;
              }
              table { 
                border-collapse: collapse; 
                width: 100%; 
                margin-top: 15px; 
                box-shadow: 0 1px 3px rgba(0,0,0,0.1);
              }
              th, td { 
                border: 1px solid #ddd; 
                padding: 12px; 
                text-align: left; 
                vertical-align: top; 
              }
              th { background-color: #f4f4f4; }
              tr:nth-child(even) { background-color: #f9f9f9; }
              .controls { 
                margin-bottom: 20px; 
                background-color: #f8f9fa;
                padding: 15px;
                border-radius: 6px;
                box-shadow: 0 1px 2px rgba(0,0,0,0.05);
              }
              .download-btn { 
                background-color: #4CAF50; 
                color: white; 
                padding: 10px 20px; 
                text-decoration: none; 
                border-radius: 4px; 
                display: inline-block;
                margin-right: 10px;
                transition: background-color 0.2s;
              }
              .download-btn:hover {
                background-color: #45a049;
              }
              .limit-select { 
                padding: 8px; 
                margin-right: 10px; 
                border-radius: 4px;
                border: 1px solid #ddd;
              }
              .toggle-switch {
                display: inline-flex;
                align-items: center;
                margin-left: 10px;
                cursor: pointer;
                padding: 5px 10px;
                border-radius: 4px;
                transition: background-color 0.2s;
              }
              .toggle-switch:hover {
                background-color: #f0f0f0;
                text-decoration: none;
              }
              .toggle-switch input[type="checkbox"] {
                margin-right: 5px;
                transform: scale(1.2);
              }
              .toggle-switch input[type="checkbox"]:checked + span {
                font-weight: bold;
                color: #4CAF50;
              }
              .toggle-switch.active {
                background-color: #e8f5e9;
                border: 1px solid #4CAF50;
              }
              .view-indicator {
                display: none;
                margin-top: 10px;
                padding: 8px 12px;
                background-color: #e8f5e9;
                border-radius: 4px;
                color: #4CAF50;
                font-weight: bold;
                text-align: center;
              }
              .hidden-section {
                display: none;
              }
              .query-section {
                margin-bottom: 15px;
                padding-bottom: 10px;
                border-bottom: 2px solid #eee;
              }
              .query-timestamp {
                color: #666;
                font-size: 0.9em;
                margin-bottom: 3px;
              }
              .query-text {
                font-size: 1.2em;
                color: #2c3e50;
                margin-bottom: 6px;
                font-weight: 500;
                padding: 6px;
                background-color: #f8f9fa;
                border-radius: 4px;
                border-left: 3px solid #2c3e50;
              }
              .advice-section {
                margin-bottom: 15px;
                padding: 12px;
                background-color: #f8f9fa;
                border-radius: 6px;
              }
              .advice-title {
                font-weight: bold;
                color: #2c3e50;
                margin-bottom: 10px;
                font-size: 1.1em;
                padding-bottom: 5px;
                border-bottom: 1px solid #ddd;
              }
              .selected-advice-section {
                margin-bottom: 15px;
                padding: 12px;
                background-color: #f1f8f1;
                border-radius: 6px;
                border-left: 3px solid #4CAF50;
                display: none;
              }
              .other-advice-section {
                margin-bottom: 15px;
                padding: 12px;
                background-color: #fff8f0;
                border-radius: 6px;
                border-left: 3px solid #FFA500;
                display: none;
              }
              .advice-block {
                margin-bottom: 12px;
                padding: 10px;
                border: 1px solid #eee;
                border-radius: 4px;
                background-color: white;
                box-shadow: 0 1px 2px rgba(0,0,0,0.05);
              }
              .advice-rank {
                font-weight: bold;
                color: #666;
                display: inline-block;
                margin-right: 8px;
                background-color: #f4f4f4;
                padding: 2px 6px;
                border-radius: 3px;
                font-size: 0.9em;
              }
              .advice-metadata {
                color: #666;
                font-size: 0.9em;
                display: inline-block;
              }
              .advice-content { 
                margin: 10px 0;
              }
              .advice-text {
                color: #2c3e50;
                display: block;
                margin-bottom: 6px;
              }
              .advice-context {
                color: #666;
                font-style: italic;
                display: block;
                border-left: 2px solid #ddd;
                padding-left: 10px;
                margin-top: 6px;
              }
              .response-section {
                margin-top: 15px;
                margin-bottom: 15px;
                padding: 12px;
                background-color: #f8f9fa;
                border-radius: 6px;
                border-left: 3px solid #4CAF50;
              }
              .final-response {
                background-color: #f1f8f1;
                border-left: 4px solid #4CAF50;
              }
              .stage1-response {
                background-color: #f8f9fa;
                border-left: 3px solid #6c757d;
              }
              .response-title {
                font-weight: bold;
                color: #2c3e50;
                margin-bottom: 12px;
                font-size: 1.1em;
                padding-bottom: 6px;
                border-bottom: 1px solid #ddd;
              }
              .response-content {
                white-space: pre-wrap;
                color: #2c3e50;
                line-height: 1.5;
                padding: 10px;
                background-color: white;
                border-radius: 4px;
                border: 1px solid #eee;
              }
              .feedback-indicator {
                font-size: 1.2em;
                margin-top: 15px;
                text-align: right;
                padding: 8px;
                border-top: 1px solid #eee;
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
              }
            </style>
          </head>
          <body>
            <h1>Chat Analysis Report</h1>
            <div class="controls">
              <a href="?format=csv${req.query.limit ? '&limit=' + req.query.limit : ''}" class="download-btn">Download CSV</a>
              <select class="limit-select" onchange="window.location.href='?limit=' + this.value">
                <option value="25" ${limit === 25 ? 'selected' : ''}>Last 25 messages</option>
                <option value="50" ${limit === 50 ? 'selected' : ''}>Last 50 messages</option>
                <option value="100" ${limit === 100 ? 'selected' : ''}>Last 100 messages</option>
              </select>
              <label>
                <input type="checkbox" onchange="window.location.href='?' + new URLSearchParams({...Object.fromEntries(new URLSearchParams(window.location.search)), showFeedback: this.checked})" ${showFeedback ? 'checked' : ''}>
                Show Feedback
              </label>
              <label class="toggle-switch" for="simplifiedView">
                <input type="checkbox" id="simplifiedView" onchange="toggleSimplifiedView()">
                <span>Simplified View (Final Response Only)</span>
              </label>
              <label class="toggle-switch" for="detailedInsightsView">
                <input type="checkbox" id="detailedInsightsView" onchange="toggleDetailedInsightsView()">
                <span>Detailed Insights View (Split Insights + Final Response)</span>
              </label>
              <label class="toggle-switch" for="stage1OnlyView">
                <input type="checkbox" id="stage1OnlyView" onchange="toggleStage1OnlyView()">
                <span>Stage 1 Only View (Question + Stage 1 Response)</span>
              </label>
            </div>
            <div id="viewIndicator" class="view-indicator"></div>
            <script>
              function toggleStage1OnlyView() {
                const stage1Only = document.getElementById('stage1OnlyView').checked;
                const simplified = document.getElementById('simplifiedView');
                const detailedInsights = document.getElementById('detailedInsightsView');
                
                // If turning on stage1 only view, turn off other views
                if (stage1Only) {
                  if (simplified.checked) {
                    simplified.checked = false;
                    toggleSimplifiedView();
                  }
                  if (detailedInsights.checked) {
                    detailedInsights.checked = false;
                    toggleDetailedInsightsView();
                  }
                }
                
                // Update toggle button styles
                document.querySelector('label[for="stage1OnlyView"]').classList.toggle('active', stage1Only);
                document.querySelector('label[for="simplifiedView"]').classList.toggle('active', false);
                document.querySelector('label[for="detailedInsightsView"]').classList.toggle('active', false);
                
                // Update view indicator
                const viewIndicator = document.getElementById('viewIndicator');
                if (stage1Only) {
                  viewIndicator.textContent = "Stage 1 Only View - Showing Question + Stage 1 Response";
                  viewIndicator.style.display = 'block';
                } else if (!simplified.checked && !detailedInsights.checked) {
                  viewIndicator.style.display = 'none';
                }
                
                // Handle visibility of sections
                document.querySelectorAll('.advice-section, .selected-advice-section, .other-advice-section, .final-response').forEach(el => {
                  if (stage1Only) {
                    el.style.display = 'none';
                    el.classList.add('hidden-section');
                  } else {
                    el.style.display = 'block';
                    el.classList.remove('hidden-section');
                  }
                });
                
                // Always show stage1-response in this view
                document.querySelectorAll('.stage1-response').forEach(el => {
                  el.style.display = 'block';
                  el.classList.remove('hidden-section');
                });
                
                // Update print styles
                const style = document.getElementById('printStage1Styles') || document.createElement('style');
                style.id = 'printStage1Styles';
                style.textContent = stage1Only ? 
                  '@media print { .advice-section, .selected-advice-section, .other-advice-section, .final-response { display: none !important; } .stage1-response { display: block !important; } }' : '';
                if (!document.getElementById('printStage1Styles')) {
                  document.head.appendChild(style);
                }
              }
              
              function toggleDetailedInsightsView() {
                const detailedInsights = document.getElementById('detailedInsightsView').checked;
                const simplified = document.getElementById('simplifiedView');
                
                // If turning on detailed insights view, turn off simplified view
                if (detailedInsights && simplified.checked) {
                  simplified.checked = false;
                  toggleSimplifiedView();
                }
                
                // If turning on detailed insights view, turn off stage1 only view
                const stage1Only = document.getElementById('stage1OnlyView');
                if (detailedInsights && stage1Only.checked) {
                  stage1Only.checked = false;
                  toggleStage1OnlyView();
                }
                
                // Update toggle button styles
                document.querySelector('label[for="detailedInsightsView"]').classList.toggle('active', detailedInsights);
                document.querySelector('label[for="simplifiedView"]').classList.toggle('active', false);
                
                // Update view indicator
                const viewIndicator = document.getElementById('viewIndicator');
                if (detailedInsights) {
                  viewIndicator.textContent = "Detailed Insights View - Showing Split Insights + Final Response";
                  viewIndicator.style.display = 'block';
                } else if (!simplified.checked) {
                  viewIndicator.style.display = 'none';
                }
                
                // Toggle detailed insights sections
                document.querySelectorAll('.selected-advice-section, .other-advice-section').forEach(el => {
                  if (detailedInsights) {
                    el.style.display = 'block';
                    el.classList.remove('hidden-section');
                  } else {
                    el.style.display = 'none';
                    el.classList.add('hidden-section');
                  }
                });
                
                // Toggle regular advice section and stage1 response
                document.querySelectorAll('.advice-section, .stage1-response').forEach(el => {
                  if (detailedInsights) {
                    el.style.display = 'none';
                    el.classList.add('hidden-section');
                  } else {
                    el.style.display = 'block';
                    el.classList.remove('hidden-section');
                  }
                });
                
                // Update print styles for detailed view
                const style = document.getElementById('printDetailedStyles') || document.createElement('style');
                style.id = 'printDetailedStyles';
                style.textContent = detailedInsights ? 
                  '@media print { .advice-section, .stage1-response { display: none !important; } .selected-advice-section, .other-advice-section { display: block !important; } }' : '';
                if (!document.getElementById('printDetailedStyles')) {
                  document.head.appendChild(style);
                }
              }
              
              function toggleSimplifiedView() {
                const simplified = document.getElementById('simplifiedView').checked;
                const detailedInsights = document.getElementById('detailedInsightsView');
                
                // If turning on simplified view, turn off detailed insights view
                if (simplified && detailedInsights.checked) {
                  detailedInsights.checked = false;
                  toggleDetailedInsightsView();
                }
                
                // If turning on simplified view, turn off stage1 only view
                const stage1Only = document.getElementById('stage1OnlyView');
                if (simplified && stage1Only.checked) {
                  stage1Only.checked = false;
                  toggleStage1OnlyView();
                }
                
                // Update toggle button styles
                document.querySelector('label[for="simplifiedView"]').classList.toggle('active', simplified);
                document.querySelector('label[for="detailedInsightsView"]').classList.toggle('active', false);
                
                // Update view indicator
                const viewIndicator = document.getElementById('viewIndicator');
                if (simplified) {
                  viewIndicator.textContent = "Simplified View - Showing Final Response Only";
                  viewIndicator.style.display = 'block';
                } else if (!detailedInsights.checked) {
                  viewIndicator.style.display = 'none';
                }
                
                // Handle visibility of sections
                document.querySelectorAll('.advice-section, .stage1-response').forEach(el => {
                  if (simplified) {
                    el.style.display = 'none';
                    el.classList.add('hidden-section');
                  } else {
                    el.style.display = 'block';
                    el.classList.remove('hidden-section');
                  }
                });
                
                // Update Stage 2 header text in simplified view
                document.querySelectorAll('.final-response .response-title').forEach(el => {
                  el.textContent = simplified ? 'Final Response' : 'Stage 2 Response - Style Narrative';
                });

                // Update print styles
                const style = document.getElementById('printStyles') || document.createElement('style');
                style.id = 'printStyles';
                style.textContent = simplified ? 
                  '@media print { .advice-section, .stage1-response, .selected-advice-section, .other-advice-section { display: none !important; } }' : '';
                if (!document.getElementById('printStyles')) {
                  document.head.appendChild(style);
                }
              }
              
              document.addEventListener('DOMContentLoaded', function() {
                // Restore toggle states from localStorage
                const simplifiedView = document.getElementById('simplifiedView');
                const detailedInsightsView = document.getElementById('detailedInsightsView');
                const stage1OnlyView = document.getElementById('stage1OnlyView');
                
                simplifiedView.checked = localStorage.getItem('simplifiedView') === 'true';
                detailedInsightsView.checked = localStorage.getItem('detailedInsightsView') === 'true';
                stage1OnlyView.checked = localStorage.getItem('stage1OnlyView') === 'true';
                
                // Initialize display styles
                if (stage1OnlyView.checked) {
                  // Handle stage1 only view
                  document.querySelectorAll('.advice-section, .selected-advice-section, .other-advice-section, .final-response').forEach(el => {
                    el.style.display = 'none';
                    el.classList.add('hidden-section');
                  });
                  
                  // Update toggle button styles and view indicator
                  document.querySelector('label[for="stage1OnlyView"]').classList.add('active');
                  const viewIndicator = document.getElementById('viewIndicator');
                  viewIndicator.textContent = "Stage 1 Only View - Showing Question + Stage 1 Response";
                  viewIndicator.style.display = 'block';
                  
                  // Create print styles
                  const style = document.getElementById('printStage1Styles') || document.createElement('style');
                  style.id = 'printStage1Styles';
                  style.textContent = '@media print { .advice-section, .selected-advice-section, .other-advice-section, .final-response { display: none !important; } .stage1-response { display: block !important; } }';
                  if (!document.getElementById('printStage1Styles')) {
                    document.head.appendChild(style);
                  }
                } else if (simplifiedView.checked) {
                  document.querySelectorAll('.advice-section, .stage1-response').forEach(el => {
                    el.style.display = 'none';
                    el.classList.add('hidden-section');
                  });
                  
                  document.querySelectorAll('.final-response .response-title').forEach(el => {
                    el.textContent = 'Final Response';
                  });
                  
                  // Update toggle button styles and view indicator
                  document.querySelector('label[for="simplifiedView"]').classList.add('active');
                  const viewIndicator = document.getElementById('viewIndicator');
                  viewIndicator.textContent = "Simplified View - Showing Final Response Only";
                  viewIndicator.style.display = 'block';
                } else if (detailedInsightsView.checked) {
                  // Hide regular advice section and stage1 response
                  document.querySelectorAll('.advice-section, .stage1-response').forEach(el => {
                    el.style.display = 'none';
                    el.classList.add('hidden-section');
                  });
                  
                  // Show detailed insights sections
                  document.querySelectorAll('.selected-advice-section, .other-advice-section').forEach(el => {
                    el.style.display = 'block';
                    el.classList.remove('hidden-section');
                  });
                  
                  // Update toggle button styles and view indicator
                  document.querySelector('label[for="detailedInsightsView"]').classList.add('active');
                  const viewIndicator = document.getElementById('viewIndicator');
                  viewIndicator.textContent = "Detailed Insights View - Showing Split Insights + Final Response";
                  viewIndicator.style.display = 'block';
                } else {
                  // Default view - ensure proper order and visibility
                  document.querySelectorAll('.advice-section, .stage1-response, .final-response').forEach(el => {
                    el.style.display = 'block';
                    el.classList.remove('hidden-section');
                  });
                  
                  document.querySelectorAll('.selected-advice-section, .other-advice-section').forEach(el => {
                    el.style.display = 'none';
                    el.classList.add('hidden-section');
                  });
                  
                  document.querySelectorAll('.final-response .response-title').forEach(el => {
                    el.textContent = 'Stage 2 Response - Style Narrative';
                  });
                  
                  const viewIndicator = document.getElementById('viewIndicator');
                  viewIndicator.style.display = 'none';
                }
                
                // Initialize print styles
                const style = document.getElementById('printStyles') || document.createElement('style');
                style.id = 'printStyles';
                style.textContent = simplifiedView.checked ? 
                  '@media print { .advice-section, .stage1-response, .selected-advice-section, .other-advice-section { display: none !important; } }' : 
                  (detailedInsightsView.checked ? 
                    '@media print { .advice-section, .stage1-response { display: none !important; } .selected-advice-section, .other-advice-section { display: block !important; } }' : '');
                if (!document.getElementById('printStyles')) {
                  document.head.appendChild(style);
                }
              });
              
              // Save toggle state to localStorage
              document.getElementById('simplifiedView').addEventListener('change', (e) => {
                localStorage.setItem('simplifiedView', e.target.checked);
              });
              
              document.getElementById('detailedInsightsView').addEventListener('change', (e) => {
                localStorage.setItem('detailedInsightsView', e.target.checked);
              });
              
              document.getElementById('stage1OnlyView').addEventListener('change', (e) => {
                localStorage.setItem('stage1OnlyView', e.target.checked);
              });
            </script>
            <table>
              <thead class="print-once">
                <tr>
                  <th class="no-print">Chat Analysis</th>
                  ${showFeedback ? '<th class="no-print">Feedback</th>' : ''}
                </tr>
              </thead>
              <tbody>
        `);

        filteredMessages.forEach(message => {
          const timestamp = message.createdAt ? new Date(message.createdAt).toLocaleString() : '';
          
          // Enhanced advice display with ranking and scores
          const allAdvice = message.metadata?.displayEntries || [];
          
          // For the default view, just show the top entries (up to 8)
          // We don't have a way to know exactly which ones were used in the response
          const responseAdvice = allAdvice.slice(0, 8);
          const otherAdvice = allAdvice.slice(8);
          
          const selectedAdviceHtml = responseAdvice.map((entry, index) => `
            <div class="advice-block">
              <div>
                <span class="advice-rank">Rank ${index + 1}</span>
                <span class="advice-metadata">${entry.entry.category} | ${entry.entry.sourceTitle} - Score: ${entry.similarity.toFixed(3)}</span>
              </div>
              <div class="advice-content">
                <span class="advice-text">${entry.entry.advice}</span>
                <span class="advice-context"> - ${entry.entry.adviceContext}</span>
              </div>
            </div>
          `).join('') || '';
          
          const otherAdviceHtml = otherAdvice.map((entry, index) => `
            <div class="advice-block">
              <div>
                <span class="advice-rank">Rank ${allAdvice.indexOf(entry) + 1}</span>
                <span class="advice-metadata">${entry.entry.category} | ${entry.entry.sourceTitle} - Score: ${entry.similarity.toFixed(3)}</span>
              </div>
              <div class="advice-content">
                <span class="advice-text">${entry.entry.advice}</span>
                <span class="advice-context"> - ${entry.entry.adviceContext}</span>
              </div>
            </div>
          `).join('') || '';
          
          // Original combined advice display - show all response advice items
          const selectedAdviceOriginal = responseAdvice.map((entry, index) => `
            <div class="advice-block">
              <div>
                <span class="advice-rank">Rank ${index + 1}</span>
                <span class="advice-metadata">${entry.entry.category} | ${entry.entry.sourceTitle} - Score: ${entry.similarity.toFixed(3)}</span>
              </div>
              <div class="advice-content">
                <span class="advice-text">${entry.entry.advice}</span>
                <span class="advice-context"> - ${entry.entry.adviceContext}</span>
              </div>
            </div>
          `).join('') || '';

          const thumbsUp = message.thumbsUp === null ? '-' : (message.thumbsUp ? '👍' : '👎');
          
          res.write(`
            <tr>
              <td>
                <div class="query-section">
                  <div class="query-timestamp">${timestamp}</div>
                  <div class="query-text">${message.query}</div>
                </div>
                <div class="advice-section">
                  <div class="advice-title">Top Advice Items (${responseAdvice.length})</div>
                  ${selectedAdviceOriginal}
                </div>
                <div class="selected-advice-section hidden-section">
                  <div class="advice-title">Top Advice Items (${responseAdvice.length})</div>
                  ${selectedAdviceHtml}
                </div>
                ${otherAdviceHtml ? `
                <div class="other-advice-section hidden-section">
                  <div class="advice-title">Additional Advice Items (${otherAdvice.length})</div>
                  ${otherAdviceHtml}
                </div>
                ` : ''}
                <div class="response-section stage1-response">
                  <div class="response-title">Stage 1 Response - Curate Narrative</div>
                  <div class="response-content">${(message.stage1Response || '').replace(/[•â€¢]/g, '&#8226;')}</div>
                </div>
                <div class="response-section final-response">
                  <div class="response-title">Stage 2 Response - Style Narrative</div>
                  <div class="response-content">${(message.finalResponse || '').replace(/[•â€¢]/g, '&#8226;')}</div>
                </div>
                <div class="feedback-indicator">${thumbsUp}</div>
              </td>
              ${showFeedback ? `<td>${message.feedback || ''}</td>` : ''}
            </tr>
          `);
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