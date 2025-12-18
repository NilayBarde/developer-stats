import React from 'react';
import MonthlyChart from './MonthlyChart';

function ChartWithFallback({ data, title, emptyMessage }) {
  if (!data || data.length === 0) {
    return emptyMessage ? <div className="no-data-message">{emptyMessage}</div> : null;
  }
  return <MonthlyChart monthlyData={data} title={title} />;
}

export default ChartWithFallback;

