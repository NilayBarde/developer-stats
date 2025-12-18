import React from 'react';
import './StatsCard.css';

function StatsCard({ title, value, subtitle }) {
  return (
    <div className="stats-card">
      <div className="stats-card-title">{title}</div>
      <div className="stats-card-value">{value}</div>
      {subtitle && <div className="stats-card-subtitle">{subtitle}</div>}
    </div>
  );
}

export default StatsCard;

