// Bytes alone let one large repo drown every other project. Weighting by how many
// repos use a language keeps smaller projects visible, the same idea as the
// size/count weights of github-readme-stats, fixed here at 0.5 each.
const SIZE_WEIGHT = 0.5;
const COUNT_WEIGHT = 0.5;

// Markup, templates and build files say little about which languages the owner
// writes, so they go into "Other" whatever their size.
const FOLDED_INTO_OTHER = new Set([
  "HTML",
  "CSS",
  "SCSS",
  "Handlebars",
  "Dockerfile",
  "PLpgSQL",
  "Makefile",
]);
const MAX_NAMED = 6;

// Linguist colours, so the bar reads like the language strip on each repo page.
const COLORS = {
  TypeScript: "#3178c6",
  Go: "#00ADD8",
  JavaScript: "#f1e05a",
  Java: "#b07219",
  Python: "#3572A5",
};
const FALLBACK_COLOR = "#c9d1d9";
const OTHER_COLOR = "#8b949e";

// Sized and coloured like the streak card so the two sit together as one block.
const WIDTH = 495;
const PADDING_X = 25;
const BAR_WIDTH = WIDTH - PADDING_X * 2;
const BAR_Y = 50;
const BAR_HEIGHT = 10;
const LEGEND_TOP = 90;
const ROW_HEIGHT = 25;
const COLUMNS = 2;
// The streak card's own height. The two cards sit side by side in the README, so
// a shorter card here would leave the pair visibly uneven.
const MIN_HEIGHT = 195;

export async function fetchLanguageShares(repos, gh) {
  const bytes = new Map();
  const repoCount = new Map();
  for (const repo of repos) {
    const languages = await gh(`/repos/${repo.full_name}/languages`);
    for (const [name, size] of Object.entries(languages)) {
      bytes.set(name, (bytes.get(name) ?? 0) + size);
      repoCount.set(name, (repoCount.get(name) ?? 0) + 1);
    }
  }

  const scored = [...bytes].map(([name, size]) => ({
    name,
    score: size ** SIZE_WEIGHT * repoCount.get(name) ** COUNT_WEIGHT,
  }));
  const total = scored.reduce((sum, item) => sum + item.score, 0);
  if (total === 0) return [];

  const named = scored
    .filter((item) => !FOLDED_INTO_OTHER.has(item.name))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_NAMED);
  const namedScore = named.reduce((sum, item) => sum + item.score, 0);

  const shares = named.map((item) => ({
    name: item.name,
    share: item.score / total,
    color: COLORS[item.name] ?? FALLBACK_COLOR,
  }));
  const otherShare = (total - namedScore) / total;
  if (otherShare > 1e-9) {
    shares.push({ name: "Other", share: otherShare, color: OTHER_COLOR });
  }
  return shares;
}

function escapeXml(text) {
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  return text.replace(/[&<>"]/g, (char) => entities[char]);
}

function formatShare(share) {
  const percent = share * 100;
  return percent < 0.1 ? "<0.1%" : `${percent.toFixed(1)}%`;
}

export function renderLanguageCard(shares) {
  const rows = Math.ceil(shares.length / COLUMNS);
  const height = Math.max(MIN_HEIGHT, LEGEND_TOP + rows * ROW_HEIGHT);
  const columnWidth = BAR_WIDTH / COLUMNS;

  let x = PADDING_X;
  const segments = shares.map((item) => {
    const width = item.share * BAR_WIDTH;
    const rect = `<rect x="${x.toFixed(2)}" y="${BAR_Y}" width="${width.toFixed(2)}" height="${BAR_HEIGHT}" fill="${item.color}"/>`;
    x += width;
    return rect;
  });

  // Fill each column top to bottom, so the list still reads largest first.
  const legend = shares.map((item, index) => {
    const column = Math.floor(index / rows);
    const row = index % rows;
    const left = PADDING_X + column * columnWidth;
    const baseline = LEGEND_TOP + row * ROW_HEIGHT;
    return (
      `<circle cx="${left + 5}" cy="${baseline - 4}" r="5" fill="${item.color}"/>` +
      `<text x="${left + 16}" y="${baseline}" class="label">${escapeXml(item.name)} ` +
      `<tspan class="share">${escapeXml(formatShare(item.share))}</tspan></text>`
    );
  });

  const summary = shares
    .map((item) => `${item.name} ${formatShare(item.share)}`)
    .join(", ");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-labelledby="languages-title">`,
    `<title id="languages-title">Language share: ${escapeXml(summary)}</title>`,
    "<style>",
    ".title{font:600 18px 'Segoe UI',Ubuntu,sans-serif;fill:#FEFEFE}",
    ".note{font:400 11px 'Segoe UI',Ubuntu,sans-serif;fill:#9E9E9E}",
    ".label{font:400 13px 'Segoe UI',Ubuntu,sans-serif;fill:#FEFEFE}",
    ".share{fill:#9E9E9E}",
    "</style>",
    `<rect width="${WIDTH}" height="${height}" rx="4.5" fill="#151515"/>`,
    `<text x="${PADDING_X}" y="34" class="title">Languages</text>`,
    `<text x="${WIDTH - PADDING_X}" y="34" text-anchor="end" class="note">weighted by code size and repo count</text>`,
    `<clipPath id="languages-bar"><rect x="${PADDING_X}" y="${BAR_Y}" width="${BAR_WIDTH}" height="${BAR_HEIGHT}" rx="5"/></clipPath>`,
    `<g clip-path="url(#languages-bar)">${segments.join("")}</g>`,
    ...legend,
    "</svg>",
    "",
  ].join("\n");
}
