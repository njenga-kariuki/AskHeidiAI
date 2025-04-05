import { Card, CardContent } from "@/components/ui/card";
import Feedback from "./feedback";
import RelatedInsights from "./related-insights";
import type { Message } from "@shared/schema";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Use the same formatting function as chat.tsx for consistency
const formatResponse = (text: string): string => {
  if (!text) return "";
  
  console.log("ORIGINAL TEXT:", text);
  
  // Extract source links section for analysis
  const sourceSection = text.match(/For more insights, check out:[\s\S]*?(?=\n\n|$)/);
  if (sourceSection) {
    console.log("SOURCE SECTION:", sourceSection[0]);
  }
  
  const result = text
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
      function(match, sourceLinks) {
        console.log("MATCHED SOURCE LINKS SECTION:", sourceLinks);
        return '<div class="mt-4"><span class="font-medium">For more insights, check out:</span><ul class="pl-5 mt-0">' + sourceLinks + '</ul></div>';
      }
    )
     // Convert bullets to list items, preserving links and source types
     .replace(/•\s*(<a.*?<\/a>)(\s*\([^)]*\))?(?:-([^<]*))?(?=<br|$)/g, function(match, link, sourceType, summary) {
       console.log("BULLET MATCH:", {match, link, sourceType, summary});
       return '<li>' + link + (sourceType || '') + 
              (summary ? ' - <span class="text-gray-500 text-sm">' + summary + '</span>' : '') + 
              '</li>';
     })
    // Clean up any line breaks between bullet points
    .replace(/(<\/li>)\s*<br \/>\s*(•|<li>)/g, '$1$2')
    // Clean up potential trailing line break before closing </ul>
    .replace(/<br \/>\s*(<\/ul>)/g, '$1')
    // Catch any unconverted bullet points right before the closing </ul>
    .replace(
      /•\s*(<a.*?<\/a>)(\s*\([^)]*\))?(?:-\s*([^<]*))?\s*(<\/ul>)/g,
      function(cleanupMatch, link, sourceType, summary, closingUlTag) {
        console.log("Applying cleanup regex for potential last bullet in chat-message:", { link, sourceType, summary });
        // Format the missed bullet point correctly
        return '<li>' + link + (sourceType || '') +
               (summary ? ' - <span class="text-gray-500 text-sm">' + summary.trim() + '</span>' : '') +
               '</li>' + closingUlTag; // Append the closing </ul> tag back
      }
    );
  
  console.log("FINAL HTML:", result);
  return result;
};

interface ChatMessageProps {
  message: Message;
  displayContent?: string;
  onFeedbackSubmitted: (message: Message) => void;
}

// Helper function to get confidence details
const getConfidenceDetails = (level: 'high_confidence' | 'medium_confidence' | 'low_confidence') => {
  switch (level) {
    case 'high_confidence':
      return { 
        text: "High Confidence: Specific topic expertise", 
        className: "bg-green-500",
        ariaLabel: "High Confidence",
        shortLabel: "High"
      };
    case 'medium_confidence':
      return { 
        text: "Medium Confidence: General advice on topic", 
        className: "bg-orange-300",
        ariaLabel: "Medium Confidence",
        shortLabel: "Medium"
      };
    case 'low_confidence':
    default:
      return { 
        text: "Low Confidence: Limited advice on topic", 
        className: "bg-gray-400",
        ariaLabel: "Low Confidence",
        shortLabel: "Low"
      };
  }
};

export default function ChatMessage({ message, displayContent, onFeedbackSubmitted }: ChatMessageProps) {
  const content = displayContent || message.finalResponse || '';
  const confidenceLevel = message.metadata?.confidenceAnalysis?.level;
  const confidenceDetails = confidenceLevel ? getConfidenceDetails(confidenceLevel) : null;

  return (
    <TooltipProvider delayDuration={0}>
      <Card className="overflow-hidden border-gray-200">
        <CardContent className="p-6">
          <div className="mb-6">
            <h3 className="font-medium text-threshold-text-primary mb-2">Your Question</h3>
            <p className="text-threshold-text-secondary">{message.query}</p>
          </div>

          <div>
            <h3 className="font-medium text-threshold-text-primary mb-2 flex items-center">
              Heidi's Response
              {confidenceDetails && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span 
                      className="inline-flex items-center ml-2 px-1.5 py-0.5 rounded-full text-xs font-medium text-gray-600 bg-gray-100 cursor-default"
                      aria-label={confidenceDetails.ariaLabel}
                    >
                      <span className="mr-1">{confidenceDetails.shortLabel}</span>
                      <span 
                        className={`inline-block w-2 h-2 rounded-full ${confidenceDetails.className}`} 
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{confidenceDetails.text}</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </h3>
            <div 
              className="prose prose-gray max-w-none prose-p:text-threshold-text-secondary prose-headings:text-threshold-text-primary
              prose-a:text-blue-600 hover:prose-a:text-blue-800 prose-a:no-underline prose-p:my-3"
              dangerouslySetInnerHTML={{ __html: formatResponse(content) }}
            />
          </div>

          <Feedback 
            messageId={message.id} 
            onFeedbackSubmitted={onFeedbackSubmitted}
          />

          {message.metadata?.displayEntries && (
            <RelatedInsights insights={message.metadata.displayEntries} />
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}