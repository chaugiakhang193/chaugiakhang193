import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fetchLanguageShares, renderLanguageCard } from "./languages.mjs";

const USER = process.env.GH_USER || "chaugiakhang193";
const TOKEN = process.env.GH_TOKEN;
const README_PATH = "README.md";
const LANGUAGES_PATH = "assets/languages.svg";

// The workflow's quality gate sets these. FRESH is false when the streak card came
// back broken and the gate restored the last committed copy — the README must not
// claim that copy is current. CHANGED is the only way this script can tell that the
// streak card moved, because the card lives in an SVG file the README merely links to.
const STREAK_FRESH = process.env.STREAK_FRESH !== "false";
const STREAK_CHANGED = process.env.STREAK_CHANGED === "true";

const TIME_ZONE = "Asia/Ho_Chi_Minh";

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
  // The profile repo only holds this workflow's own auto-commits. Excluding it
  // inside the query matters: filtering a fixed window afterwards left the
  // section empty once a week of bot commits filled the whole window.
  const profileRepo = `${USER}/${USER}`;
  const data = await gh(
    `/search/commits?q=author:${USER}+is:public+-repo:${profileRepo}&sort=author-date&order=desc&per_page=${limit}`
  );
  return data.items
    .filter((item) => item.repository.full_name !== profileRepo)
    .slice(0, limit)
    .map((item) => ({
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
  if (commits.length === 0) {
    return "_No recent public commits outside this profile repo._";
  }
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

// Read the clock in Vietnam time rather than the runner's UTC. A reader of this
// profile counts days the way its owner does, and the commit step already stamps
// commits in the same zone so the contribution graph agrees with the footer.
function vietnamParts(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

function renderStamp(date) {
  const p = vietnamParts(date);
  // en-US for the month name: en-GB abbreviates September to "Sept", the one
  // four-letter odd man out in a footer where every other month is three.
  const month = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    month: "short",
  }).format(date);
  const when = `${p.hour}:${p.minute} · ${Number(p.day)} ${month} ${p.year}`;

  // "Data as of" rather than "last run at": this line is only rewritten when the
  // content above it actually moved, so it names the moment this data became true.
  // That is also what makes it an alarm — if the workflow dies, the date freezes
  // while the rest of the page keeps looking perfectly healthy.
  const line = `<sub>🤖 Auto-updated by GitHub Actions — data as of <b>${when}</b> (Vietnam time, UTC+7).</sub>`;
  if (STREAK_FRESH) return line;

  return [
    line,
    "",
    "<sub>⚠️ The streak card could not be regenerated on this run; the last known-good copy is shown.</sub>",
  ].join("\n");
}

// The cache-busting query is the point of the version here. GitHub serves README
// images through its camo proxy, which caches by URL — without a changing URL the
// proxy can keep handing out a streak card from hours ago no matter what we commit.
function renderStreak(version) {
  return `<img src="./assets/streak.svg?v=${version}" alt="GitHub streak" width="495" />`;
}

// A failed language fetch must not take the rest of the page down with it. The
// last committed card simply stays, the same way the gate treats the streak card.
async function refreshLanguageCard(repos) {
  const profileRepo = `${USER}/${USER}`;
  try {
    const shares = await fetchLanguageShares(
      repos.filter((repo) => repo.full_name !== profileRepo),
      gh
    );
    if (shares.length === 0) return false;
    const card = renderLanguageCard(shares);
    const previous = existsSync(LANGUAGES_PATH)
      ? readFileSync(LANGUAGES_PATH, "utf8")
      : "";
    if (card === previous) return false;
    writeFileSync(LANGUAGES_PATH, card);
    return true;
  } catch (error) {
    console.log(`::warning::Language card not refreshed: ${error.message}`);
    return false;
  }
}

function renderLanguages(version) {
  return `<img src="./assets/languages.svg?v=${version}" alt="Language share across my repositories" width="495" />`;
}

function stampVersion(date) {
  const p = vietnamParts(date);
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}`;
}

function readSection(content, section) {
  const start = `<!--START_SECTION:${section}-->`;
  const end = `<!--END_SECTION:${section}-->`;
  const startIdx = content.indexOf(start);
  const endIdx = content.indexOf(end);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return "";
  return content.slice(startIdx + start.length, endIdx).trim();
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
const [commits, stats, languagesChanged] = await Promise.all([
  fetchLatestCommits(),
  buildStats(repos),
  refreshLanguageCard(repos),
]);

const original = readFileSync(README_PATH, "utf8");
const previousStamp = readSection(original, "stamp");
const previousStreak = readSection(original, "streak");

let content = inject(original, "activity", renderActivity(commits));
content = inject(content, "stats", renderStats(stats));

// Ask whether anything really moved, with the stamp and the image URL pinned to
// their old values so that neither can vote for itself. Letting the stamp count as
// a change would mean a commit on every single run, and a footer whose date only
// ever proves that the clock is running.
const probe = inject(
  inject(content, "streak", previousStreak),
  "stamp",
  previousStamp
);

if (probe === original && !STREAK_CHANGED && !languagesChanged) {
  console.log("Nothing moved — keeping the existing stamp.");
  process.exit(0);
}

const now = new Date();
content = inject(content, "languages", renderLanguages(stampVersion(now)));
content = inject(content, "streak", renderStreak(stampVersion(now)));
content = inject(content, "stamp", renderStamp(now));
writeFileSync(README_PATH, content);

console.log(
  `Done: ${commits.length} commits, ${repos.length} repos, ${stats.commits} public commits total. ` +
    `Streak card ${STREAK_CHANGED ? "changed" : "unchanged"}, ${STREAK_FRESH ? "fresh" : "STALE (gate restored last known-good)"}. ` +
    `Language card ${languagesChanged ? "changed" : "unchanged"}.`
);
