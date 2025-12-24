import React from 'react';
import './ErrorBanner.css';

/**
 * A reusable error banner component
 * 
 * @param {string} message - Error message to display
 * @param {function} onRetry - Optional retry callback
 */
function ErrorBanner({ message, onRetry = null }) {
  if (!message) return null;
  
  return (
    <div className="error-banner">
      <span>{message}</span>
      {onRetry && (
        <button className="error-retry-btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export default ErrorBanner;

