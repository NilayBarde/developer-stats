import React from 'react';
import './LoadingSpinner.css';

/**
 * A reusable loading spinner component with optional text
 */
function LoadingSpinner({ size = 'medium', text = 'Loading data...' }) {
  return (
    <div className={`loading-spinner ${size}`}>
      <div className="spinner-ring"></div>
      {text && <span className="spinner-text">{text}</span>}
    </div>
  );
}

export default LoadingSpinner;

