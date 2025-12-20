/**
 * Helper functions for PR/MR items
 */

/**
 * Get the status of a PR/MR item
 */
export function getItemStatus(item) {
  if (item._source === 'github') {
    return item.state === 'closed' && item.pull_request?.merged_at ? 'merged' : item.state;
  }
  return item.state;
}

/**
 * Get the repository name for a PR/MR item
 */
export function getItemRepo(item) {
  if (item._source === 'github') {
    const match = item.repository_url?.match(/repos\/(.+)$/);
    return match ? match[1] : 'Unknown';
  }
  return item._projectName || item.project?.path_with_namespace || item.project?.name || item.project_id?.toString() || 'Unknown';
}

/**
 * Get the URL for a PR/MR item
 */
export function getItemUrl(item) {
  if (item._source === 'github') {
    if (item.html_url) return item.html_url;
    const repoMatch = item.repository_url?.match(/repos\/(.+)$/);
    if (repoMatch && item.number) {
      return `https://github.com/${repoMatch[1]}/pull/${item.number}`;
    }
  }
  return item.web_url || '#';
}

/**
 * Get the merged date for a PR/MR item
 */
export function getMergedDate(item) {
  if (item._source === 'github') return item.pull_request?.merged_at;
  return item.merged_at;
}

