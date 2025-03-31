import React from 'react';

const Footer: React.FC = () => {
  return (
    <div className="threshold-footer wf-section">
      <div className="threshold-container">
        <div className="threshold-footer-columns">
          <div className="threshold-footer-logo">
            <a href="https://threshold.vc/" className="threshold-footer-logo-link">
              {/* Ensure paths are root-relative from the public dir */}
              <img src="/attached_assets/threshold-logo-color.svg" loading="lazy" alt="Threshold logo" className="threshold-logo-mb" />
            </a>
          </div>
          <div className="threshold-footer-col">
            <a href="https://threshold.vc/" className="threshold-footer-title threshold-subs">Homepage</a>
            <a href="https://threshold.vc/about" className="threshold-footer-title threshold-subs">About</a>
            <a href="https://threshold.vc/team" className="threshold-footer-title threshold-subs">Team</a>
            <a href="https://threshold.vc/companies" className="threshold-footer-title threshold-subs">Companies</a>
            <a href="https://threshold.vc/newsroom" className="threshold-footer-title threshold-subs">News</a>
            <a href="https://threshold.vc/newsroom/latest" className="threshold-footer-link">Latest</a>
            <a href="https://threshold.vc/newsroom/founder-qa" className="threshold-footer-link">Founder Q&amp;A</a>
            <a href="https://threshold.vc/newsroom/viewpoints" className="threshold-footer-link">Viewpoints</a>
          </div>
          <div className="threshold-footer-col">
            <a href="https://threshold.vc/podcast" className="threshold-footer-title threshold-subs">Podcast</a>
            <a href="https://careers.threshold.vc/" className="threshold-footer-title threshold-subs">Careers</a>
            <a href="https://services.sungarddx.com" className="threshold-footer-title threshold-subs">Investor Reports</a>
            <a href="https://threshold.vc/contact" className="threshold-footer-title">Contact</a>
          </div>
          <div className="threshold-footer-col threshold-extra">
            <div className="threshold-social">
              <a href="https://www.linkedin.com/company/thresholdvc/" target="_blank" rel="noopener noreferrer" className="threshold-social-link">
                <img src="/attached_assets/TV-LinkedIn.svg" loading="lazy" alt="LinkedIn" />
              </a>
              <a href="https://twitter.com/thresholdvc" target="_blank" rel="noopener noreferrer" className="threshold-social-link">
                <img src="/attached_assets/TV-Twitter.svg" loading="lazy" alt="Twitter" />
              </a>
              <a href="https://medium.com/threshold-ventures" target="_blank" rel="noopener noreferrer" className="threshold-social-link">
                <img src="/attached_assets/TV-Medium.svg" loading="lazy" alt="Medium" />
              </a>
            </div>
            <div className="threshold-footer-divider"></div>
            <a href="https://threshold.vc/terms-conditions" className="threshold-footer-link threshold-small-links">Terms and Conditions</a>
          </div>
          <div className="threshold-copyright">©{new Date().getFullYear()} Threshold</div>
        </div>
      </div>
    </div>
  );
};

export default Footer; 