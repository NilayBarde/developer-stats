/**
 * Get Jira issue URL
 */
export function getJiraUrl(issueKey, baseUrl) {
  const jiraBaseUrl = baseUrl || 'https://jira.disney.com';
  return `${jiraBaseUrl}/browse/${issueKey}`;
}

