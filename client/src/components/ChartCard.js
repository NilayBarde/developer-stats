import React from 'react';
import './ChartCard.css';

function ChartCard({ title, children }) {
  return (
    <div className="chart-card">
      <h3 className="chart-card-title">{title}</h3>
      <div className="chart-card-content">{children}</div>
    </div>
  );
}

export default ChartCard;

