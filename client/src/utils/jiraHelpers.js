/**
 * Get story points from an issue (same logic as backend)
 */
export function getStoryPoints(issue) {
  if (!issue || !issue.fields) return 0;
  
  const storyPointFields = [
    'customfield_10106',
    'customfield_21766',
    'customfield_10016',
    'customfield_10021',
    'customfield_10002',
    'customfield_10004',
    'customfield_10020',
    'storyPoints'
  ];
  
  for (const fieldName of storyPointFields) {
    const fieldValue = issue.fields[fieldName];
    if (fieldValue !== undefined && fieldValue !== null && fieldValue !== '') {
      const points = Number(fieldValue);
      if (!isNaN(points) && points > 0) return points;
    }
  }
  
  // Fallback: estimate story points from time estimate (8 hours = 1 story point)
  if (issue.fields.timeoriginalestimate) {
    const estimatedPoints = issue.fields.timeoriginalestimate / 3600 / 8;
    if (estimatedPoints > 0) {
      return Math.round(estimatedPoints * 10) / 10;
    }
  }
  
  return 0;
}





