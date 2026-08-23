import type { PublicQuestion, Category } from "../game/types.ts";
import type { AnswerRecord, SettingsState } from "../state/save.ts";
import type { DerivedStats } from "../state/stats.ts";
import type { Challenge, LeaderboardEntry, LeaderboardPeriod } from "../state/api.ts";
import { containsBannedWord } from "../game/moderation.ts";
import { RangeSlider } from "./slider.ts";
import { formatNumber } from "./format.ts";

export const CATEGORY_LABELS: Record<Category, string> = {
  geography: "Geography",
  history: "History",
  science: "Science",
  sport: "Sport",
  everyday: "Everyday",
  money: "Money",
  nature: "Nature",
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Persistent footer appended below every screen (see main.ts's mountScreen) —
 * keeps the copyright/contact address discoverable no matter where the
 * player is in the app, not just on the Settings screen. */
export function buildAppFooter(): HTMLParagraphElement {
  const footer = el("p", "app-footer", `© ${new Date().getFullYear()} Claude Verne · `);
  const contactLink = document.createElement("a");
  contactLink.href = "mailto:contactme@give-or-take.com";
  contactLink.textContent = "Contact";
  footer.appendChild(contactLink);
  footer.appendChild(document.createTextNode(" · "));
  const privacyLink = document.createElement("a");
  privacyLink.href = "/privacy";
  privacyLink.textContent = "Privacy";
  footer.appendChild(privacyLink);
  return footer;
}

function buildTopBar(title: string, onBack: () => void): HTMLDivElement {
  const bar = el("div", "topbar");
  const back = el("button", "btn-text", "← Back");
  back.type = "button";
  back.addEventListener("click", onBack);
  const heading = el("div", "logo", title);
  bar.append(back, heading);
  return bar;
}

/** Time until the player's next local midnight — a static snapshot at
 * render time, not a live-ticking clock (the point is "there's a new one
 * tomorrow," not second-accurate precision). */
function formatCountdownToNextPuzzle(): string {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  const msRemaining = nextMidnight.getTime() - now.getTime();
  const totalMinutes = Math.max(0, Math.round(msRemaining / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

// ---------- Intro / today card ----------

export interface IntroScreenProps {
  puzzleNumber: number;
  streakCurrent: number;
  dayState: "unplayed" | "inProgress" | "complete";
  isFirstEverPlay: boolean;
  /** Set when the player arrived via a ?c= link for today's puzzle. */
  challenge: Challenge | null;
  onPlay: () => void;
  onStats: () => void;
  onArchive: () => void;
  onSettings: () => void;
  onLeaderboard: () => void;
}

export function buildIntroScreen(props: IntroScreenProps): HTMLDivElement {
  const screen = el("div", "screen");

  const topbar = el("div", "topbar");
  const logo = el("div", "logo");
  logo.innerHTML = `Give or <span class="logo-ball">Take</span>`;
  const streak = el("div", "streak-flame", props.streakCurrent > 0 ? `🔥 ${props.streakCurrent}` : "");
  topbar.append(logo, streak);

  const testerBanner = el("div", "tester-banner");
  testerBanner.appendChild(el("span", "tester-banner-icon", "📱"));
  const testerText = el("span", "tester-banner-text");
  testerText.appendChild(
    document.createTextNode("We're looking for Android testers! Help us test the app before launch — "),
  );
  const testerLink = document.createElement("a");
  testerLink.href = "mailto:contactme@give-or-take.com?subject=Android%20tester";
  testerLink.textContent = "email us";
  testerText.appendChild(testerLink);
  testerText.appendChild(document.createTextNode(" to join."));
  testerBanner.appendChild(testerText);

  const card = el("div", "today-card");
  const puzzleLabel = el("div", "puzzle-number", `Puzzle #${props.puzzleNumber}`);
  card.appendChild(puzzleLabel);

  if (props.challenge) {
    const banner = el("div", "challenge-banner");
    banner.appendChild(el("div", "challenge-banner-icon", "⚔️"));
    banner.appendChild(
      el("div", "challenge-banner-text", `${props.challenge.name} scored ${props.challenge.score}. Beat it.`),
    );
    card.appendChild(banner);
  }

  const playBtn = el("button", "btn btn-primary");
  playBtn.type = "button";
  playBtn.textContent =
    props.dayState === "complete"
      ? "See today's results"
      : props.dayState === "inProgress"
        ? "Continue today's five"
        : props.challenge
          ? "Accept the challenge"
          : "Play today's five";
  playBtn.addEventListener("click", props.onPlay);
  card.appendChild(playBtn);

  screen.append(topbar, testerBanner, card);

  const navLinks = el("div", "nav-links");
  const statsBtn = el("button", undefined, "Stats");
  statsBtn.type = "button";
  statsBtn.addEventListener("click", props.onStats);
  const archiveBtn = el("button", undefined, "Archive");
  archiveBtn.type = "button";
  archiveBtn.addEventListener("click", props.onArchive);
  const leaderboardBtn = el("button", undefined, "Leaderboard");
  leaderboardBtn.type = "button";
  leaderboardBtn.addEventListener("click", props.onLeaderboard);
  const settingsBtn = el("button", undefined, "Settings");
  settingsBtn.type = "button";
  settingsBtn.addEventListener("click", props.onSettings);
  navLinks.append(statsBtn, archiveBtn, leaderboardBtn, settingsBtn);
  screen.appendChild(navLinks);

  return screen;
}

// ---------- Question screen ----------

export interface QuestionScreenHandles {
  el: HTMLDivElement;
  slider: RangeSlider;
  lockInBtn: HTMLButtonElement;
  revealContainer: HTMLDivElement;
  nextBtn: HTMLButtonElement;
}

export interface QuestionScreenProps {
  question: PublicQuestion;
  index: number; // 0-based
  total: number;
  runningScore: number;
  showTutorial: boolean;
  settings: SettingsState;
  isLastQuestion: boolean;
}

export function buildQuestionScreen(props: QuestionScreenProps): QuestionScreenHandles {
  const screen = el("div", "screen");

  const progress = el("div", "question-progress");
  const label = el("span", undefined, `Question ${props.index + 1} of ${props.total}`);
  const score = el("span", "running-score tabular-nums", `${props.runningScore} pts`);
  progress.append(label, score);

  const body = el("div", "question-body");

  if (props.showTutorial) {
    const tutorial = el(
      "p",
      "tutorial-line",
      "Set a range you're sure contains the answer. Tighter range, more points. Miss = zero.",
    );
    body.appendChild(tutorial);
  }

  const meta = el("div", "question-meta", CATEGORY_LABELS[props.question.category]);
  const prompt = el("h1", "question-prompt", props.question.prompt);

  const slider = new RangeSlider({
    question: props.question,
    hapticsEnabled: props.settings.haptics,
  });

  const lockInBtn = el("button", "btn btn-primary", "Lock it in");
  lockInBtn.type = "button";

  const revealContainer = el("div", "reveal-container");

  const nextBtn = el("button", "btn btn-primary", props.isLastQuestion ? "See results" : "Next");
  nextBtn.type = "button";
  nextBtn.style.display = "none";

  body.append(meta, prompt, slider.el, lockInBtn, revealContainer, nextBtn);
  screen.append(progress, body);

  return { el: screen, slider, lockInBtn, revealContainer, nextBtn };
}

// ---------- Results screen ----------

export interface RecapItem {
  question: PublicQuestion;
  answer: AnswerRecord;
}

export interface ResultsScreenProps {
  puzzleNumber: number;
  totalScore: number;
  recap: RecapItem[];
  verdict: string;
  streakCurrent: number;
  isPractice: boolean;
  percentile: number | null;
  /** Set when this day was played in response to someone's ?c= link. */
  challenge: Challenge | null;
  onShare: () => void;
  onHome: () => void;
  onStats: () => void;
  onArchive: () => void;
  onLeaderboard: () => void;
}

/** Resolves the challenge a shared link opened: did they beat the score or not. */
function buildChallengeResult(challenge: Challenge, totalScore: number): HTMLDivElement {
  const won = totalScore > challenge.score;
  const tied = totalScore === challenge.score;
  const box = el("div", `challenge-result ${won ? "state-won" : tied ? "state-tied" : "state-lost"}`);

  const headline = won
    ? `🏆 You beat ${challenge.name}!`
    : tied
      ? `🤝 Dead heat with ${challenge.name}`
      : `${challenge.name}'s score stands`;
  box.appendChild(el("div", "challenge-result-headline", headline));
  box.appendChild(
    el("div", "challenge-result-detail", `You ${totalScore} · ${challenge.name} ${challenge.score}`),
  );
  return box;
}

/**
 * The round as five bars, one per question, each filled by the points taken.
 *
 * This deliberately mirrors the share card built off this same screen. Score
 * is driven by how narrow a bracket you dared to set, so a plain row of
 * hit/miss marks says almost nothing about the round it summarises — and told
 * a visibly different story from the card the share button produces.
 *
 * Points double as the non-colour encoding: a miss reads 0 and a bare hit
 * reads 5, so the row never depends on telling green from red.
 */
function buildScoreBars(recap: readonly RecapItem[]): HTMLDivElement {
  const row = el("div", "score-bars");
  for (const { answer } of recap) {
    const state = answer.tight ? "tight" : answer.hit ? "hit" : "miss";
    const marker = answer.tight ? "🎯" : answer.hit ? "✅" : "❌";

    const cell = el("div", "score-bar");
    cell.dataset.state = state;
    cell.setAttribute("role", "img");
    cell.setAttribute("aria-label", `${state === "tight" ? "Tight hit" : state === "hit" ? "Hit" : "Miss"}, ${answer.points} points`);

    const track = el("div", "score-bar-track");
    const fill = el("div", "score-bar-fill");
    // A bare hit scores MIN_HIT_SCORE, which would otherwise draw the same
    // empty track as a miss; floor it so the distinction stays visible.
    fill.style.height = answer.hit ? `${Math.max(8, answer.points)}%` : "0%";
    track.appendChild(fill);

    cell.append(el("div", "score-bar-marker", marker), track, el("div", "score-bar-value tabular-nums", String(answer.points)));
    row.appendChild(cell);
  }
  return row;
}

export function buildResultsScreen(props: ResultsScreenProps): { el: HTMLDivElement; shareBtn: HTMLButtonElement } {
  const screen = el("div", "screen");

  screen.appendChild(buildTopBar(`Puzzle #${props.puzzleNumber}`, props.onHome));

  const total = el("div", "results-total");
  total.appendChild(el("div", "score-number tabular-nums", String(props.totalScore)));
  total.appendChild(el("div", "score-label", "points"));
  if (props.percentile !== null) {
    total.appendChild(el("div", "results-percentile", `Beat ${props.percentile}% of players today`));
  }

  const scoreBars = buildScoreBars(props.recap);

  const verdict = el("div", "verdict-line", props.verdict);

  const recapList = el("ul", "recap-list");
  for (const { question, answer } of props.recap) {
    const item = el("li", "recap-item");
    const top = el("div", "recap-item-top");
    top.appendChild(el("span", "recap-prompt", question.prompt));
    top.appendChild(
      el(
        "span",
        `recap-points tabular-nums ${answer.hit ? "state-hit" : "state-miss"}`,
        `${answer.hit ? "+" : ""}${answer.points}`,
      ),
    );
    const detail = el(
      "div",
      "recap-detail",
      `Your range: ${formatNumber(answer.lo, question.unit)}–${formatNumber(answer.hi, question.unit)} · Answer: ${formatNumber(answer.trueValue, question.unit)}`,
    );
    item.append(top, detail);
    recapList.appendChild(item);
  }

  const shareBtn = el("button", "btn btn-primary", "Challenge a friend");
  shareBtn.type = "button";
  shareBtn.addEventListener("click", props.onShare);

  screen.append(total, scoreBars, verdict);

  if (props.challenge) {
    screen.appendChild(buildChallengeResult(props.challenge, props.totalScore));
  }

  screen.append(recapList, shareBtn);

  if (props.isPractice) {
    screen.appendChild(el("div", "archive-note", "Practice run — doesn't affect your streak or stats."));
  } else {
    const streakRow = el("div", "streak-row");
    streakRow.appendChild(el("span", undefined, "Current streak"));
    streakRow.appendChild(el("span", "tabular-nums", `🔥 ${props.streakCurrent}`));
    screen.appendChild(streakRow);
    screen.appendChild(el("div", "countdown", `New puzzle in ${formatCountdownToNextPuzzle()}`));
  }

  const navLinks = el("div", "nav-links");
  const statsBtn = el("button", undefined, "Stats");
  statsBtn.type = "button";
  statsBtn.addEventListener("click", props.onStats);
  const archiveBtn = el("button", undefined, "Archive");
  archiveBtn.type = "button";
  archiveBtn.addEventListener("click", props.onArchive);
  const leaderboardBtn = el("button", undefined, "Leaderboard");
  leaderboardBtn.type = "button";
  leaderboardBtn.addEventListener("click", props.onLeaderboard);
  navLinks.append(statsBtn, archiveBtn, leaderboardBtn);
  screen.appendChild(navLinks);

  return { el: screen, shareBtn };
}

// ---------- Stats screen ----------

export function buildStatsScreen(
  stats: DerivedStats,
  onBack: () => void,
  onShareProfile: () => void,
): HTMLDivElement {
  const screen = el("div", "screen");
  screen.appendChild(buildTopBar("Your stats", onBack));

  const grid = el("div", "stats-grid");
  const cards: Array<[string, string]> = [
    ["Current streak", String(stats.currentStreak)],
    ["Best streak", String(stats.bestStreak)],
    ["Games played", String(stats.gamesPlayed)],
    ["Average score", stats.gamesPlayed > 0 ? stats.averageScore.toFixed(0) : "–"],
    ["Hit rate", `${Math.round(stats.hitRate * 100)}%`],
    ["Tight-hit rate", `${Math.round(stats.tightHitRate * 100)}%`],
  ];
  for (const [label, value] of cards) {
    const card = el("div", "stat-card");
    card.appendChild(el("div", "stat-value tabular-nums", value));
    card.appendChild(el("div", "stat-label", label));
    grid.appendChild(card);
  }

  const categorySection = el("div", "category-bars");
  if (stats.categoryHitRates.length === 0) {
    categorySection.appendChild(el("p", "archive-note", "Play a few days to see your hit rate by category."));
  } else {
    for (const c of stats.categoryHitRates) {
      const row = el("div", "category-bar-row");
      row.appendChild(el("span", undefined, CATEGORY_LABELS[c.category]));
      const track = el("div", "category-bar-track");
      const fill = el("div", "category-bar-fill");
      fill.style.width = `${Math.round(c.hitRate * 100)}%`;
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el("span", "tabular-nums", `${Math.round(c.hitRate * 100)}%`));
      categorySection.appendChild(row);
    }
  }

  screen.append(
    grid,
    buildStreakBadges(stats.streakBadges),
    buildConfidenceCard(stats.confidence),
    buildCategoryProfileCard(stats.categoryProfile, onShareProfile),
    categorySection,
  );
  return screen;
}

function buildStreakBadges(badges: DerivedStats["streakBadges"]): HTMLDivElement {
  const row = el("div", "streak-badges");
  for (const badge of badges) {
    const chip = el("div", badge.earned ? "streak-badge earned" : "streak-badge");
    chip.appendChild(el("div", "streak-badge-icon", badge.earned ? "🔥" : "—"));
    chip.appendChild(el("div", "streak-badge-label", badge.label));
    row.appendChild(chip);
  }
  return row;
}

function buildConfidenceCard(confidence: DerivedStats["confidence"]): HTMLDivElement {
  const card = el("div", "confidence-card");
  card.appendChild(el("div", "puzzle-number", "Your calibration"));

  if (!confidence) {
    card.appendChild(el("p", "archive-note", "Play a few more days to unlock your confidence score."));
    return card;
  }

  const headlines: Record<NonNullable<DerivedStats["confidence"]>["label"], string> = {
    overconfident: "You're overconfident",
    underconfident: "You're underconfident",
    calibrated: "You're well calibrated",
  };
  card.appendChild(el("p", "confidence-line", headlines[confidence.label]));

  const detail = el("p", "confidence-detail");
  if (confidence.label === "overconfident") {
    detail.textContent = `Your ranges covered ${confidence.avgWidthPercent}% of the plausible range on average, but you only hit ${confidence.hitRatePercent}% of the time — about ${confidence.gapPercent} points too narrow. Try leaving a little more room.`;
  } else if (confidence.label === "underconfident") {
    detail.textContent = `You hit ${confidence.hitRatePercent}% of the time with ranges covering just ${confidence.avgWidthPercent}% of the plausible range on average — you could tighten by about ${confidence.gapPercent} points and likely still hit, for a bigger score.`;
  } else {
    detail.textContent = `Your range widths track closely with how often you hit — ${confidence.avgWidthPercent}% average width vs a ${confidence.hitRatePercent}% hit rate. Nicely judged.`;
  }
  card.appendChild(detail);
  return card;
}

function buildCategoryProfileCard(
  profile: DerivedStats["categoryProfile"],
  onShareProfile: () => void,
): HTMLDivElement {
  const card = el("div", "confidence-card");
  card.appendChild(el("div", "puzzle-number", "Your category profile"));

  if (!profile) {
    card.appendChild(
      el("p", "archive-note", "Play a few more days across different categories to see your profile."),
    );
    return card;
  }

  const bestPercent = Math.round(profile.best.hitRate * 100);
  const worstPercent = Math.round(profile.worst.hitRate * 100);
  card.appendChild(
    el(
      "p",
      "confidence-line",
      `Sharp on ${CATEGORY_LABELS[profile.best.category]}, hopeless on ${CATEGORY_LABELS[profile.worst.category]}`,
    ),
  );
  card.appendChild(
    el(
      "p",
      "confidence-detail",
      `${bestPercent}% on ${CATEGORY_LABELS[profile.best.category]} · ${worstPercent}% on ${CATEGORY_LABELS[profile.worst.category]}`,
    ),
  );

  const shareBtn = el("button", "btn btn-secondary", "Share profile");
  shareBtn.type = "button";
  shareBtn.addEventListener("click", onShareProfile);
  card.appendChild(shareBtn);

  return card;
}

// ---------- Archive screen ----------

export interface ArchiveEntry {
  date: string;
  puzzleNumber: number;
  played: boolean;
}

export function buildArchiveScreen(
  entries: ArchiveEntry[],
  onPlay: (date: string) => void,
  onBack: () => void,
): HTMLDivElement {
  const screen = el("div", "screen");
  screen.appendChild(buildTopBar("Archive", onBack));
  screen.appendChild(el("p", "archive-note", "Past puzzles, playable any time. Doesn't affect your streak or stats."));

  const list = el("ul", "archive-list");
  for (const entry of entries) {
    const item = el("button", "archive-item");
    item.type = "button";
    const left = el("div");
    left.appendChild(el("div", "archive-item-title", `Puzzle #${entry.puzzleNumber}`));
    left.appendChild(el("div", "archive-item-date", entry.date));
    item.appendChild(left);
    item.appendChild(el("span", "archive-badge", entry.played ? "Played" : "Unplayed"));
    item.addEventListener("click", () => onPlay(entry.date));
    list.appendChild(item);
  }
  screen.appendChild(list);
  return screen;
}

// ---------- Name entry (leaderboard onboarding) ----------

export function buildNameEntryScreen(onSubmit: (name: string) => void): HTMLDivElement {
  const screen = el("div", "screen");

  const card = el("div", "today-card");
  card.appendChild(el("div", "puzzle-number", "One more thing"));
  card.appendChild(
    el(
      "p",
      "tutorial-line",
      "Pick a name for the leaderboard. No account, no email — just this device.",
    ),
  );

  const input = document.createElement("input");
  input.type = "text";
  input.className = "rs-readout-input tabular-nums";
  input.placeholder = "Your name";
  input.maxLength = 40;
  input.autocomplete = "off";
  input.style.width = "100%";
  input.style.textAlign = "center";

  const errorEl = el("p", "name-entry-error", "That name isn't allowed on the leaderboard — please choose another.");
  errorEl.style.display = "none";

  const submitBtn = el("button", "btn btn-primary", "Save & see my score");
  submitBtn.type = "button";
  submitBtn.disabled = true;

  // Same filter the server enforces (moderation.ts) — this just stops a
  // rejected name from ever being saved locally, since there's no later
  // "edit name" flow. The server call in main.ts is still the real check.
  input.addEventListener("input", () => {
    const name = input.value.trim();
    const blocked = name.length > 0 && containsBannedWord(name);
    errorEl.style.display = blocked ? "" : "none";
    submitBtn.disabled = name.length === 0 || blocked;
  });

  const submit = () => {
    const name = input.value.trim();
    if (name.length === 0 || containsBannedWord(name)) return;
    onSubmit(name);
  };
  submitBtn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });

  card.append(input, errorEl, submitBtn);
  screen.appendChild(card);

  queueMicrotask(() => input.focus());

  return screen;
}

// ---------- Leaderboard screen ----------

export function buildLeaderboardScreen(
  entries: LeaderboardEntry[],
  currentPlayerId: string | null,
  period: LeaderboardPeriod,
  onPeriodChange: (period: LeaderboardPeriod) => void,
  onBack: () => void,
): HTMLDivElement {
  const screen = el("div", "screen");
  screen.appendChild(buildTopBar("Leaderboard", onBack));

  const tabs = el("div", "leaderboard-tabs");
  const tabDefs: Array<[LeaderboardPeriod, string]> = [
    ["week", "This week"],
    ["all", "All time"],
  ];
  for (const [value, label] of tabDefs) {
    const tab = el("button", value === period ? "leaderboard-tab active" : "leaderboard-tab", label);
    tab.type = "button";
    tab.addEventListener("click", () => onPeriodChange(value));
    tabs.appendChild(tab);
  }
  screen.appendChild(tabs);

  if (entries.length === 0) {
    const emptyMessage =
      period === "week"
        ? "Nobody's scored this week yet — play today's five to be first."
        : "Nobody's on the board yet — play today's five to be first.";
    screen.appendChild(el("p", "archive-note", emptyMessage));
    return screen;
  }

  const list = el("ul", "leaderboard-list");
  entries.forEach((entry, i) => {
    const item = el("li", "leaderboard-item");
    if (entry.playerId === currentPlayerId) item.classList.add("leaderboard-item-you");

    const rank = el("span", "leaderboard-rank tabular-nums", String(i + 1));
    const name = el("span", "leaderboard-name", entry.name);
    const meta = el("span", "leaderboard-meta tabular-nums", `${entry.daysPlayed}d`);
    const total = el("span", "leaderboard-total tabular-nums", String(entry.total));

    item.append(rank, name, meta, total);
    list.appendChild(item);
  });

  screen.appendChild(list);
  return screen;
}

// ---------- Settings screen ----------

export function buildSettingsScreen(
  settings: SettingsState,
  onChange: (patch: Partial<SettingsState>) => void,
  onBack: () => void,
): HTMLDivElement {
  const screen = el("div", "screen");
  screen.appendChild(buildTopBar("Settings", onBack));

  const rows: Array<[keyof SettingsState, string]> = [
    ["sound", "Sound"],
    ["haptics", "Haptics"],
    ["reducedMotion", "Reduce motion"],
  ];

  for (const [key, label] of rows) {
    const row = el("div", "settings-row");
    row.appendChild(el("span", undefined, label));
    const toggle = el("button", "switch");
    toggle.type = "button";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", String(settings[key]));
    toggle.setAttribute("aria-label", label);
    toggle.addEventListener("click", () => {
      const next = !settings[key];
      toggle.setAttribute("aria-checked", String(next));
      onChange({ [key]: next } as Partial<SettingsState>);
    });
    row.appendChild(toggle);
    screen.appendChild(row);
  }

  return screen;
}
