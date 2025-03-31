import React, { useState, useEffect, useRef } from 'react';

export default function Header() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsMobileMenuOpen(false);
      }
    }

    if (isMobileMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isMobileMenuOpen]);

  return (
    <div className="threshold-main-nav wf-section relative">
      <div className="threshold-container w-full flex justify-between items-center">
        <a href="https://threshold.vc/" className="threshold-logo-link">
          <img src="/attached_assets/threshold-logo-color.svg" loading="lazy" alt="Threshold logo" />
        </a>
        <div className="threshold-nav-links flex space-x-4">
          <a href="https://threshold.vc/about" className="threshold-nav-link">About</a>
          <a href="https://threshold.vc/team" className="threshold-nav-link">Team</a>
          <a href="https://threshold.vc/companies" className="threshold-nav-link">Companies</a>
          <a href="https://threshold.vc/newsroom" className="threshold-nav-link">Newsroom</a>
          <a href="https://threshold.vc/podcast" className="threshold-nav-link">Podcast</a>
        </div>
        <button
          ref={buttonRef}
          className="hamburger-button p-2"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          aria-label="Toggle menu"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-8 6h8" />
          </svg>
        </button>
      </div>
      {isMobileMenuOpen && (
        <div 
          ref={menuRef}
          className="absolute top-full left-0 right-0 bg-white shadow-md flex flex-col items-center p-4 space-y-2 z-10 lg:hidden">
          <a href="https://threshold.vc/about" className="threshold-nav-link block w-full text-center py-1">About</a>
          <a href="https://threshold.vc/team" className="threshold-nav-link block w-full text-center py-1">Team</a>
          <a href="https://threshold.vc/companies" className="threshold-nav-link block w-full text-center py-1">Companies</a>
          <a href="https://threshold.vc/newsroom" className="threshold-nav-link block w-full text-center py-1">Newsroom</a>
          <a href="https://threshold.vc/podcast" className="threshold-nav-link block w-full text-center py-1">Podcast</a>
        </div>
      )}
    </div>
  );
} 