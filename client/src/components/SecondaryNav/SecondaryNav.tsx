import React from 'react';
import styles from './SecondaryNav.module.css'; // Assuming CSS Modules

// Simple Beta Label Component (can be customized/styled further)
const BetaLabel = () => (
  <span className={styles.betaSublabel}>(beta)</span>
);

const SecondaryNav = () => {
  return (
    <nav className={styles.secondaryNav}>
      <a 
        href="https://threshold.vc/podcast" 
        className={`${styles.secondaryNavLink} ${styles.active}`}
      >
        Podcast
      </a>
      <div className={styles.secondaryNavDivider}></div>
      <a 
        href="https://threshold.vc/podcast?season=1" 
        className={styles.secondaryNavLink}
      >
        Season 1
      </a>
      <a 
        href="https://threshold.vc/podcast?season=2" 
        className={styles.secondaryNavLink}
      >
        Season 2
      </a>
      <a 
        href="https://threshold.vc/podcast?season=3" 
        className={styles.secondaryNavLink}
      >
        Season 3
      </a>
      <a 
        href="https://threshold.vc/podcast?season=4" 
        className={styles.secondaryNavLink}
      >
        Season 4
      </a>
      <a 
        href="/advice" 
        className={`${styles.secondaryNavLink} ${styles.active}`} 
        aria-current="page"
      >
        Ask Heidi AI <BetaLabel />
      </a>
    </nav>
  );
};

export default SecondaryNav; 