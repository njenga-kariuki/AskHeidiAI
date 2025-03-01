# Ask Heidi: Custom-Built Startup Advice Platform

A purpose-built platform that scales access to Heidi Roizen's entrepreneurial wisdom through a custom-curated chatbot, search, and browse experience.

## Try It Out

**[Ask Heidi](https://heidi-ai.replit.app/)** 

## About Heidi Roizen

Heidi Roizen is a prominent venture capitalist with 40+ years of experience as both founder and investor. Having served on more than 40 corporate boards throughout her career, she's one of Silicon Valley's most respected voices in entrepreneurship. Her insights are in high demand from founders seeking guidance on their startup journeys.

## Project Purpose

This platform was developed to support a specific business need for Heidi's venture firm, which wanted to launch a companion tool alongside their [Startup Solution](https://threshold.vc/podcast) podcast. The goal was to make Heidi's invaluable startup advice more accessible at scale while maintaining her authentic voice and ensuring responses came exclusively from her own content.

## Solution Overview

The platform provides three ways to access Heidi's entrepreneurial wisdom:
1. **Custom-Built Chatbot**: Delivers contextually relevant advice in Heidi's authentic voice
2. **Semantic Search**: Finds specific insights across her collected wisdom
3. **Browse Experience**: Explore categorized startup advice by topic

Unlike previous attempts by others to create a Heidi chatbot (which failed to meet her quality standards by not exclusively using her content and voice), this implementation maintains complete fidelity to Heidi's actual advice and communication style.

## Development Approach

Rather than using one-click solutions or high-level frameworks like LangChain, I deliberately built this system from first principles:

1. **Hand-Curated Dataset**: I personally reviewed 70+ different sources of Heidi's content across different source types (e.g., blogs, podcasts, youtube videos), developing a specialized workflow to extract key insights and create a dataset of 650+ categorized startup insights.

2. **Designed a Custom Architecture**: By building core components from scratch, I gained precise control over:
   - The query understanding process
   - Retrieval mechanisms for finding relevant advice
   - Response generation that authentically preserves Heidi's voice
   - Attribution that links advice to original sources

3. **Implemented Specialized Prompting**: Created custom two-stage prompting that ensures responses are both relevant to user queries and faithful to Heidi's communication style.

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
- **Deployment**: PM2 process manager for production reliability

## Implementation Details

- Custom vector search with cosine similarity scoring
- Two-phase prompt engineering with specialized system prompts
- Robust embedding caching system with backup mechanisms
- Streaming response generation
- Comprehensive error handling and rate limiting

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

