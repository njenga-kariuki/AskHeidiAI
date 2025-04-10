import { Card } from "@/components/ui/card";
import Chat from "./chat";
import Search from "@/components/search/search";
import { Search as SearchIcon, MessageSquare } from "lucide-react";
import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import SecondaryNav from '@/components/SecondaryNav/SecondaryNav';

export default function Advice() {
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const initialTab = searchParams.get("tab");

  console.log("Initial search string:", search);
  console.log("Initial initialTab:", initialTab);

  const [mode, setMode] = useState<"chat" | "search">(() => {
    const calculatedMode = initialTab === "search" ? "search" : "chat";
    console.log("Initial mode set to:", calculatedMode);
    return calculatedMode;
  });

  useEffect(() => {
    console.log("Mode state updated to:", mode);
  }, [mode]);

  return (
    <div className="min-h-screen bg-white p-4 md:p-8">
      <div className="mx-auto max-w-3xl">
        <SecondaryNav />
        <h1 
          className="mb-2 text-center text-4xl font-semibold text-threshold-orange" 
          style={{ color: '#F26A36' }}
        >
          <span className="relative inline-block">
            Ask Heidi AI
            <span className="beta-tag absolute left-full top-0 ml-1 -translate-y-px transform text-xs font-light lowercase text-gray-400">
              beta
            </span>
          </span>
        </h1>
        <p className="mb-8 text-center text-threshold-text-primary text-sm leading-relaxed max-w-2xl mx-auto">
          Curated insights from The Startup Solution podcast, plus Heidi's blog posts, speeches, and interviews
        </p>

        <div className="flex justify-center gap-4 mb-6 border-b border-gray-100">
          <button
            onClick={() => setMode("chat")}
            className={`flex items-center gap-2 px-2 py-3 border-b-2 transition-colors ${
              mode === "chat"
                ? "border-threshold-orange text-threshold-orange"
                : "border-transparent text-threshold-text-primary hover:text-threshold-orange"
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            Chat
          </button>
          <div className="self-center w-px h-4 bg-black/[0.08]" />
          <button
            onClick={() => setMode("search")}
            className={`flex items-center gap-2 px-2 py-3 border-b-2 transition-colors ${
              mode === "search"
                ? "border-threshold-orange text-threshold-orange"
                : "border-transparent text-threshold-text-primary hover:text-threshold-orange"
            }`}
          >
            <SearchIcon className="w-4 h-4" />
            Search
          </button>
        </div>

        <Card className="overflow-hidden bg-white">
          <div className="p-6">
            {mode === "chat" ? <Chat /> : <Search />}
          </div>
        </Card>
      </div>
    </div>
  );
}