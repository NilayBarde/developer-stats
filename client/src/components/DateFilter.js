import React from 'react';
import './DateFilter.css';
import { getCurrentWorkYearStart, formatWorkYearLabel } from '../utils/dateHelpers';

function getWorkYearRanges() {
  const currentWorkYearStart = new Date(getCurrentWorkYearStart());
  const previousWorkYearStart = new Date(currentWorkYearStart.getFullYear() - 1, 8, 1); // September 1
  const previousWorkYearEnd = new Date(currentWorkYearStart.getFullYear(), 7, 31); // August 31
  
  return {
    current: {
      label: formatWorkYearLabel(getCurrentWorkYearStart()),
      start: getCurrentWorkYearStart(),
      end: null // Present
    },
    previous: {
      label: `Previous Work Year (${previousWorkYearStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} - ${previousWorkYearEnd.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })})`,
      start: previousWorkYearStart.toISOString().split('T')[0],
      end: previousWorkYearEnd.toISOString().split('T')[0]
    }
  };
}

function DateFilter({ value, onChange }) {
  const workYearRanges = getWorkYearRanges();
  
  const DATE_RANGES = [
    {
      label: workYearRanges.current.label,
      start: workYearRanges.current.start,
      end: workYearRanges.current.end,
      type: 'custom'
    },
    {
      label: workYearRanges.previous.label,
      start: workYearRanges.previous.start,
      end: workYearRanges.previous.end,
      type: 'custom'
    }
  ];
  const handleChange = (e) => {
    const selectedIndex = parseInt(e.target.value);
    const selectedRange = DATE_RANGES[selectedIndex];
    onChange(selectedRange);
  };

  const getCurrentValue = () => {
    if (!value) return 0;
    
    const index = DATE_RANGES.findIndex(range => {
      if (range.type === 'dynamic' && value.range === range.range) {
        return true;
      }
      if (range.type === 'custom') {
        // For custom ranges, compare start dates (end can be null for "present")
        if (value.start === range.start) {
          // If both have null end or both have same end, it's a match
          if ((!value.end && !range.end) || value.end === range.end) {
            return true;
          }
        }
      }
      return false;
    });
    
    return index >= 0 ? index : 0;
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

