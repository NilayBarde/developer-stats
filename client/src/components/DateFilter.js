import React from 'react';
import './DateFilter.css';

const DATE_RANGES = [
  {
    label: 'July 2025 - Present',
    start: '2025-07-01',
    end: null // null means "present"
  },
  {
    label: 'August 2024 - July 2025',
    start: '2024-08-01',
    end: '2025-07-31'
  },
  {
    label: 'Last 6 Months',
    start: null, // null means calculate dynamically
    end: null
  },
  {
    label: 'Last 12 Months',
    start: null,
    end: null
  },
  {
    label: 'All Time',
    start: null,
    end: null
  }
];

function DateFilter({ value, onChange }) {
  const handleChange = (e) => {
    const selectedIndex = parseInt(e.target.value);
    const selectedRange = DATE_RANGES[selectedIndex];
    onChange(selectedRange);
  };

  const getCurrentValue = () => {
    if (!value) return 0;
    
    return DATE_RANGES.findIndex(range => {
      if (range.type === 'dynamic' && value.range === range.range) {
        return true;
      }
      if (range.type === 'custom' && value.start === range.start && value.end === range.end) {
        return true;
      }
      return false;
    });
  };

  return (
    <div className="date-filter">
      <label htmlFor="date-range-select">Date Range:</label>
      <select
        id="date-range-select"
        className="date-filter-select"
        value={getCurrentValue()}
        onChange={handleChange}
      >
        {DATE_RANGES.map((range, index) => (
          <option key={index} value={index}>
            {range.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default DateFilter;

