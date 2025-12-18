/**
 * Prepare project data for chart
 */
export function prepareProjectData(byProject) {
  if (!byProject) return [];
  return Object.entries(byProject).map(([project, data]) => ({
    project,
    total: data.total,
    resolved: data.resolved,
    open: data.open
  }));
}

