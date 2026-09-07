# Ask Heidi: Custom-Built Startup Advice Platform

A purpose-built platform that scales access to Heidi Roizen's entrepreneurial wisdom through a custom-curated chatbot, search, and browse experience.

<div>
    <a href="https://www.loom.com/share/24b23383e9f34d6ab663bd1a069a6fd0">
      <p>Demo Video</p>
    </a>
    <a href="https://www.loom.com/share/24b23383e9f34d6ab663bd1a069a6fd0">
      <img style="max-width:300px;" src="https://cdn.loom.com/sessions/thumbnails/24b23383e9f34d6ab663bd1a069a6fd0-9a2e855065e9e0bf-full-play.gif">
    </a>
  </div>

## About Heidi Roizen

Heidi Roizen is a prominent venture capitalist (and my mentor!) with 40+ years of experience as both founder and investor. Having served on more than 40 corporate boards throughout her career, she's one of Silicon Valley's most respected voices in entrepreneurship. Her insights are in high demand from founders seeking guidance on their startup journeys.

## Project Purpose

This platform was developed to support a specific business need for Heidi's venture firm, which wanted to launch a companion tool alongside their [Startup Solution](https://threshold.vc/podcast) podcast. The goal was to make Heidi's invaluable startup advice more accessible at scale while maintaining her authentic voice and ensuring responses came exclusively from her own content.

## Solution Overview

The platform provides three ways to access Heidi's entrepreneurial wisdom:
1. **Custom-Built Chatbot**: Delivers contextually relevant advice in Heidi's authentic voice
2. **Semantic Search**: Finds specific insights across her collected wisdom
3. **Browse Experience**: Explore categorized startup advice by topic

The design centers on retrieving Heidi's own published advice and linking responses back to the original sources. Source selection, attribution and response style are explicit parts of the implementation.

## Development Approach

Rather than using one-click solutions or high-level frameworks like LangChain, I deliberately built this system from first principles:

1. **Hand-Curated Dataset**: I personally reviewed 70+ different sources of Heidi's content across different source types (e.g., blogs, podcasts, youtube videos), developing a specialized workflow to extract key insights and create a dataset of 650+ categorized startup insights.

2. **Designed a Custom Architecture**: By building core components from scratch, I gained precise control over:
   - The query understanding process
   - Retrieval mechanisms for finding relevant advice
   - Response generation that authentically preserves Heidi's voice
   - Attribution that links advice to original sources

3. **Implemented Specialized Prompting**: Created custom two-stage prompting to select relevant advice and guide responses toward Heidi's communication style.

## Key Technical Features

- **Custom Vector Search Implementation**: Built an embedding-based semantic search system from the ground up
- **Two-Stage Response Generation**:
  - Stage 1: Analyzes queries and identifies the most relevant pieces of advice
  - Stage 2: Generates responses in Heidi's authentic voice with proper attribution
- **Performance Optimizations**: Embedding caching system, efficient database queries
- **Streaming Responses**: Enhanced user experience through progressive text generation
- **Modern Web Interface**: Clean, responsive UI for multiple devices

## Technical Stack

- **Backend**: Node.js with Express
- **Frontend**: React with Tailwind CSS
- **Database**: PostgreSQL with Drizzle ORM
- **AI Services**: 
  - Anthropic Claude for response generation
  - OpenAI for embedding generation
- **Deployment**: PM2 process manager

## Implementation Details

- Custom vector search with cosine similarity scoring
- Two-phase prompt engineering with specialized system prompts
- Robust embedding caching system with backup mechanisms
- Streaming response generation
- Error handling and rate-limit handling for AI service calls

# Project Structure

```
├── client/              # Frontend React application
├── server/              # Backend Express server
│   ├── services/        # Core services (Claude, VectorSearch, DataLoader)
│   ├── routes.ts        # API routes
│   └── index.ts         # Server entry point
├── shared/              # Shared types and utilities
├── dist/                # Compiled code
└── package.json         # Project dependencies
```

## Acknowledgements

Special thanks to Heidi Roizen for her entrepreneurial wisdom that forms the foundation of this advisory system.

## Project status and local setup

Built in February–May 2025. The recorded demo captures the implemented experience: chat, semantic search, source attribution and topic browsing. The curated corpus contains more than 650 advice entries from over 70 public sources; the source CSVs, prompts and embedding-cache implementation are included.

For local exploration, install the dependencies with `npm ci`, configure the environment variables in [.env.example](.env.example), and provision a PostgreSQL database using the schema in `shared/schema.ts`. `npm run dev` starts the application and `npm run regenerate-embeddings` rebuilds the search cache. The application reads configuration from the process environment.

Review model IDs, dependencies and database configuration before connecting current services. The original implementation uses shared conversation state and reporting routes that need user isolation and access controls before a shared deployment. The published source has not been revalidated end to end against today's APIs.
