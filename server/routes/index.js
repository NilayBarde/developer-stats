const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const { createCachedEndpoint } = require('../utils/endpointHelpers');
const { setCacheHeaders } = require('../utils/requestHelpers');
const { generateMockPRsData, generateMockMRsData, generateMockIssuesData } = require('../utils/mockData');
const githubService = require('../services/github');
const gitlabService = require('../services/gitlab');
const jiraService = require('../services/jira');

// Import route modules
const statsRoutes = require('./stats');
const projectsRoutes = require('./projects');

// Mount route modules
router.use('/stats', statsRoutes);
router.use('/projects', projectsRoutes);

// Get GitHub PRs
router.get('/prs', (req, res, next) => {
  if (req.query.mock === 'true') {
    console.log('⚠ Using MOCK PRs data');
    return res.json(generateMockPRsData());
  }
  return createCachedEndpoint({
    cacheKeyPrefix: 'prs',
    fetchFn: (dateRange) => githubService.getAllPRsForPage(dateRange),
    ttl: 300,
    transformResponse: (prs) => ({
      prs,
      baseUrl: process.env.GITHUB_BASE_URL?.replace(/\/$/, '') || 'https://github.com'
    })
  })(req, res, next);
});

// Get GitLab MRs
router.get('/mrs', (req, res, next) => {
  if (req.query.mock === 'true') {
    console.log('⚠ Using MOCK MRs data');
    return res.json(generateMockMRsData());
  }
  return createCachedEndpoint({
    cacheKeyPrefix: 'mrs',
    fetchFn: (dateRange) => gitlabService.getAllMRsForPage(dateRange),
    ttl: 300,
    transformResponse: (mrs) => ({
      mrs,
      baseUrl: process.env.GITLAB_BASE_URL?.replace(/\/$/, '') || 'https://gitlab.com'
    })
  })(req, res, next);
});

// Get Jira issues
router.get('/issues', (req, res, next) => {
  if (req.query.mock === 'true') {
    console.log('⚠ Using MOCK Issues data');
    return res.json(generateMockIssuesData());
  }
  return createCachedEndpoint({
    cacheKeyPrefix: 'issues',
    fetchFn: (dateRange) => jiraService.getAllIssuesForPage(dateRange),
    ttl: 120,
    transformResponse: (issues) => ({
      issues,
      baseUrl: process.env.JIRA_BASE_URL?.replace(/\/$/, '')
    })
  })(req, res, next);
});

// Get Logbook data (aggregated timeline by month)
router.get('/logbook', async (req, res) => {
  const { startDate, endDate } = req.query;
  const useMock = req.query.mock === 'true';
  
  const dateRange = {
    start: startDate || null,
    end: endDate || null
  };
  
  const cacheKey = `logbook:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    setCacheHeaders(res, true);
    return res.json(cached);
  }

  try {
    // Fetch data from all services in parallel (reuses cached data)
    const [jiraIssues, githubPRs, gitlabMRs] = await Promise.all([
      jiraService.getAllIssuesForPage(dateRange).catch(err => {
        console.warn('Jira fetch failed:', err.message);
        return [];
      }),
      githubService.getAllPRsForPage(dateRange).catch(err => {
        console.warn('GitHub fetch failed:', err.message);
        return [];
      }),
      gitlabService.getAllMRsForPage(dateRange).catch(err => {
        console.warn('GitLab fetch failed:', err.message);
        return [];
      })
    ]);

    // Helper to get month key from date string
    const getMonthKey = (dateStr) => {
      if (!dateStr) return null;
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return null;
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    };

    // Helper to format month label
    const formatMonthLabel = (monthKey) => {
      const [year, month] = monthKey.split('-');
      const date = new Date(year, parseInt(month) - 1, 1);
      return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    };

    // Group items by month
    const monthsMap = new Map();

    // Process Jira issues (group by created date)
    const { getStoryPoints } = require('../services/jira/scope');
    for (const issue of jiraIssues) {
      // Use _inProgressDate if available, otherwise created date
      const dateToUse = issue._inProgressDate || issue.fields?.created;
      const monthKey = getMonthKey(dateToUse);
      if (!monthKey) continue;

      if (!monthsMap.has(monthKey)) {
        monthsMap.set(monthKey, {
          month: monthKey,
          label: formatMonthLabel(monthKey),
          metrics: { totalItems: 0, jiraIssues: 0, githubPRs: 0, gitlabMRs: 0, storyPoints: 0 },
          items: { jira: [], github: [], gitlab: [] }
        });
      }

      const monthData = monthsMap.get(monthKey);
      const storyPoints = getStoryPoints(issue);
      
      monthData.items.jira.push({
        key: issue.key,
        summary: issue.fields?.summary || '',
        description: issue.fields?.description || '',
        type: issue.fields?.issuetype?.name || 'Unknown',
        status: issue.fields?.status?.name || 'Unknown',
        storyPoints,
        project: issue.fields?.project?.key || '',
        created: issue.fields?.created,
        resolved: issue.fields?.resolutiondate
      });
      
      monthData.metrics.jiraIssues++;
      monthData.metrics.totalItems++;
      monthData.metrics.storyPoints += storyPoints;
    }

    // Process GitHub PRs (group by created date)
    for (const pr of githubPRs) {
      const monthKey = getMonthKey(pr.created_at);
      if (!monthKey) continue;

      if (!monthsMap.has(monthKey)) {
        monthsMap.set(monthKey, {
          month: monthKey,
          label: formatMonthLabel(monthKey),
          metrics: { totalItems: 0, jiraIssues: 0, githubPRs: 0, gitlabMRs: 0, storyPoints: 0 },
          items: { jira: [], github: [], gitlab: [] }
        });
      }

      const monthData = monthsMap.get(monthKey);
      
      monthData.items.github.push({
        id: pr.id,
        number: pr.number,
        title: pr.title || '',
        repo: pr._repoName || '',
        url: pr.html_url || '',
        state: pr.state || '',
        created: pr.created_at,
        merged: pr.merged_at || pr.pull_request?.merged_at
      });
      
      monthData.metrics.githubPRs++;
      monthData.metrics.totalItems++;
    }

    // Process GitLab MRs (group by created date)
    for (const mr of gitlabMRs) {
      const monthKey = getMonthKey(mr.created_at);
      if (!monthKey) continue;

      if (!monthsMap.has(monthKey)) {
        monthsMap.set(monthKey, {
          month: monthKey,
          label: formatMonthLabel(monthKey),
          metrics: { totalItems: 0, jiraIssues: 0, githubPRs: 0, gitlabMRs: 0, storyPoints: 0 },
          items: { jira: [], github: [], gitlab: [] }
        });
      }

      const monthData = monthsMap.get(monthKey);
      
      monthData.items.gitlab.push({
        id: mr.id,
        iid: mr.iid,
        title: mr.title || '',
        project: mr._projectPath || mr._projectName || '',
        url: mr.web_url || '',
        state: mr.state || '',
        created: mr.created_at,
        merged: mr.merged_at
      });
      
      monthData.metrics.gitlabMRs++;
      monthData.metrics.totalItems++;
    }

    // Convert to array and sort by month (most recent first)
    const months = Array.from(monthsMap.values())
      .sort((a, b) => b.month.localeCompare(a.month));

    // Calculate totals
    const totals = {
      totalItems: months.reduce((sum, m) => sum + m.metrics.totalItems, 0),
      jiraIssues: months.reduce((sum, m) => sum + m.metrics.jiraIssues, 0),
      githubPRs: months.reduce((sum, m) => sum + m.metrics.githubPRs, 0),
      gitlabMRs: months.reduce((sum, m) => sum + m.metrics.gitlabMRs, 0),
      storyPoints: months.reduce((sum, m) => sum + m.metrics.storyPoints, 0),
      monthsActive: months.length
    };

    const result = {
      months,
      totals,
      baseUrls: {
        jira: process.env.JIRA_BASE_URL?.replace(/\/$/, '') || '',
        github: process.env.GITHUB_BASE_URL?.replace(/\/$/, '') || 'https://github.com',
        gitlab: process.env.GITLAB_BASE_URL?.replace(/\/$/, '') || 'https://gitlab.com'
      }
    };

    cache.set(cacheKey, result, 300); // 5 minute cache
    setCacheHeaders(res, false);
    res.json(result);
  } catch (error) {
    console.error('Error fetching logbook data:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clear cache endpoint
router.post('/cache/clear', (req, res) => {
  const { prefix } = req.body;
  if (prefix) {
    cache.deleteByPrefix(prefix);
    res.json({ message: `Cache cleared for prefix: ${prefix}` });
  } else {
    cache.clear();
    res.json({ message: 'All cache cleared' });
  }
});

// Get MRs reviewed by the user (comments + approvals)
router.get('/reviews', async (req, res) => {
  try {
    const { gitlabApi } = require('../services/gitlab/api');
    const { getCurrentUserId } = require('../services/gitlab/events');
    
    const userId = await getCurrentUserId();
    console.log('GitLab user ID:', userId);
    
    if (!userId) {
      return res.status(400).json({ error: 'Could not get GitLab user ID' });
    }

    // Fetch ALL events first to see what we get
    const mrMap = new Map();
    let page = 1;
    const maxPages = 100; // Fetch more history
    let totalEvents = 0;
    const actionNames = new Set();
    const targetTypes = new Set();

    while (page <= maxPages) {
      const response = await gitlabApi.get(`/users/${userId}/events`, {
        params: {
          per_page: 100,
          page
        }
      });

      if (!response.data?.length) break;
      totalEvents += response.data.length;

      // Collect action names and target types for debugging
      for (const event of response.data) {
        if (event.action_name) actionNames.add(event.action_name);
        if (event.target_type) targetTypes.add(event.target_type);
        
        // Check for comment-related events (DiffNote, Note, DiscussionNote are comments on MRs)
        const isCommentEvent = event.action_name === 'commented on';
        const isNoteOnMR = ['DiffNote', 'Note', 'DiscussionNote'].includes(event.target_type);
        
        // note.noteable_type tells us if this note is on a MergeRequest
        const noteableType = event.note?.noteable_type;
        const isMRComment = isNoteOnMR && noteableType === 'MergeRequest';
        
        if (isCommentEvent && isMRComment && event.project_id && event.note?.noteable_iid) {
          const mrKey = `${event.project_id}-${event.note.noteable_iid}`;
          
          if (!mrMap.has(mrKey)) {
            mrMap.set(mrKey, {
              project_id: event.project_id,
              iid: event.note.noteable_iid,
              title: 'MR #' + event.note.noteable_iid,
              comments: [],
              created_at: event.created_at
            });
          }
          mrMap.get(mrKey).comments.push({
            created_at: event.created_at
          });
        }
      }

      if (response.data.length < 100) break;
      page++;
    }

    console.log(`Fetched ${totalEvents} total events, found ${mrMap.size} MRs with comments`);
    console.log('Action names:', [...actionNames]);
    console.log('Target types:', [...targetTypes]);

    // Convert to array and sort by comment count
    const reviews = Array.from(mrMap.values())
      .map(mr => ({
        ...mr,
        comment_count: mr.comments.length
      }))
      .sort((a, b) => b.comment_count - a.comment_count);

    // Get project names and MR details for top MRs
    const projectIds = [...new Set(reviews.slice(0, 50).map(r => r.project_id))];
    const projectNames = new Map();
    const mrDetails = new Map();
    
    for (const projectId of projectIds) {
      try {
        const projectRes = await gitlabApi.get(`/projects/${projectId}`);
        projectNames.set(projectId, projectRes.data.path_with_namespace);
      } catch {
        projectNames.set(projectId, `project-${projectId}`);
      }
    }

    // Fetch MR titles for top reviewed MRs
    for (const review of reviews.slice(0, 30)) {
      try {
        const mrRes = await gitlabApi.get(`/projects/${review.project_id}/merge_requests/${review.iid}`);
        mrDetails.set(`${review.project_id}-${review.iid}`, {
          title: mrRes.data.title,
          author: mrRes.data.author?.username,
          state: mrRes.data.state
        });
      } catch {
        // Skip if can't fetch
      }
    }

    // Add project names and proper URLs
    const enrichedReviews = reviews.slice(0, 100).map(r => {
      const details = mrDetails.get(`${r.project_id}-${r.iid}`);
      return {
        title: details?.title || r.title,
        author: details?.author,
        project: projectNames.get(r.project_id) || `project-${r.project_id}`,
        comment_count: r.comment_count,
        url: `https://gitlab.disney.com/${projectNames.get(r.project_id) || 'projects/' + r.project_id}/-/merge_requests/${r.iid}`,
        first_comment: r.comments[0]?.created_at
      };
    });

    // Filter to core and fitt repos
    const coreAndFitt = enrichedReviews.filter(r => 
      r.project.includes('/core') || r.project.includes('/fitt')
    );

    // Filter to MRs authored by others (actual reviews, not self-comments)
    const reviewedOthers = enrichedReviews.filter(r => 
      r.author && r.author.toLowerCase() !== 'nilay.barde'
    );
    
    const reviewedOthersCoreAndFitt = reviewedOthers.filter(r => 
      r.project.includes('/core') || r.project.includes('/fitt')
    );

    res.json({
      total_events_fetched: totalEvents,
      total_mrs_reviewed: mrMap.size,
      total_comments: Array.from(mrMap.values()).reduce((sum, mr) => sum + mr.comments.length, 0),
      reviewed_others: {
        count: reviewedOthers.length,
        core_and_fitt: reviewedOthersCoreAndFitt.slice(0, 30)
      },
      self_comments: {
        count: enrichedReviews.length - reviewedOthers.length,
        top: enrichedReviews.filter(r => r.author?.toLowerCase() === 'nilay.barde').slice(0, 10)
      }
    });
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

