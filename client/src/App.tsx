import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import Advice from "@/pages/advice";
import Footer from './components/Footer';
import Header from './components/Header';

function Router() {
  return (
    <Switch>
      <Route path="/" component={Advice} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Header />
      <Router />
      <Toaster />
      <Footer />
    </QueryClientProvider>
  );
}
