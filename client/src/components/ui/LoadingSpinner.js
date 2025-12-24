import React from 'react';
import './LoadingSpinner.css';

/**
 * A simple reusable loading spinner
 * 
 * @param {string} size - 'small', 'medium', 'large'
 * @param {string} text - Optional text to display below spinner (null by default)
 */
function LoadingSpinner({ size = 'medium', text = null }) {
  return (
    <div className={`loading-spinner-container ${size}`}>
      <div className="loading-spinner-circle"></div>
      {text && <p className="loading-spinner-text">{text}</p>}
    </div>
  );
}

export default LoadingSpinner;
