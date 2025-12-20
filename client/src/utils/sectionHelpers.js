/**
 * Render error section for a source
 */
export function renderErrorSection(source, icon, error) {
  if (!error) return null;
  
  const icons = {
    github: '📦',
    gitlab: '🔷',
    jira: '📋'
  };
  
  return (
    <div className="source-section error">
      <h2>{icons[source] || icon} {source.charAt(0).toUpperCase() + source.slice(1)}</h2>
      <p className="error-message">{error}</p>
    </div>
  );
}

/**
 * Get source section configuration
 */
export function getSourceConfig(source) {
  const configs = {
    github: {
      icon: '📦',
      prLabel: 'PRs',
      monthlyPRsField: 'monthlyPRs',
      avgPerMonthField: 'avgPRsPerMonth'
    },
    gitlab: {
      icon: '🔷',
      mrLabel: 'MRs',
      monthlyPRsField: 'monthlyMRs',
      avgPerMonthField: 'avgMRsPerMonth'
    }
  };
  
  return configs[source] || {};
}

