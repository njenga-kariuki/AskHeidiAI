import { useState, useEffect, useRef, useCallback } from "react";
import { Search as SearchIcon, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectContent, SelectItem } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useAdviceSearch } from "@/hooks/use-advice-search";
import type { SearchAdviceEntry } from "@shared/schema";

export default function Search() {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSubCategory, setSelectedSubCategory] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedItems, setExpandedItems] = useState(new Set<number>());
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(e.target.value);
  }, []);

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchInput);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput]);

  const {
    data,
    isLoading,
    error
  } = useAdviceSearch({
    searchTerm: debouncedSearchTerm,
    selectedCategory,
    selectedSubCategory,
    page: currentPage
  });

  const toggleExpand = (index: number) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedItems(newExpanded);
  };

  // Render the main search interface
  return (
    <div className="space-y-3">
      <Card className="p-6">
        <div className="space-y-4">
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 text-threshold-text-muted w-5 h-5" />
            <Input
              ref={searchInputRef}
              type="text"
              placeholder="Search topics like 'Fundraising' or '409a'..."
              value={searchInput}
              onChange={handleSearchChange}
              className="pl-10 border-gray-200 focus:border-threshold-orange focus:ring focus:ring-threshold-orange/20 normal-case focus:placeholder:opacity-0 text-left placeholder:text-center"
            />
          </div>

          {data && (
            <div className="flex flex-wrap gap-4 justify-center">
              <Select 
                value={selectedCategory ?? undefined} 
                onValueChange={setSelectedCategory}
              >
                <SelectTrigger className="w-[200px] border-gray-200 focus:ring-threshold-orange/20 normal-case">
                  {selectedCategory || "All Topics"}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="normal-case">All Topics</SelectItem>
                  {data.categories?.map((cat: string) => (
                    <SelectItem key={cat} value={cat} className="normal-case flex justify-between items-center">
                      <span>{cat}</span>
                      {data.categoryCounts && (
                        <span className="text-xs text-threshold-text-muted ml-2">
                          ({data.categoryCounts[cat]})
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select 
                value={selectedSubCategory ?? undefined}
                onValueChange={(value: string) => {
                  setSelectedSubCategory(value);
                  setSelectedCategory(null);
                }}
              >
                <SelectTrigger className="w-[200px] border-gray-200 focus:ring-threshold-orange/20 normal-case">
                  {selectedSubCategory || "All Subtopics"}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="normal-case">All Subtopics</SelectItem>
                  {data.subCategories?.map((subcat: string) => (
                    <SelectItem key={subcat} value={subcat} className="normal-case flex justify-between items-center">
                      <span>{subcat}</span>
                      {data.subCategoryCounts && (
                        <span className="text-xs text-threshold-text-muted ml-2">
                          ({data.subCategoryCounts[subcat]})
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </Card>

      {/* Search Results Count Indicator */}
      {data && !isLoading && (
        <div className="text-sm text-threshold-text-muted mt-1 mb-1">
          {data.total > 0 
            ? `${data.total} ${data.total === 1 ? 'result' : 'results'}`
            : 'No results found'}
        </div>
      )}

      {/* Results Section */}
      {error ? (
        <Card className="p-6">
          <div className="text-red-600">
            Failed to load advice data. Please try again later.
          </div>
        </Card>
      ) : isLoading ? (
        <Card className="p-6">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-threshold-orange" />
          </div>
        </Card>
      ) : data && (
        <div className="space-y-4">
          {data.entries.map((item: SearchAdviceEntry, index: number) => (
            <Card key={index} className="overflow-hidden border-gray-100 transition-shadow hover:shadow-md">
              <div
                onClick={() => toggleExpand(index)}
                className="p-4 cursor-pointer hover:bg-threshold-bg-secondary flex justify-between items-start group"
              >
                <div className="space-y-2">
                  <div className="text-sm text-threshold-text-muted [text-transform:initial]">
                    <span className="text-threshold-orange mr-1">•</span>
                    {item.category} → {item.subCategory}
                  </div>
                  <div className="font-medium text-threshold-text-primary group-hover:text-threshold-orange transition-colors [text-transform:initial]">
                    {item.rawAdvice}
                  </div>
                  {expandedItems.has(index) && (
                    <>
                      {item.rawAdviceContext && (
                        <div className="mt-4 text-sm text-threshold-text-muted [text-transform:initial] italic">
                          {item.rawAdviceContext}
                        </div>
                      )}
                      {item.sourceLink && (
                        <div className="mt-4">
                          <div className="flex items-center gap-2">
                            <a
                              href={item.sourceLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-600 hover:text-blue-800 transition-colors flex items-center gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {item.sourceTitle}
                              {item.sourceType && <span className="text-threshold-text-muted">({item.sourceType})</span>}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                          {item.sourceSummary && (
                            <div className="mt-1 text-xs text-threshold-text-muted [text-transform:initial] pl-2 border-l-2 border-gray-100">
                              {item.sourceSummary}
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

          {data.total > 0 && (
            <div className="flex justify-between items-center pt-4">
              <div className="text-sm text-gray-500">
                Showing {data.from} to {data.to} of {data.total} results
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setCurrentPage(p => p - 1)}
                  disabled={currentPage === 1}
                  className="border-gray-200 hover:bg-threshold-bg-secondary hover:text-threshold-orange focus:ring-threshold-orange/20"
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setCurrentPage(p => p + 1)}
                  disabled={currentPage === data.totalPages}
                  className="border-gray-200 hover:bg-threshold-bg-secondary hover:text-threshold-orange focus:ring-threshold-orange/20"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
} 