/**
 * GitHub Review Comments
 * 
 * Handles fetching review comments made by user on others' PRs.
 */

const cache = require('../../utils/cache');
const { githubApi, GITHUB_USERNAME, GITHUB_TOKEN } = require('./api');

/**
 * Fetch review comments made by user on others' PRs
 * Uses GitHub Search API to find PRs where user commented
 */
async function getReviewComments(dateRange = null) {
  if (!GITHUB_USERNAME || !GITHUB_TOKEN) {
    return { totalComments: 0, prsReviewed: 0, avgCommentsPerPR: 0, avgReviewsPerMonth: 0, byRepo: [], monthlyComments: {} };
  }

  const cacheKey = `github-comments:v3:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ GitHub comments served from cache');
    return cached;
  }

  console.log('📦 Fetching GitHub review comments...');
  
  // Build search query
  let query = `commenter:${GITHUB_USERNAME} type:pr -author:${GITHUB_USERNAME}`;
  if (dateRange?.start) query += ` created:>=${dateRange.start}`;
  if (dateRange?.end) query += ` created:<=${dateRange.end}`;

  const reviewedPRs = [];
  let page = 1;

  while (page <= 10) {
    try {
      const response = await githubApi.get('/search/issues', {
        params: { q: query, per_page: 100, page, sort: 'updated', order: 'desc' }
      });

      if (response.data.items.length === 0) break;
      reviewedPRs.push(...response.data.items);
      
      if (response.data.items.length < 100 || reviewedPRs.length >= response.data.total_count) break;
      page++;
    } catch (error) {
      console.error('  Search error:', error.message);
      break;
    }
  }

  console.log(`  Found ${reviewedPRs.length} PRs where user commented`);

  // Group by repo and month
  const commentsByRepo = new Map();
  const commentsByMonth = new Map();
  
  for (const pr of reviewedPRs) {
    const repo = pr.repository_url?.match(/repos\/(.+)$/)?.[1] || 'unknown';
    const month = pr.created_at?.substring(0, 7) || 'unknown';
    
    if (!commentsByRepo.has(repo)) {
      commentsByRepo.set(repo, { repo, prsReviewed: 0 });
    }
    commentsByRepo.get(repo).prsReviewed++;
    
    if (!commentsByMonth.has(month)) {
      commentsByMonth.set(month, 0);
    }
    commentsByMonth.set(month, commentsByMonth.get(month) + 1);
  }

  // Sample PRs to estimate average comments
  const sampleSize = Math.min(30, reviewedPRs.length);
  let sampleComments = 0;
  
  if (sampleSize > 0) {
    console.log(`  → Sampling ${sampleSize} PRs for comment counts...`);
    
    const samplePRs = reviewedPRs.slice(0, sampleSize);
    const results = await Promise.all(samplePRs.map(async (pr) => {
      try {
        const repo = pr.repository_url?.match(/repos\/(.+)$/)?.[1];
        if (!repo) return 1;

        const [reviewRes, issueRes] = await Promise.all([
          githubApi.get(`/repos/${repo}/pulls/${pr.number}/comments`, { params: { per_page: 100 } }).catch(() => ({ data: [] })),
          githubApi.get(`/repos/${repo}/issues/${pr.number}/comments`, { params: { per_page: 100 } }).catch(() => ({ data: [] }))
        ]);

        const reviewComments = (reviewRes.data || []).filter(c => c.user?.login === GITHUB_USERNAME).length;
        const issueComments = (issueRes.data || []).filter(c => c.user?.login === GITHUB_USERNAME).length;
        return reviewComments + issueComments;
      } catch {
        return 1;
      }
    }));
    
    sampleComments = results.reduce((sum, count) => sum + count, 0);
  }

  const avgCommentsPerPR = sampleSize > 0 ? Math.round((sampleComments / sampleSize) * 10) / 10 : 1;
  const prsReviewed = reviewedPRs.length;
  const totalComments = Math.round(prsReviewed * avgCommentsPerPR);

  const byRepo = Array.from(commentsByRepo.values()).map(r => ({
    ...r,
    comments: Math.round(r.prsReviewed * avgCommentsPerPR)
  })).sort((a, b) => b.comments - a.comments);

  const result = {
    totalComments,
    prsReviewed,
    avgCommentsPerPR,
    avgReviewsPerMonth: Math.round((prsReviewed / Math.max(1, commentsByMonth.size)) * 10) / 10,
    byRepo,
    monthlyComments: Object.fromEntries(
      Array.from(commentsByMonth.entries()).map(([month, prs]) => [month, Math.round(prs * avgCommentsPerPR)])
    )
  };

  cache.set(cacheKey, result, 300);
  console.log(`  ✓ ${prsReviewed} PRs reviewed, ~${totalComments} comments`);
  
  return result;
}

module.exports = {
  getReviewComments
};

