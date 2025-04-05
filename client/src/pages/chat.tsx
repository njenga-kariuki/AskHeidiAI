import { Card } from "@/components/ui/card";
import ChatInput from "@/components/chat/chat-input";
import ChatMessage from "@/components/chat/chat-message";
import LoadingMessage from "@/components/chat/loading-message";
import { Message } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";

// Shared formatting function for consistent styling
const formatResponse = (text: string): string => {
  if (!text) return "";
  
  // Log input with more context
  console.log('formatResponse input:', {
    text: text.slice(-500), // Show more context
    length: text.length,
    endsWithLink: text.endsWith('</a>'),
    hasSourceType: text.includes('(Youtube)') || text.includes('(Podcast)'),
    lastNewline: text.slice(-50).lastIndexOf('\n')
  });
  
  const formatted = text
    // Replace double newlines with paragraph breaks
    .replace(/\n\n/g, '</p><p>')
    // Replace single newlines with <br />
    .replace(/\n/g, '<br />')
    // Fix any cases where we might have inserted breaks inside HTML tags
    .replace(/<br \/><a/g, '<a')
    .replace(/<\/a><br \/>/g, '</a>')
    // Ensure proper paragraph wrapping
    .replace(/^(.+?)(?=<\/p>|$)/, '<p>$1')
    // Handle the "For more insights" section and source links
    .replace(
      /<p>For more insights, check out:<br \/>(.*?)(?=<p>|$)/g,
      (match, group1) => {
        // Add detailed logging of the source section content
        console.log('Source section debugging:', {
          fullMatch: match,
          sourceListContent: group1,
          containsBullets: group1.includes('•'),
          containsLineBreaks: group1.includes('<br />'),
          containsNewlines: group1.includes('\n'),
          // Log the HTML structure more clearly
          htmlStructure: group1.split(/(<[^>]+>)/).filter(Boolean).map((part: string) => ({
            type: part.startsWith('<') ? 'tag' : 'content',
            value: part
          }))
        });
        
        return `<div class="mt-4"><span class="font-medium">For more insights, check out:</span><ul class="pl-5 mt-0">${group1}</ul></div>`;
      }
    )
    // Convert bullets to list items, preserving links and source types
    .replace(
      /•\s*(<a.*?<\/a>)(\s*\([^)]*\))?(?:-([^<]*))?(?=<br|$)/g,
      function(match, link, sourceType, summary) {
        // Ensure consistent text size class for all summaries
        return '<li>' + link + (sourceType || '') + 
               (summary ? ' - <span class="text-sm text-gray-500">' + summary.trim() + '</span>' : '') + 
               '</li>';
      }
    )
    // Clean up any line breaks between bullet points and ensure consistent spacing
    .replace(/(<\/li>)\s*<br \/>\s*(•|<li>)/g, '$1$2')
    // Catch any unconverted bullet points right before the closing </ul>
    .replace(
      /•\s*(<a.*?<\/a>)(\s*\([^)]*\))?(?:-\s*([^<]*))?(\s*<\/ul>)/g,
      function(cleanupMatch, link, sourceType, summary, closingUlTag) {
        console.log("Applying cleanup regex for potential last bullet in chat:", { link, sourceType, summary });
        // Format the missed bullet point correctly
        return '<li>' + link + (sourceType || '') +
               (summary ? ' - <span class="text-sm text-gray-500">' + summary.trim() + '</span>' : '') +
               '</li>' + closingUlTag; // Append the closing </ul> tag back
      }
    );

  return formatted;
};

export default function Chat() {
  const [message, setMessage] = useState<Message | null>(null);
  const [streamedContent, setStreamedContent] = useState('');
  const [isStreamComplete, setIsStreamComplete] = useState(false);
  const { toast } = useToast();

  // Function to get current displayed content
  const displayContent = useMemo(() => {
    const content = message?.finalResponse && isStreamComplete ? message.finalResponse : streamedContent || '';
    console.log('Display content update:', {
      source: message?.finalResponse ? 'finalResponse' : 'streamedContent',
      hasMessageResponse: !!message?.finalResponse,
      isStreamComplete,
      contentLength: content.length,
      lastChunk: content.slice(-100),
      hasSourceType: content.includes('(Youtube)') || content.includes('(Podcast)')
    });
    return content;
  }, [message?.finalResponse, streamedContent, isStreamComplete]);

  const mutation = useMutation({
    mutationFn: async (query: string) => {
      console.log('Starting new query');
      setIsStreamComplete(false);
      setStreamedContent('');
      return new Promise<Message>((resolve, reject) => {
        fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query })
        }).then(() => {
          const eventSource = new EventSource('/api/chat/stream');
          
          eventSource.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              console.log('SSE message received:', { type: data.type });
              
              switch (data.type) {
                case 'init':
                  console.log('Initializing message:', data.messageId);
                  setMessage({
                    id: data.messageId,
                    query,
                    stage1Response: null,
                    finalResponse: null,
                    metadata: null,
                    thumbsUp: null,
                    feedback: null,
                    createdAt: null
                  });
                  break;
                  
                case 'content':
                  console.log('Content chunk received, length:', data.content.length);
                  setStreamedContent(prev => {
                    const updated = formatResponse(prev + data.content);
                    console.log('Updated streamed content length:', updated.length);
                    return updated;
                  });
                  break;
                  
                case 'complete':
                  console.log('Complete event received:', {
                    hasMessageContent: !!data.message?.finalResponse,
                    contentLength: data.message?.finalResponse?.length
                  });
                  setMessage(data.message);
                  setIsStreamComplete(true);
                  eventSource.close();
                  resolve(data.message);
                  break;
                  
                case 'error':
                  console.error('Error event received:', data.error);
                  eventSource.close();
                  setStreamedContent('');
                  setIsStreamComplete(false);
                  reject(new Error(data.error));
                  break;
              }
            } catch (err) {
              console.error('Error processing SSE message:', err);
              eventSource.close();
              reject(new Error('Failed to process server message'));
            }
          };

          eventSource.onerror = (err) => {
            console.error('EventSource error:', err);
            eventSource.close();
            setStreamedContent('');
            setIsStreamComplete(false);
            reject(new Error('EventSource connection failed'));
          };
        }).catch(err => {
          console.error('Failed to create message:', err);
          reject(err);
        });
      });
    },
    onError: (error) => {
      console.error('Mutation error:', error);
      toast({
        title: "Error",
        description: "Failed to get response. Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="relative pb-12">
      <Card className="mb-6 p-6">
        <ChatInput
          onSubmit={(query) => mutation.mutate(query)}
          isLoading={mutation.isPending}
          isSuccess={isStreamComplete}
        />
      </Card>

      {mutation.isPending && displayContent && (
        <Card className="mb-4 p-6">
          <div 
            className="prose prose-gray max-w-none prose-p:text-threshold-text-secondary prose-headings:text-threshold-text-primary prose-a:text-blue-600 hover:prose-a:text-blue-800 prose-a:no-underline prose-p:my-3"
            dangerouslySetInnerHTML={{ __html: displayContent }} 
          />
        </Card>
      )}

      {message && !mutation.isPending && (
        <ChatMessage
          message={message}
          onFeedbackSubmitted={setMessage}
        />
      )}

      {isStreamComplete && (
        <div className="absolute bottom-0 left-0 right-0 p-2 bg-white/90 backdrop-blur-sm border-t text-center">
          <p className="text-xs text-gray-400 max-w-3xl mx-auto">
            May cite past market data and adapt advice. See sources for full context.
          </p>
        </div>
      )}
    </div>
  );
}