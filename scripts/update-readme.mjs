import { readFileSync, writeFileSync } from "node:fs";

const USER = process.env.GH_USER || "chaugiakhang193";
const TOKEN = process.env.GH_TOKEN;
const README_PATH = "README.md";

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `${USER}-profile-bot`,
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${path} -> ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function timeAgo(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return months === 1 ? "1 month ago" : `${months} months ago`;
  }
  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

// A pipe inside a commit message would break the markdown table
function escapePipe(text) {
  return text.replace(/\|/g, "\\|");
}

async function fetchLatestCommits(limit = 5) {
  const data = await gh(
    `/search/commits?q=author:${USER}+is:public&sort=author-date&order=desc&per_page=${limit}`
  );
  return data.items.map((item) => ({
    title: item.commit.message.split("\n")[0],
    repoName: item.repository.name,
    repoFull: item.repository.full_name,
    url: item.html_url,
    date: item.commit.author.date,
  }));
}

async function fetchOwnedRepos() {
  const repos = await gh(
    `/users/${USER}/repos?type=owner&sort=pushed&per_page=100`
  );
  return repos.filter((repo) => !repo.fork);
}

async function buildStats(repos) {
  const search = await gh(
    `/search/commits?q=author:${USER}+is:public&per_page=1`
  );
  const languages = [...new Set(repos.map((r) => r.language).filter(Boolean))];
  return {
    commits: search.total_count,
    repos: repos.length,
    languages,
    stars: repos.reduce((sum, repo) => sum + repo.stargazers_count, 0),
  };
}

function renderActivity(commits) {
  const rows = commits.map(
    (c) =>
      `| [\`${c.repoName}\`](https://github.com/${c.repoFull}) | [${escapePipe(c.title)}](${c.url}) | ${timeAgo(c.date)} |`
  );
  return ["| Repo | Commit | When |", "| :--- | :--- | ---: |", ...rows].join(
    "\n"
  );
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

function renderStats(stats) {
  return [
    `- **${stats.commits.toLocaleString("en-US")}** public ${plural(stats.commits, "commit", "commits")}`,
    `- **${stats.repos}** own ${plural(stats.repos, "repository", "repositories")} (forks excluded)`,
    `- **${stats.languages.length}** ${plural(stats.languages.length, "language", "languages")} — ${stats.languages.join(", ")}`,
    `- **${stats.stars}** ${plural(stats.stars, "star", "stars")} earned`,
  ].join("\n");
}

function inject(content, section, body) {
  const start = `<!--START_SECTION:${section}-->`;
  const end = `<!--END_SECTION:${section}-->`;
  const startIdx = content.indexOf(start);
  const endIdx = content.indexOf(end);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`Missing marker "${section}" in ${README_PATH}`);
  }
  if (endIdx < startIdx) {
    throw new Error(`Marker "${section}" is reversed in ${README_PATH}`);
  }
  return (
    content.slice(0, startIdx + start.length) +
    "\n" +
    body +
    "\n" +
    content.slice(endIdx)
  );
}

const repos = await fetchOwnedRepos();
const [commits, stats] = await Promise.all([
  fetchLatestCommits(),
  buildStats(repos),
]);

let content = readFileSync(README_PATH, "utf8");
content = inject(content, "activity", renderActivity(commits));
content = inject(content, "stats", renderStats(stats));
writeFileSync(README_PATH, content);

console.log(
  `Done: ${commits.length} commits, ${repos.length} repos, ${stats.commits} public commits total.`
);
