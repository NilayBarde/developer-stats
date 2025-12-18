const VELOCITY_BENCHMARKS = {
  P2_AVERAGE: 5.9,
  TEAM_AVERAGE: 6.0
};

/**
 * Format velocity comparison subtitle
 */
export function formatVelocitySubtitle(velocity, totalSprints) {
  if (!velocity || velocity === 0) return '';
  
  const fteDiff = velocity - VELOCITY_BENCHMARKS.TEAM_AVERAGE;
  const p2Diff = velocity - VELOCITY_BENCHMARKS.P2_AVERAGE;
  
  return `${totalSprints || 0} sprints | FTE: ${VELOCITY_BENCHMARKS.TEAM_AVERAGE} (${fteDiff >= 0 ? '+' : ''}${fteDiff.toFixed(1)}) | P2: ${VELOCITY_BENCHMARKS.P2_AVERAGE} (${p2Diff >= 0 ? '+' : ''}${p2Diff.toFixed(1)})`;
}

export { VELOCITY_BENCHMARKS };

