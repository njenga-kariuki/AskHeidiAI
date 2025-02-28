import { useState } from "react";
import { Card } from "@/components/ui/card";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

interface RelatedInsight {
  entry: {
    category: string;
    subCategory: string;
    advice: string;
    adviceContext: string;
    sourceTitle: string;
    sourceType?: string;
    sourceLink: string;
    sourceSummary?: string;
    rawAdvice?: string;
    rawAdviceContext?: string;
  };
  similarity: number;
}

interface RelatedInsightsProps {
  insights: RelatedInsight[];
}

export default function RelatedInsights({ insights }: RelatedInsightsProps) {
  const [expandedItems, setExpandedItems] = useState(new Set<number>());

  if (!insights?.length) {
    return null;
  }

  const toggleExpand = (index: number) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedItems(newExpanded);
  };

  // Ensure insights are sorted by similarity score (highest first)
  const sortedInsights = [...insights].sort((a, b) => b.similarity - a.similarity);

  return (
    <div className="mt-6 space-y-4">
      <div className="border-t border-gray-100 pt-6">
        <h3 className="font-medium text-threshold-text-primary mb-4">
          See Top {insights.length} Related Insights:
        </h3>
        <div className="space-y-4">
          {sortedInsights.map((item, index) => (
            <Card key={index} className="overflow-hidden border-gray-100 transition-shadow hover:shadow-md">
              <div
                onClick={() => toggleExpand(index)}
                className="p-4 cursor-pointer hover:bg-threshold-bg-secondary flex justify-between items-start group"
              >
                <div className="space-y-2">
                  <div className="text-sm text-threshold-text-muted [text-transform:initial]">
                    <span className="text-threshold-orange mr-1">•</span>
                    {item.entry.category} → {item.entry.subCategory}
                  </div>
                  <div className="font-medium text-threshold-text-primary group-hover:text-threshold-orange transition-colors [text-transform:initial]">
                    {item.entry.rawAdvice || item.entry.advice}
                  </div>
                  {expandedItems.has(index) && (
                    <>
                      {(item.entry.rawAdviceContext || item.entry.adviceContext) && (
                        <div className="mt-4 text-sm text-threshold-text-muted [text-transform:initial] italic">
                          {item.entry.rawAdviceContext || item.entry.adviceContext}
                        </div>
                      )}
                      {item.entry.sourceLink && (
                        <div className="mt-4">
                          <div className="flex items-center gap-2">
                            <a
                              href={item.entry.sourceLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-600 hover:text-blue-800 transition-colors flex items-center gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {item.entry.sourceTitle}
                              {item.entry.sourceType && <span className="text-threshold-text-muted">({item.entry.sourceType})</span>}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                          {item.entry.sourceSummary && (
                            <div className="mt-1 text-xs text-threshold-text-muted [text-transform:initial] pl-2 border-l-2 border-gray-100">
                              {item.entry.sourceSummary}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
                {expandedItems.has(index) ? (
                  <ChevronUp className="w-5 h-5 text-threshold-text-muted group-hover:text-threshold-orange flex-shrink-0" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-threshold-text-muted group-hover:text-threshold-orange flex-shrink-0" />
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
} 