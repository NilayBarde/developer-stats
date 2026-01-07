import React from 'react';
import Skeleton from './ui/Skeleton';
import './PriorityTable.css';

/**
 * Compact table component for displaying priority-based data
 * 
 * @param {string} title - Table header title
 * @param {Array} columns - Column definitions: [{ key: string, label: string, align?: 'left'|'center'|'right' }]
 * @param {Array} rows - Data rows: [{ priority: 'P1', ...values }]
 * @param {Object} summary - Optional summary row: { label: string, ...values }
 * @param {boolean} loading - Whether to show loading skeleton
 */
function PriorityTable({ title, columns, rows, summary, loading = false }) {
  if (loading) {
    return (
      <div className="priority-table-card priority-table-loading">
        <Skeleton variant="text" width="200px" height="24px" className="priority-table-title-skeleton" />
        <div className="skeleton-table-wrapper">
          <Skeleton variant="table-row" count={4} />
          {summary && <Skeleton variant="table-row" count={1} />}
        </div>
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    // Show skeleton if we have columns defined but no data yet
    if (columns && columns.length > 0) {
      return (
        <div className="priority-table-card priority-table-loading">
          <Skeleton variant="text" width="200px" height="24px" className="priority-table-title-skeleton" />
          <div className="skeleton-table-wrapper">
            <Skeleton variant="table-row" count={4} />
            {summary && <Skeleton variant="table-row" count={1} />}
          </div>
        </div>
      );
    }
    return null;
  }

  // Priority labels and colors
  const priorityLabels = {
    P1: { label: 'P1 - Critical', color: '#e53e3e' },
    P2: { label: 'P2 - High', color: '#dd6b20' },
    P3: { label: 'P3 - Medium', color: '#d69e2e' },
    P4: { label: 'P4 - Low', color: '#38a169' },
  };

  const formatValue = (value) => {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'number') {
      return Number.isInteger(value) ? value : value.toFixed(1);
    }
    return value;
  };

  return (
    <div className="priority-table-card">
      <h3 className="priority-table-title">{title}</h3>
      <table className="priority-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={{ textAlign: col.align || 'left' }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.priority || idx}>
              {columns.map((col) => (
                <td key={col.key} style={{ textAlign: col.align || 'left' }}>
                  {col.key === 'priority' ? (
                    <span className="priority-badge" style={{ 
                      backgroundColor: priorityLabels[row.priority]?.color || '#718096',
                      color: 'white'
                    }}>
                      {priorityLabels[row.priority]?.label || row.priority}
                    </span>
                  ) : (
                    formatValue(row[col.key])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {summary && (
          <tfoot>
            <tr className="summary-row">
              {columns.map((col, idx) => (
                <td key={col.key} style={{ textAlign: col.align || 'left' }}>
                  {idx === 0 ? (
                    <strong>{summary.label || 'Total'}</strong>
                  ) : (
                    <strong>{formatValue(summary[col.key])}</strong>
                  )}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export default PriorityTable;

