/**
 * Extract users from engineering-metrics files and generate users.json
 * 
 * This script reads user definitions from engineering-metrics files:
 * - GitHub: individual_github/github.js (uses GitHub usernames)
 * - GitLab: individual_gitlab/user_processing/gitlab.js (uses GitLab user IDs)
 * - JIRA: JIRA/jira_authored.js (uses email addresses)
 * 
 * Usage:
 *   node server/utils/extractUsersFromEngineeringMetrics.js [path-to-engineering-metrics]
 * 
 * Default path: ../engineering-metrics
 */

const fs = require('fs');
const path = require('path');

// Default path to engineering-metrics directory
const DEFAULT_EM_PATH = path.join(__dirname, '../../..', 'engineering-metrics');

/**
 * Extract GitHub users from github.js
 */
function extractGitHubUsers(emPath) {
  const githubFile = path.join(emPath, 'individual_github', 'github.js');
  
  if (!fs.existsSync(githubFile)) {
    console.warn(`⚠️  GitHub file not found: ${githubFile}`);
    return {};
  }
  
  const content = fs.readFileSync(githubFile, 'utf8');
  const usersMatch = content.match(/users\s*=\s*\[([\s\S]*?)\]/);
  
  if (!usersMatch) {
    console.warn('⚠️  Could not parse GitHub users array');
    return {};
  }
  
  const usersArray = usersMatch[1];
  const userMap = {};
  
  // Parse each user: {id: 'username', name: 'Name'}
  const userRegex = /\{id:\s*['"]([^'"]+)['"],\s*name:\s*['"]([^'"]+)['"]\}/g;
  let match;
  
  while ((match = userRegex.exec(usersArray)) !== null) {
    const [, id, name] = match;
    userMap[name] = { github: id };
  }
  
  return userMap;
}

/**
 * Extract GitLab users from gitlab.js
 */
function extractGitLabUsers(emPath) {
  const gitlabFile = path.join(emPath, 'individual_gitlab', 'user_processing', 'gitlab.js');
  
  if (!fs.existsSync(gitlabFile)) {
    console.warn(`⚠️  GitLab file not found: ${gitlabFile}`);
    return {};
  }
  
  const content = fs.readFileSync(gitlabFile, 'utf8');
  const usersMatch = content.match(/users\s*=\s*\[([\s\S]*?)\]/);
  
  if (!usersMatch) {
    console.warn('⚠️  Could not parse GitLab users array');
    return {};
  }
  
  const usersArray = usersMatch[1];
  const userMap = {};
  
  // Parse each user: {id: '12345', name: 'Name'}
  const userRegex = /\{id:\s*['"]([^'"]+)['"],\s*name:\s*['"]([^'"]+)['"]\}/g;
  let match;
  
  while ((match = userRegex.exec(usersArray)) !== null) {
    const [, id, name] = match;
    if (!userMap[name]) {
      userMap[name] = {};
    }
    userMap[name].gitlab = id;
  }
  
  return userMap;
}

/**
 * Extract JIRA users from a single JIRA file
 */
function extractJiraUsersFromFile(jiraFile) {
  if (!fs.existsSync(jiraFile)) {
    return {};
  }
  
  const content = fs.readFileSync(jiraFile, 'utf8');
  const peopleMapMatch = content.match(/var\s+peopleMap\s*=\s*\{([\s\S]*?)\};/);
  
  if (!peopleMapMatch) {
    return {};
  }
  
  const peopleMapContent = peopleMapMatch[1];
  const userMap = {};
  
  // Parse each entry: 'email@disney.com': { level: 'P2' }
  // Extract email and try to match by name from email
  const emailRegex = /['"]([^'"]+@[^'"]+)['"]\s*:\s*\{[^}]*\}/g;
  let match;
  
  while ((match = emailRegex.exec(peopleMapContent)) !== null) {
    const email = match[1];
    // Try to extract name from email (e.g., 'aaron.ching@disney.com' -> 'Aaron')
    // This is approximate - we'll match by name later
    const emailName = email.split('@')[0].split('.').map(part => 
      part.charAt(0).toUpperCase() + part.slice(1)
    ).join(' ');
    
    // Store email with various name formats for matching
    const nameVariations = [
      emailName,
      emailName.split(' ')[0], // First name only
      emailName.split(' ').slice(0, 2).join(' '), // First + middle
    ];
    
    nameVariations.forEach(name => {
      if (!userMap[name]) {
        userMap[name] = {};
      }
      userMap[name].jira = email;
    });
  }
  
  return userMap;
}

/**
 * Extract JIRA users from all JIRA files (jira_authored.js, jira_coding_overall.js, jira_coding_ctoi.js)
 */
function extractJiraUsers(emPath) {
  const jiraFiles = [
    path.join(emPath, 'JIRA', 'jira_authored.js'),
    path.join(emPath, 'JIRA', 'jira_coding_overall.js'),
    path.join(emPath, 'JIRA', 'jira_coding_ctoi.js')
  ];
  
  const mergedUserMap = {};
  
  jiraFiles.forEach(jiraFile => {
    const fileUserMap = extractJiraUsersFromFile(jiraFile);
    // Merge users from this file into the merged map
    Object.keys(fileUserMap).forEach(name => {
      if (!mergedUserMap[name]) {
        mergedUserMap[name] = {};
      }
      // Use the email from this file (they should be the same, but this ensures we get all)
      mergedUserMap[name].jira = fileUserMap[name].jira;
    });
  });
  
  if (Object.keys(mergedUserMap).length === 0) {
    console.warn('⚠️  No JIRA users found in any JIRA files');
  }
  
  return mergedUserMap;
}

/**
 * Normalize name for matching (remove extra spaces, handle variations)
 */
function normalizeName(name) {
  return name.trim().toLowerCase();
}

/**
 * Extract first name from a name string
 */
function getFirstName(name) {
  return normalizeName(name).split(' ')[0];
}

/**
 * Extract last name initial from name (e.g., "David M" -> "m", "David N" -> "n")
 */
function getLastNameInitial(name) {
  const parts = normalizeName(name).split(' ');
  if (parts.length > 1) {
    const lastPart = parts[parts.length - 1];
    // If last part is a single letter, it's likely an initial
    if (lastPart.length === 1) {
      return lastPart;
    }
    // Otherwise, get first letter of last name
    return lastPart.charAt(0);
  }
  return null;
}


/**
 * Derive JIRA email from GitHub username
 * Pattern: liam-odonnell -> liam.odonnell@disney.com
 */
function deriveJiraEmailFromGitHubUsername(githubUsername) {
  // Convert GitHub username to JIRA email format
  // Replace hyphens with dots and append @disney.com
  const emailLocalPart = githubUsername.toLowerCase().replace(/-/g, '.');
  return `${emailLocalPart}@disney.com`;
}

/**
 * Check if two emails are variations of the same person (e.g., gus.argueta vs gustavo.argueta)
 */
function areEmailVariations(email1, email2) {
  const local1 = email1.split('@')[0].toLowerCase();
  const local2 = email2.split('@')[0].toLowerCase();
  
  // Normalize gus/gustavo variations
  const normalized1 = local1.replace(/^gus\./, 'gustavo.').replace(/^gustavo\./, 'gus.');
  const normalized2 = local2.replace(/^gus\./, 'gustavo.').replace(/^gustavo\./, 'gus.');
  
  return normalized1 === normalized2;
}

/**
 * Find JIRA user by matching name and optionally deriving from GitHub username
 */
function findJiraUser(name, jiraUsers, githubUsername = null) {
  const firstName = getFirstName(name);
  const lastNameInitial = getLastNameInitial(name);
  const jiraKeys = Object.keys(jiraUsers);
  
  // Try exact name match first
  for (const key of jiraKeys) {
    const keyFirstName = getFirstName(key);
    const keyLastNameInitial = getLastNameInitial(key);
    
    // Match by first name + last initial (for "David M" vs "David N")
    if (keyFirstName === firstName && lastNameInitial && keyLastNameInitial === lastNameInitial) {
      return jiraUsers[key].jira;
    }
    
    // Match by first name only
    if (keyFirstName === firstName && !lastNameInitial) {
      return jiraUsers[key].jira;
    }
  }
  
  // Try partial match
  for (const key of jiraKeys) {
    const keyNormalized = normalizeName(key);
    if (keyNormalized.startsWith(firstName) || firstName.startsWith(keyNormalized.split(' ')[0])) {
      return jiraUsers[key].jira;
    }
  }
  
  // Derive from GitHub username if available
  if (githubUsername) {
    const derivedEmail = deriveJiraEmailFromGitHubUsername(githubUsername);
    // Check if derived email exists in JIRA users
    for (const key of jiraKeys) {
      if (jiraUsers[key].jira === derivedEmail) {
        return derivedEmail;
      }
    }
    // Use derived email even if not in peopleMap
    return derivedEmail;
  }
  
  return null;
}

/**
 * Merge user data from all sources
 * Strategy: Use GitHub username as primary ID (matches engineering-metrics), match GitLab/JIRA by name
 */
function mergeUsers(githubUsers, gitlabUsers, jiraUsers) {
  const merged = {};
  const processedJiraEmails = new Set();
  const processedGitLabIds = new Set();
  
  // Helper to mark email variations as processed
  const markEmailProcessed = (email) => {
    processedJiraEmails.add(email);
    // Mark common variations (gus/gustavo)
    const local = email.split('@')[0];
    if (local.startsWith('gus.')) {
      processedJiraEmails.add(local.replace(/^gus\./, 'gustavo.') + '@disney.com');
    } else if (local.startsWith('gustavo.')) {
      processedJiraEmails.add(local.replace(/^gustavo\./, 'gus.') + '@disneystreaming.com');
    }
  };
  
  // Helper to check if email is already processed (including variations)
  const isEmailProcessed = (email) => {
    if (processedJiraEmails.has(email)) return true;
    // Check if any processed email is a variation
    for (const processedEmail of processedJiraEmails) {
      if (areEmailVariations(email, processedEmail)) return true;
    }
    return false;
  };
  
  // Start with GitHub users - use GitHub username as primary ID
  Object.keys(githubUsers).forEach(name => {
    const githubUsername = githubUsers[name].github;
    const user = {
      id: githubUsername,
      name: name,
      github: { username: githubUsername }
    };
    
    // Match GitLab by name
    if (gitlabUsers[name]) {
      user.gitlab = { username: gitlabUsers[name].gitlab };
      processedGitLabIds.add(gitlabUsers[name].gitlab);
    }
    
    // Match JIRA by name or derive from GitHub username
    const jiraEmail = findJiraUser(name, jiraUsers, githubUsername);
    if (jiraEmail) {
      user.jira = { email: jiraEmail };
      markEmailProcessed(jiraEmail);
    }
    
    merged[githubUsername] = user;
  });
  
  // Add GitLab-only users
  Object.keys(gitlabUsers).forEach(name => {
    const gitlabId = gitlabUsers[name].gitlab;
    if (!processedGitLabIds.has(gitlabId)) {
      const user = {
        id: `gitlab-${gitlabId}`,
        name: name,
        gitlab: { username: gitlabId }
      };
      
      const jiraEmail = findJiraUser(name, jiraUsers);
      if (jiraEmail && !isEmailProcessed(jiraEmail)) {
        user.jira = { email: jiraEmail };
        markEmailProcessed(jiraEmail);
      }
      
      merged[user.id] = user;
      processedGitLabIds.add(gitlabId);
    }
  });
  
  // Add JIRA-only users (skip duplicates/variations)
  Object.keys(jiraUsers).forEach(jiraName => {
    const jiraEmail = jiraUsers[jiraName].jira;
    if (!isEmailProcessed(jiraEmail)) {
      merged[`jira-${jiraEmail.split('@')[0]}`] = {
        id: `jira-${jiraEmail.split('@')[0]}`,
        name: jiraName,
        jira: { email: jiraEmail }
      };
      markEmailProcessed(jiraEmail);
    }
  });
  
  return Object.values(merged);
}

/**
 * Main function
 */
function main() {
  const emPath = process.argv[2] || DEFAULT_EM_PATH;
  
  console.log(`📂 Reading engineering-metrics files from: ${emPath}\n`);
  
  if (!fs.existsSync(emPath)) {
    console.error(`❌ Engineering-metrics directory not found: ${emPath}`);
    console.error(`   Usage: node extractUsersFromEngineeringMetrics.js [path-to-engineering-metrics]`);
    process.exit(1);
  }
  
  // Extract users from each source
  console.log('📖 Extracting GitHub users...');
  const githubUsers = extractGitHubUsers(emPath);
  console.log(`   Found ${Object.keys(githubUsers).length} GitHub users`);
  
  console.log('📖 Extracting GitLab users...');
  const gitlabUsers = extractGitLabUsers(emPath);
  console.log(`   Found ${Object.keys(gitlabUsers).length} GitLab users`);
  
  console.log('📖 Extracting JIRA users...');
  const jiraUsers = extractJiraUsers(emPath);
  console.log(`   Found ${Object.keys(jiraUsers).length} JIRA users\n`);
  
  // Merge users
  console.log('🔗 Merging user data...');
  const mergedUsers = mergeUsers(githubUsers, gitlabUsers, jiraUsers);
  console.log(`   Merged ${mergedUsers.length} total users\n`);
  
  // Generate output
  const outputPath = path.join(__dirname, '..', 'config', 'users.json');
  const output = JSON.stringify(mergedUsers, null, 2);
  
  fs.writeFileSync(outputPath, output, 'utf8');
  
  console.log(`✅ Generated users.json: ${outputPath}`);
  console.log(`\n📊 Summary:`);
  console.log(`   Total users: ${mergedUsers.length}`);
  console.log(`   With GitHub: ${mergedUsers.filter(u => u.github).length}`);
  console.log(`   With GitLab: ${mergedUsers.filter(u => u.gitlab).length}`);
  console.log(`   With JIRA: ${mergedUsers.filter(u => u.jira).length}`);
  console.log(`   Complete (all 3): ${mergedUsers.filter(u => u.github && u.gitlab && u.jira).length}`);
  
  // Show users missing data
  const incomplete = mergedUsers.filter(u => !u.github || !u.gitlab || !u.jira);
  if (incomplete.length > 0) {
    console.log(`\n⚠️  Users missing some data:`);
    incomplete.forEach(u => {
      const missing = [];
      if (!u.github) missing.push('GitHub');
      if (!u.gitlab) missing.push('GitLab');
      if (!u.jira) missing.push('JIRA');
      console.log(`   ${u.name}: missing ${missing.join(', ')}`);
    });
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  extractGitHubUsers,
  extractGitLabUsers,
  extractJiraUsers,
  mergeUsers
};

