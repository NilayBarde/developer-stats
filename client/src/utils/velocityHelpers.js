/**
 * Extract sprint number from sprint name
 */
export function extractSprintNum(name) {
  if (!name) return '';
  const match = name.match(/(\d+)/);
  return match ? match[1] : '';
}

/**
 * Format velocity subtitle with comparisons
 * @param {number} velocity - Average velocity per sprint
 * @param {number} totalSprints - Total number of sprints
 * @param {Object|null} benchmarks - Dynamic benchmarks object from API, or null
 */
export function formatVelocitySubtitle(velocity, totalSprints, benchmarks = null) {
  if (!velocity || velocity === 0) return '';
  
  if (!benchmarks) {
    return `${totalSprints || 0} sprints`;
  }
  
  const fteAvg = benchmarks?.fte?.avgVelocity;
  const p2Avg = benchmarks?.p2?.avgVelocity;
  
  const parts = [`${totalSprints || 0} sprints`];
  
  if (fteAvg !== null && fteAvg !== undefined) {
    const fteDiff = velocity - fteAvg;
    parts.push(`FTE: ${fteAvg} (${fteDiff >= 0 ? '+' : ''}${fteDiff.toFixed(1)})`);
  }
  
  if (p2Avg !== null && p2Avg !== undefined) {
    const p2Diff = velocity - p2Avg;
    parts.push(`P2: ${p2Avg} (${p2Diff >= 0 ? '+' : ''}${p2Diff.toFixed(1)})`);
  }
  
  return parts.join(' | ');
}

