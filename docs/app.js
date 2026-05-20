import {
  detectLanguage,
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  t,
} from "./i18n.js?v=6";
import {
  allGenreSearchTerms,
  allLanguageSearchTerms,
  sanitizeSupportedLanguages,
  translateGameLanguage,
  translateGenre,
  translateReviewLabel,
} from "./labels.js?v=6";
import { plainTextToHtml, sanitizeHtml } from "./sanitize.js?v=1";

const DATA_URL = "data/games.json";
const META_URL = "data/meta.json";
const SEARCH_DEBOUNCE_MS = 250;

const DEFAULT_FILTERS = {
  search: "",
  offer: "all",
  platforms: new Set(),
  genres: new Set(),
  status: "active",
  sort: "newest",
};

const LOCALE_MAP = {
  en: "en-US",
  "zh-Hant": "zh-HK",
  ja: "ja-JP",
  ko: "ko-KR",
};

const state = {
  lang: detectLanguage(),
  games: [],
  meta: {},
  selectedGame: null,
  filters: {
    search: "",
    offer: "all",
    platforms: new Set(),
    genres: new Set(),
    status: "active",
    sort: "newest",
  },
};

let searchDebounceTimer = null;

const elements = {
  searchInput: document.getElementById("search-input"),
  filterOffer: document.getElementById("filter-offer"),
  filterStatus: document.getElementById("filter-status"),
  sortBy: document.getElementById("sort-by"),
  platformFilters: document.getElementById("platform-filters"),
  genreFilters: document.getElementById("genre-filters"),
  clearPlatforms: document.getElementById("clear-platforms"),
  clearGenres: document.getElementById("clear-genres"),
  clearAllFilters: document.getElementById("clear-all-filters"),
  statCards: document.querySelectorAll("[data-stat-filter]"),
  languageSelect: document.getElementById("language-select"),
  gameGrid: document.getElementById("game-grid"),
  emptyState: document.getElementById("empty-state"),
  resultsCount: document.getElementById("results-count"),
  statActive: document.getElementById("stat-active"),
  statFree: document.getElementById("stat-free"),
  statSale: document.getElementById("stat-sale"),
  statUpdated: document.getElementById("stat-updated"),
  repoLink: document.getElementById("repo-link"),
  template: document.getElementById("game-card-template"),
  modal: document.getElementById("game-modal"),
  modalBackdrop: document.getElementById("modal-backdrop"),
  modalClose: document.getElementById("modal-close"),
  modalImage: document.getElementById("modal-image"),
  modalBadge: document.getElementById("modal-badge"),
  modalTitle: document.getElementById("modal-title"),
  modalReview: document.getElementById("modal-review"),
  modalPrice: document.getElementById("modal-price"),
  modalDescription: document.getElementById("modal-description"),
  modalGenres: document.getElementById("modal-genres"),
  modalCategories: document.getElementById("modal-categories"),
  modalLanguages: document.getElementById("modal-languages"),
  modalPlatforms: document.getElementById("modal-platforms"),
  modalRelease: document.getElementById("modal-release"),
  modalAdded: document.getElementById("modal-added"),
  modalExpires: document.getElementById("modal-expires"),
  modalSteamLink: document.getElementById("modal-steam-link"),
};

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(LOCALE_MAP[state.lang] || "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatExpiry(unixSeconds) {
  if (!unixSeconds) return "";
  return formatDate(Number(unixSeconds) * 1000);
}

function formatPrice(cents, currency = "USD") {
  if (!cents && cents !== 0) return "";
  return new Intl.NumberFormat(LOCALE_MAP[state.lang] || "en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function getGamePrice(game) {
  const regional = game.prices?.[state.lang];
  if (regional?.currency) {
    return regional;
  }
  return {
    currency: "USD",
    original: game.original_price,
    final: game.final_price,
  };
}

function translatePage() {
  document.documentElement.lang = state.lang;
  document.title = t(state.lang, "pageTitle");

  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(state.lang, node.dataset.i18n);
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    node.placeholder = t(state.lang, node.dataset.i18nPlaceholder);
  });

  [elements.filterOffer, elements.filterStatus, elements.sortBy].forEach((select) => {
    select.querySelectorAll("option").forEach((option) => {
      option.textContent = t(state.lang, option.dataset.i18n);
    });
  });

  elements.platformFilters.querySelectorAll("[data-i18n]").forEach((button) => {
    button.textContent = t(state.lang, button.dataset.i18n);
  });

  updateStatCardStates();
}

function syncFilterControls() {
  elements.searchInput.value = state.filters.search;
  elements.filterOffer.value = state.filters.offer;
  elements.filterStatus.value = state.filters.status;
  elements.sortBy.value = state.filters.sort;
  updateChipStates();
  updateStatCardStates();
}

function resetAllFilters() {
  clearTimeout(searchDebounceTimer);
  state.filters = {
    search: DEFAULT_FILTERS.search,
    offer: DEFAULT_FILTERS.offer,
    platforms: new Set(DEFAULT_FILTERS.platforms),
    genres: new Set(DEFAULT_FILTERS.genres),
    status: DEFAULT_FILTERS.status,
    sort: DEFAULT_FILTERS.sort,
  };
  syncFilterControls();
  renderGames();
}

function updateStatCardStates() {
  elements.statCards.forEach((button) => {
    const filter = button.dataset.statFilter;
    let active = false;

    if (filter === "active") {
      active = state.filters.offer === "all" && state.filters.status === "active";
    } else if (filter === "free") {
      active = state.filters.offer === "free" && state.filters.status === "active";
    } else if (filter === "sale") {
      active = state.filters.offer === "sale" && state.filters.status === "active";
    }

    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function applyStatFilter(filter) {
  state.filters.status = "active";

  if (filter === "active") {
    state.filters.offer = "all";
  } else if (filter === "free") {
    state.filters.offer = "free";
  } else if (filter === "sale") {
    state.filters.offer = "sale";
  }

  syncFilterControls();
  renderGames();
  elements.gameGrid.scrollIntoView({ behavior: "smooth", block: "start" });
}

function buildLanguageOptions() {
  elements.languageSelect.innerHTML = "";
  SUPPORTED_LANGUAGES.forEach((lang) => {
    const option = document.createElement("option");
    option.value = lang;
    option.textContent = LANGUAGE_LABELS[lang];
    option.selected = lang === state.lang;
    elements.languageSelect.appendChild(option);
  });
}

function buildGenreFilters(games) {
  const genres = new Set();
  games.forEach((game) => {
    (game.genres || []).forEach((genre) => genres.add(genre));
  });

  elements.genreFilters.innerHTML = "";
  [...genres]
    .sort((a, b) => translateGenre(state.lang, a).localeCompare(translateGenre(state.lang, b), state.lang))
    .forEach((genre) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.dataset.genre = genre;
      button.textContent = translateGenre(state.lang, genre);
      button.setAttribute("aria-pressed", state.filters.genres.has(genre) ? "true" : "false");
      button.classList.toggle("active", state.filters.genres.has(genre));
      elements.genreFilters.appendChild(button);
    });
}

function getRatingValue(game) {
  if (typeof game.review_percent === "number") return game.review_percent;
  if (typeof game.review_score === "number") return game.review_score * 10;
  return -1;
}

function compareGames(a, b) {
  switch (state.filters.sort) {
    case "name-desc":
      return b.name.localeCompare(a.name, state.lang);
    case "newest":
      return new Date(b.first_seen || 0) - new Date(a.first_seen || 0);
    case "oldest":
      return new Date(a.first_seen || 0) - new Date(b.first_seen || 0);
    case "rating-desc":
      return getRatingValue(b) - getRatingValue(a) || b.name.localeCompare(a.name, state.lang);
    case "rating-asc":
      return getRatingValue(a) - getRatingValue(b) || a.name.localeCompare(b.name, state.lang);
    case "reviews-desc":
      return (b.review_count || 0) - (a.review_count || 0) || getRatingValue(b) - getRatingValue(a);
    case "reviews-asc":
      return (a.review_count || 0) - (b.review_count || 0) || getRatingValue(a) - getRatingValue(b);
    case "discount-desc":
      return (b.discount_percent || 0) - (a.discount_percent || 0) || getRatingValue(b) - getRatingValue(a);
    case "discount-asc":
      return (a.discount_percent || 0) - (b.discount_percent || 0) || getRatingValue(a) - getRatingValue(b);
    case "name-asc":
    default:
      return a.name.localeCompare(b.name, state.lang);
  }
}

function matchesSearch(game, query) {
  if (!query) return true;

  const terms = [
    getGameName(game),
    game.name,
    getGameDescription(game),
    ...(game.names ? Object.values(game.names) : []),
    ...(game.descriptions ? Object.values(game.descriptions) : []),
    ...(game.detailed_descriptions ? Object.values(game.detailed_descriptions) : []),
    ...(game.genres || []).flatMap((genre) => allGenreSearchTerms(genre)),
    ...(sanitizeSupportedLanguages(game.supported_languages)).flatMap((language) =>
      allLanguageSearchTerms(language),
    ),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((token) => terms.includes(token));
}

function matchesFilters(game) {
  const { search, offer, platforms, genres, status } = state.filters;
  const query = search.trim().toLowerCase();

  if (status === "active" && !game.is_active) return false;
  if (offer === "free" && game.offer_type !== "free") return false;
  if (offer === "sale" && game.offer_type !== "sale") return false;

  if (platforms.size > 0) {
    const gamePlatforms = game.platforms || [];
    const hasPlatform = [...platforms].some((platform) => gamePlatforms.includes(platform));
    if (!hasPlatform) return false;
  }

  if (genres.size > 0) {
    const gameGenres = game.genres || [];
    const hasGenre = [...genres].some((genre) => gameGenres.includes(genre));
    if (!hasGenre) return false;
  }

  return matchesSearch(game, query);
}

function renderStats() {
  elements.statActive.textContent =
    state.meta.active_count ?? state.games.filter((game) => game.is_active).length;
  elements.statFree.textContent = state.meta.free_active ?? "-";
  elements.statSale.textContent = state.meta.sale_active ?? "-";
  elements.statUpdated.textContent = formatDate(state.meta.updated_at);
}

function renderReviewLine(game) {
  if (typeof game.review_percent === "number" && game.review_label) {
    return t(state.lang, "reviewSummary", {
      label: translateReviewLabel(state.lang, game.review_label),
      percent: game.review_percent,
    });
  }
  if (game.review_count) {
    return t(state.lang, "reviewCount", {
      count: game.review_count.toLocaleString(LOCALE_MAP[state.lang] || "en-US"),
    });
  }
  return "";
}

function getLocalizedValue(game, field) {
  const localized = game[field] || {};
  if (state.lang !== "en" && localized[state.lang]) {
    return localized[state.lang];
  }
  return localized.en || "";
}

function getGameName(game) {
  return getLocalizedValue(game, "names") || game.name || "";
}

function getGameDescription(game) {
  return getLocalizedValue(game, "descriptions") || game.short_description || "";
}

function getGameDetailedDescription(game) {
  return getLocalizedValue(game, "detailed_descriptions") || getGameDescription(game);
}

function getGameDetailedDescriptionHtml(game) {
  const htmlField = getLocalizedValue(game, "detailed_descriptions_html");
  if (htmlField && /<[a-z][\s\S]*>/i.test(htmlField)) {
    return sanitizeHtml(htmlField);
  }
  return plainTextToHtml(getGameDetailedDescription(game));
}

function renderPriceLine(game) {
  const price = getGamePrice(game);
  const currency = price.currency || "USD";

  if (game.offer_type === "free") {
    const parts = [t(state.lang, "freeNow")];
    if (price.original) {
      parts.unshift(
        t(state.lang, "originalPrice", { price: formatPrice(price.original, currency) }),
      );
    }
    return parts.join(" · ");
  }

  const parts = [];
  if (price.original) {
    parts.push(t(state.lang, "originalPrice", { price: formatPrice(price.original, currency) }));
  }
  if (price.final || price.final === 0) {
    parts.push(t(state.lang, "salePrice", { price: formatPrice(price.final, currency) }));
  }
  return parts.join(" · ");
}

function renderGames() {
  const filtered = state.games.filter(matchesFilters).sort(compareGames);
  elements.gameGrid.innerHTML = "";

  filtered.forEach((game) => {
    const node = elements.template.content.cloneNode(true);
    const card = node.querySelector(".game-card");
    const img = node.querySelector("img");
    const badge = node.querySelector(".badge");
    const title = node.querySelector("h2");
    const status = node.querySelector(".status-pill");
    const reviewLine = node.querySelector(".review-line");
    const priceLine = node.querySelector(".price-line");
    const description = node.querySelector(".description");
    const tagRow = node.querySelector(".tag-row");
    const languageRow = node.querySelector(".language-row");
    const languageLabel = node.querySelector(".language-label");
    const platformRow = node.querySelector(".platform-row");
    const addedAt = node.querySelector(".added-at");
    const expiresAt = node.querySelector(".expires-at");
    const viewDetails = node.querySelector(".view-details");
    const link = node.querySelector(".card-actions a");

    if (!game.is_active) card.classList.add("inactive");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", getGameName(game));

    img.src =
      game.header_image ||
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.app_id}/header.jpg`;
    img.alt = getGameName(game);

    if (game.offer_type === "sale") {
      badge.textContent = t(state.lang, "badgeSale", { percent: game.discount_percent || 0 });
      badge.classList.add("sale");
    } else {
      badge.textContent = t(state.lang, "badgePromotional");
      badge.classList.add("free");
    }

    title.textContent = getGameName(game);
    status.textContent = game.is_active
      ? t(state.lang, "statusActivePill")
      : t(state.lang, "statusExpiredPill");
    status.classList.toggle("inactive", !game.is_active);

    const reviewText = renderReviewLine(game);
    reviewLine.textContent = reviewText;
    reviewLine.classList.toggle("hidden", !reviewText);

    const priceText = renderPriceLine(game);
    priceLine.textContent = priceText;
    priceLine.classList.toggle("hidden", !priceText);

    description.textContent = getGameDescription(game) || t(state.lang, "noDescription");

    (game.genres || []).slice(0, 5).forEach((genre) => {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = translateGenre(state.lang, genre);
      tagRow.appendChild(tag);
    });

    const supportedLanguages = sanitizeSupportedLanguages(game.supported_languages);
    if (supportedLanguages.length) {
      languageLabel.textContent = t(state.lang, "supportedLanguagesLabel");
      supportedLanguages.slice(0, 6).forEach((languageKey) => {
        const label = translateGameLanguage(state.lang, languageKey);
        if (!label) return;
        const language = document.createElement("span");
        language.className = "language-tag";
        language.textContent = label;
        languageRow.appendChild(language);
      });
      if (supportedLanguages.length > 6) {
        const more = document.createElement("span");
        more.className = "language-tag";
        more.textContent = `+${supportedLanguages.length - 6}`;
        languageRow.appendChild(more);
      }
    } else {
      languageLabel.classList.add("hidden");
      languageRow.classList.add("hidden");
    }

    const platformLabels = {
      windows: t(state.lang, "platformWindows"),
      mac: t(state.lang, "platformMac"),
      linux: t(state.lang, "platformLinux"),
    };

    (game.platforms || []).forEach((platformName) => {
      const platform = document.createElement("span");
      platform.className = "platform";
      platform.textContent = platformLabels[platformName] || platformName;
      platformRow.appendChild(platform);
    });

    addedAt.textContent = t(state.lang, "addedAt", { date: formatDate(game.first_seen) });

    const expiry = formatExpiry(game.discount_expiration);
    expiresAt.textContent = expiry ? t(state.lang, "expiresAt", { date: expiry }) : "";
    expiresAt.classList.toggle("hidden", !expiry);

    link.href = game.steam_url;
    link.textContent = t(state.lang, "openSteam");
    viewDetails.textContent = t(state.lang, "viewDetails");

    card.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      openGameModal(game);
    });

    card.addEventListener("keydown", (event) => {
      if (event.target.closest("a")) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openGameModal(game);
      }
    });

    elements.gameGrid.appendChild(node);
  });

  elements.resultsCount.textContent = t(state.lang, "resultsCount", {
    shown: filtered.length,
    total: state.games.length,
  });
  elements.emptyState.classList.toggle("hidden", filtered.length > 0);
  updateStatCardStates();
}

function updateChipStates() {
  elements.platformFilters.querySelectorAll("[data-platform]").forEach((button) => {
    const active = state.filters.platforms.has(button.dataset.platform);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });

  elements.genreFilters.querySelectorAll("[data-genre]").forEach((button) => {
    const active = state.filters.genres.has(button.dataset.genre);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.textContent = translateGenre(state.lang, button.dataset.genre);
  });
}

function fillChipGroup(container, items, translateFn = (value) => value) {
  container.innerHTML = "";
  items.forEach((item) => {
    const text = translateFn(item);
    if (!text) return;
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = text;
    container.appendChild(chip);
  });
}

function openGameModal(game) {
  state.selectedGame = game;
  elements.modalImage.src =
    game.header_image ||
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.app_id}/header.jpg`;
  elements.modalImage.alt = getGameName(game);
  elements.modalTitle.textContent = getGameName(game);

  if (game.offer_type === "sale") {
    elements.modalBadge.textContent = t(state.lang, "badgeSale", {
      percent: game.discount_percent || 0,
    });
    elements.modalBadge.className = "badge sale";
  } else {
    elements.modalBadge.textContent = t(state.lang, "badgePromotional");
    elements.modalBadge.className = "badge free";
  }

  const reviewText = renderReviewLine(game);
  elements.modalReview.textContent = reviewText;
  elements.modalReview.classList.toggle("hidden", !reviewText);

  const priceText = renderPriceLine(game);
  elements.modalPrice.textContent = priceText;
  elements.modalPrice.classList.toggle("hidden", !priceText);

  const descriptionHtml = getGameDetailedDescriptionHtml(game);
  if (descriptionHtml) {
    elements.modalDescription.innerHTML = descriptionHtml;
  } else {
    elements.modalDescription.textContent = t(state.lang, "noDescription");
  }

  fillChipGroup(elements.modalGenres, game.genres || [], (genre) =>
    translateGenre(state.lang, genre),
  );
  fillChipGroup(elements.modalCategories, game.categories || []);

  fillChipGroup(
    elements.modalLanguages,
    sanitizeSupportedLanguages(game.supported_languages),
    (languageKey) => translateGameLanguage(state.lang, languageKey),
  );

  const platformLabels = {
    windows: t(state.lang, "platformWindows"),
    mac: t(state.lang, "platformMac"),
    linux: t(state.lang, "platformLinux"),
  };
  elements.modalPlatforms.textContent = (game.platforms || [])
    .map((platform) => platformLabels[platform] || platform)
    .join(" · ");

  elements.modalRelease.textContent = game.release_date
    ? `${t(state.lang, "modalReleaseDate")}: ${game.release_date}`
    : "";
  elements.modalAdded.textContent = t(state.lang, "addedAt", {
    date: formatDate(game.first_seen),
  });

  const expiry = formatExpiry(game.discount_expiration);
  elements.modalExpires.textContent = expiry
    ? t(state.lang, "expiresAt", { date: expiry })
    : "";
  elements.modalExpires.classList.toggle("hidden", !expiry);

  elements.modalSteamLink.href = game.steam_url;
  elements.modalSteamLink.textContent = t(state.lang, "openSteam");

  elements.modal.classList.remove("hidden");
  elements.modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeGameModal() {
  state.selectedGame = null;
  elements.modal.classList.add("hidden");
  elements.modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function bindEvents() {
  elements.searchInput.addEventListener("input", (event) => {
    state.filters.search = event.target.value;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      renderGames();
    }, SEARCH_DEBOUNCE_MS);
  });

  elements.filterOffer.addEventListener("change", (event) => {
    state.filters.offer = event.target.value;
    renderGames();
  });

  elements.filterStatus.addEventListener("change", (event) => {
    state.filters.status = event.target.value;
    renderGames();
  });

  elements.sortBy.addEventListener("change", (event) => {
    state.filters.sort = event.target.value;
    renderGames();
  });

  elements.statCards.forEach((button) => {
    button.addEventListener("click", () => {
      applyStatFilter(button.dataset.statFilter);
    });
  });

  elements.clearAllFilters.addEventListener("click", resetAllFilters);

  elements.platformFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-platform]");
    if (!button) return;
    const platform = button.dataset.platform;
    if (state.filters.platforms.has(platform)) {
      state.filters.platforms.delete(platform);
    } else {
      state.filters.platforms.add(platform);
    }
    updateChipStates();
    renderGames();
  });

  elements.genreFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-genre]");
    if (!button) return;
    const genre = button.dataset.genre;
    if (state.filters.genres.has(genre)) {
      state.filters.genres.delete(genre);
    } else {
      state.filters.genres.add(genre);
    }
    updateChipStates();
    renderGames();
  });

  elements.clearPlatforms.addEventListener("click", () => {
    state.filters.platforms.clear();
    updateChipStates();
    renderGames();
  });

  elements.clearGenres.addEventListener("click", () => {
    state.filters.genres.clear();
    updateChipStates();
    renderGames();
  });

  elements.languageSelect.addEventListener("change", (event) => {
    state.lang = event.target.value;
    localStorage.setItem("steam-free-games-lang", state.lang);
    translatePage();
    buildGenreFilters(state.games);
    updateChipStates();
    renderStats();
    renderGames();
    if (!elements.modal.classList.contains("hidden") && state.selectedGame) {
      openGameModal(state.selectedGame);
    }
  });

  elements.modalClose.addEventListener("click", closeGameModal);
  elements.modalBackdrop.addEventListener("click", closeGameModal);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeGameModal();
  });
}

function detectRepoLink() {
  const { origin, pathname } = window.location;
  if (origin.includes("github.io")) {
    const repoName = pathname.split("/").filter(Boolean)[0];
    if (repoName) {
      elements.repoLink.href = `https://github.com/${repoName}/${repoName}`;
      return;
    }
  }
  elements.repoLink.href = "https://github.com/";
}

async function loadData() {
  try {
    const [gamesPayload, metaPayload] = await Promise.all([
      fetch(DATA_URL).then((res) => {
        if (!res.ok) throw new Error(`Failed to load games.json (${res.status})`);
        return res.json();
      }),
      fetch(META_URL).then((res) => {
        if (!res.ok) throw new Error(`Failed to load meta.json (${res.status})`);
        return res.json();
      }),
    ]);

    state.games = gamesPayload.games || [];
    state.meta = metaPayload || {};
    buildLanguageOptions();
    translatePage();
    buildGenreFilters(state.games);
    updateChipStates();
    renderStats();
    renderGames();
  } catch (error) {
    console.error(error);
    elements.resultsCount.textContent = t(state.lang, "loadError");
  }
}

bindEvents();
detectRepoLink();
loadData();
