import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { SearchResponse, SearchAdviceEntry } from "@shared/schema";

interface UseAdviceSearchProps {
  searchTerm: string;
  selectedCategory: string | null;
  selectedSubCategory: string | null;
  page: number;
}

export function useAdviceSearch({
  searchTerm,
  selectedCategory,
  selectedSubCategory,
  page
}: UseAdviceSearchProps) {
  console.log('Search Props:', {
    searchTerm,
    selectedCategory,
    selectedSubCategory,
    page,
    categoryType: typeof selectedCategory,
    subCategoryType: typeof selectedSubCategory
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["advice-search", searchTerm, selectedCategory, selectedSubCategory, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        q: searchTerm,
        category: selectedCategory === "all" ? "" : (selectedCategory ?? ""),
        subCategory: selectedSubCategory === "all" ? "" : (selectedSubCategory ?? ""),
        page: page.toString()
      });

      console.log('API Request Params:', params.toString());

      const res = await apiRequest(
        "GET", 
        `/api/advice/search?${params.toString()}`
      );
      return res.json() as Promise<SearchResponse>;
    }
  });

  return {
    data: data ?? { 
      entries: [], 
      categories: [], 
      subCategories: [], 
      categoryCounts: {}, 
      subCategoryCounts: {}, 
      total: 0, 
      from: 0, 
      to: 0, 
      totalPages: 0 
    },
    isLoading,
    error
  };
} 