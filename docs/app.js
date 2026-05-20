import {
  detectLanguage,
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  t,
} from "./i18n.js?v=8";
import {
  allGenreSearchTerms,
  allLanguageSearchTerms,
  gameSupportsUiLanguage,
  sanitizeSupportedLanguages,
  translateCategory,
  translateGameLanguage,
  translateGenre,
  translateReviewLabel,
} from "./labels.js?v=8";
import { plainTextToHtml, sanitizeHtml } from "./sanitize.js?v=1";
import { trapFocus } from "./focus-trap.js?v=1";

const DATA_ACTIVE_URL = "data/games-active.json";
const DATA_EXPIRED_URL = "data/games-expired.json";
const META_URL = "data/meta.json";
const SEARCH_DEBOUNCE_MS = 250;
const PAGE_SIZE = 24;
const FILTER_STORAGE_KEY = "steam-deals-filters";
const WISHLIST_STORAGE_KEY = "steam-deals-wishlist";
const PLACEHOLDER_IMG = "icons/game-placeholder.svg";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const COUNTDOWN_TICK_MS = 60_000;
const EXPIRATION_COVERAGE_MIN = 0.05;

const DEFAULT_FILTERS = {
  search: "",
  offer: "all",
  platforms: new Set(),
  genres: new Set(),
  status: "active",
  sort: "deals-priority",
  uiLanguageFilter: false,
  endingSoon: false,
  wishlistOnly: false,
  minDiscount75: false,
  maxPrice500: false,
  steamDeck: false,
  controllerSupport: false,
};

const LOCALE_MAP = {
  en: "en-US",
  "zh-Hant": "zh-HK",
  "zh-Hans": "zh-CN",
  ja: "ja-JP",
  ko: "ko-KR",
};

const state = {
  lang: detectLanguage(),
  games: [],
  meta: {},
  selectedGame: null,
  visibleCount: PAGE_SIZE,
  loadError: null,
  filters: cloneFilters(DEFAULT_FILTERS),
  expiredLoaded: false,
  releaseFocusTrap: null,
  lastFocusedElement: null,
  wishlist: loadWishlist(),
};

let searchDebounceTimer = null;
let countdownTimer = null;

const elements = {
  searchInput: document.getElementById("search-input"),
  filterOffer: document.getElementById("filter-offer"),
  filterStatus: document.getElementById("filter-status"),
  sortBy: document.getElementById("sort-by"),
  platformFilters: document.getElementById("platform-filters"),
  genreFilters: document.getElementById("genre-filters"),
  uiLanguageFilter: document.getElementById("ui-language-filter"),
  clearPlatforms: document.getElementById("clear-platforms"),
  clearGenres: document.getElementById("clear-genres"),
  clearAllFilters: document.getElementById("clear-all-filters"),
  statCards: document.querySelectorAll("[data-stat-filter]"),
  statFreeCard: document.getElementById("stat-free-card"),
  languageSelect: document.getElementById("language-select"),
  freeSpotlightSection: document.getElementById("free-spotlight-section"),
  freeSpotlightGrid: document.getElementById("free-spotlight-grid"),
  newTodaySection: document.getElementById("new-today-section"),
  newTodayGrid: document.getElementById("new-today-grid"),
  gameGrid: document.getElementById("game-grid"),
  emptyState: document.getElementById("empty-state"),
  errorState: document.getElementById("error-state"),
  retryLoad: document.getElementById("retry-load"),
  loadMore: document.getElementById("load-more"),
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
  modalCopyLink: document.getElementById("modal-copy-link"),
  modalFavorite: document.getElementById("modal-favorite"),
  modalDealBar: document.getElementById("modal-deal-bar"),
  filterEndingSoon: document.getElementById("filter-ending-soon"),
  filterWishlist: document.getElementById("filter-wishlist"),
  filterDiscount75: document.getElementById("filter-discount-75"),
  filterMaxPrice: document.getElementById("filter-max-price"),
  filterSteamDeck: document.getElementById("filter-steam-deck"),
  filterController: document.getElementById("filter-controller"),
  toast: document.getElementById("toast"),
};

function loadWishlist() {
  try {
    const raw = localStorage.getItem(WISHLIST_STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw).map(Number).filter(Number.isFinite));
  } catch {
    return new Set();
  }
}

function saveWishlist() {
  localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify([...state.wishlist]));
}

function isFavorite(appId) {
  return state.wishlist.has(Number(appId));
}

function toggleWishlist(appId) {
  const id = Number(appId);
  if (state.wishlist.has(id)) state.wishlist.delete(id);
  else state.wishlist.add(id);
  saveWishlist();
  updateDealFilterChips();
  renderGames();
  if (!elements.modal.classList.contains("hidden") && state.selectedGame) {
    updateFavoriteButton(elements.modalFavorite, state.selectedGame.app_id);
  }
}

function updateFavoriteButton(button, appId) {
  if (!button) return;
  const active = isFavorite(appId);
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", active ? "true" : "false");
  button.setAttribute(
    "aria-label",
    active ? t(state.lang, "favoriteRemove") : t(state.lang, "favoriteAdd"),
  );
}

function hasExpirationData() {
  return (state.meta.expiration_coverage ?? 0) >= EXPIRATION_COVERAGE_MIN;
}

function applyDealBar(bar, game) {
  if (!bar) return;
  const fill = bar.querySelector(".deal-bar-fill");
  const percent = game.offer_type === "free" ? 100 : game.discount_percent || 0;
  if (fill) fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  bar.classList.toggle("is-free", game.offer_type === "free");
  bar.classList.toggle("is-sale", game.offer_type === "sale");
}

function cloneFilters(source) {
  return {
    search: source.search,
    offer: source.offer,
    platforms: new Set(source.platforms),
    genres: new Set(source.genres),
    status: source.status,
    sort: source.sort,
    uiLanguageFilter: source.uiLanguageFilter,
    endingSoon: source.endingSoon,
    wishlistOnly: source.wishlistOnly,
    minDiscount75: source.minDiscount75,
    maxPrice500: source.maxPrice500,
    steamDeck: source.steamDeck,
    controllerSupport: source.controllerSupport,
  };
}

function serializeFilters() {
  return {
    search: state.filters.search,
    offer: state.filters.offer,
    platforms: [...state.filters.platforms],
    genres: [...state.filters.genres],
    status: state.filters.status,
    sort: state.filters.sort,
    uiLanguageFilter: state.filters.uiLanguageFilter,
    endingSoon: state.filters.endingSoon,
    wishlistOnly: state.filters.wishlistOnly,
    minDiscount75: state.filters.minDiscount75,
    maxPrice500: state.filters.maxPrice500,
    steamDeck: state.filters.steamDeck,
    controllerSupport: state.filters.controllerSupport,
  };
}

function buildFilterParams({ includeApp = false } = {}) {
  const params = new URLSearchParams();
  if (state.filters.search) params.set("q", state.filters.search);
  if (state.filters.offer !== "all") params.set("offer", state.filters.offer);
  if (state.filters.status !== "active") params.set("status", state.filters.status);
  if (state.filters.sort !== DEFAULT_FILTERS.sort) params.set("sort", state.filters.sort);
  if (state.filters.platforms.size) params.set("platform", [...state.filters.platforms].join(","));
  if (state.filters.genres.size) params.set("genre", [...state.filters.genres].join(","));
  if (state.filters.uiLanguageFilter) params.set("uiLang", "1");
  if (state.filters.endingSoon) params.set("ending", "1");
  if (state.filters.wishlistOnly) params.set("wishlist", "1");
  if (state.filters.minDiscount75) params.set("deal", "75");
  if (state.filters.maxPrice500) params.set("maxPrice", "500");
  if (state.filters.steamDeck) params.set("deck", "1");
  if (state.filters.controllerSupport) params.set("controller", "1");
  if (includeApp && state.selectedGame) params.set("app", String(state.selectedGame.app_id));
  return params;
}

function saveFilters() {
  localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(serializeFilters()));
  syncUrlParams({ includeApp: Boolean(state.selectedGame) });
}

function syncUrlParams({ includeApp = true } = {}) {
  const params = buildFilterParams({ includeApp });
  const query = params.toString();
  const next = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  history.replaceState(null, "", next);
}

function loadFiltersFromStorage() {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    state.filters = cloneFilters({
      ...DEFAULT_FILTERS,
      ...saved,
      platforms: new Set(saved.platforms || []),
      genres: new Set(saved.genres || []),
    });
  } catch {
    /* ignore invalid storage */
  }
}

function loadFiltersFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (!params.toString()) return;

  if (params.has("q")) state.filters.search = params.get("q") || "";
  if (params.has("offer")) state.filters.offer = params.get("offer") || "all";
  if (params.has("status")) state.filters.status = params.get("status") || "active";
  if (params.has("sort")) state.filters.sort = params.get("sort") || DEFAULT_FILTERS.sort;
  if (params.has("platform")) {
    state.filters.platforms = new Set(
      (params.get("platform") || "").split(",").filter(Boolean),
    );
  }
  if (params.has("genre")) {
    state.filters.genres = new Set((params.get("genre") || "").split(",").filter(Boolean));
  }
  if (params.get("uiLang") === "1") state.filters.uiLanguageFilter = true;
  if (params.get("ending") === "1") state.filters.endingSoon = true;
  if (params.get("wishlist") === "1") state.filters.wishlistOnly = true;
  if (params.get("deal") === "75") state.filters.minDiscount75 = true;
  if (params.get("maxPrice") === "500") state.filters.maxPrice500 = true;
  if (params.get("deck") === "1") state.filters.steamDeck = true;
  if (params.get("controller") === "1") state.filters.controllerSupport = true;
}

let pendingDeepLinkAppId = null;

function parseAppId(value) {
  if (value == null || value === "") return null;
  const id = Number.parseInt(String(value), 10);
  return Number.isFinite(id) ? id : null;
}

function getDeepLinkAppId() {
  return parseAppId(new URLSearchParams(window.location.search).get("app"));
}

function findGameByAppId(appId) {
  const target = parseAppId(appId);
  if (!target) return null;
  return state.games.find((item) => Number(item.app_id) === target) || null;
}

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

function getExpiryMs(unixSeconds) {
  if (!unixSeconds) return null;
  return Number(unixSeconds) * 1000;
}

function isEndingSoon(unixSeconds) {
  const expiryMs = getExpiryMs(unixSeconds);
  if (!expiryMs) return false;
  const diff = expiryMs - Date.now();
  return diff > 0 && diff <= ONE_DAY_MS;
}

function formatCountdown(unixSeconds) {
  const expiryMs = getExpiryMs(unixSeconds);
  if (!expiryMs) return "";
  const diff = expiryMs - Date.now();
  if (diff <= 0) return t(state.lang, "countdownExpired");

  const hours = Math.floor(diff / (60 * 60 * 1000));
  const days = Math.floor(hours / 24);
  if (days >= 1) {
    const label =
      state.lang === "zh-Hant" || state.lang === "zh-Hans"
        ? `${days} 天`
        : state.lang === "ja"
          ? `${days} 日`
          : state.lang === "ko"
            ? `${days}일`
            : `${days} day${days === 1 ? "" : "s"}`;
    return t(state.lang, "countdownEndsIn", { time: label });
  }

  const hourLabel =
    state.lang === "zh-Hant" || state.lang === "zh-Hans"
      ? `${hours} 小時`
      : state.lang === "ja"
        ? `${hours} 時間`
        : state.lang === "ko"
          ? `${hours}시간`
          : `${hours} hour${hours === 1 ? "" : "s"}`;
  return t(state.lang, "countdownEndsIn", { time: hourLabel });
}

function formatPrice(cents) {
  if (!cents && cents !== 0) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function getGamePrice(game) {
  const usdPrice = game.prices?.en;
  return {
    currency: "USD",
    original: usdPrice?.original ?? game.original_price,
    final: usdPrice?.final ?? game.final_price,
  };
}

function handleImageError(event) {
  event.target.onerror = null;
  event.target.src = PLACEHOLDER_IMG;
}

function showToast(message) {
  if (!elements.toast) return;
  elements.toast.textContent = message;
  elements.toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    elements.toast.classList.add("hidden");
  }, 2200);
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

  if (elements.uiLanguageFilter) {
    elements.uiLanguageFilter.setAttribute(
      "aria-pressed",
      state.filters.uiLanguageFilter ? "true" : "false",
    );
    elements.uiLanguageFilter.classList.toggle("active", state.filters.uiLanguageFilter);
  }

  updateStatCardStates();
  updateDealFilterChips();
  if (elements.modalClose) {
    elements.modalClose.setAttribute("aria-label", t(state.lang, "modalClose"));
  }
}

function syncFilterControls() {
  elements.searchInput.value = state.filters.search;
  elements.filterOffer.value = state.filters.offer;
  elements.filterStatus.value = state.filters.status;
  elements.sortBy.value = state.filters.sort;
  updateChipStates();
  updateStatCardStates();
  updateDealFilterChips();
}

function resetAllFilters() {
  clearTimeout(searchDebounceTimer);
  state.filters = cloneFilters(DEFAULT_FILTERS);
  state.visibleCount = PAGE_SIZE;
  syncFilterControls();
  saveFilters();
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

  const freeCount =
    state.meta.free_active ??
    state.games.filter((game) => game.is_active && game.offer_type === "free").length;
  if (elements.statFreeCard) {
    elements.statFreeCard.classList.toggle("stat-card-highlight", freeCount > 0);
  }
}

function updateDealFilterChips() {
  const endingAvailable = hasExpirationData();
  if (elements.filterEndingSoon) {
    elements.filterEndingSoon.disabled = !endingAvailable;
    elements.filterEndingSoon.title = endingAvailable
      ? ""
      : t(state.lang, "filterEndingSoonDisabled");
    elements.filterEndingSoon.classList.toggle("active", state.filters.endingSoon);
    elements.filterEndingSoon.setAttribute(
      "aria-pressed",
      state.filters.endingSoon ? "true" : "false",
    );
  }

  [
    [elements.filterWishlist, "wishlistOnly"],
    [elements.filterDiscount75, "minDiscount75"],
    [elements.filterMaxPrice, "maxPrice500"],
    [elements.filterSteamDeck, "steamDeck"],
    [elements.filterController, "controllerSupport"],
  ].forEach(([el, key]) => {
    if (!el) return;
    el.classList.toggle("active", state.filters[key]);
    el.setAttribute("aria-pressed", state.filters[key] ? "true" : "false");
  });
}

function applyStatFilter(filter) {
  state.filters.status = "active";
  if (filter === "active") state.filters.offer = "all";
  else if (filter === "free") state.filters.offer = "free";
  else if (filter === "sale") state.filters.offer = "sale";

  state.visibleCount = PAGE_SIZE;
  syncFilterControls();
  saveFilters();
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
    .sort((a, b) =>
      translateGenre(state.lang, a).localeCompare(translateGenre(state.lang, b), state.lang),
    )
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

function getExpirySortValue(game) {
  const expiryMs = getExpiryMs(game.discount_expiration);
  if (!expiryMs) return Number.MAX_SAFE_INTEGER;
  return expiryMs;
}

function compareGames(a, b) {
  switch (state.filters.sort) {
    case "deals-priority": {
      const freeDiff = Number(b.offer_type === "free") - Number(a.offer_type === "free");
      if (freeDiff) return freeDiff;
      const expiryDiff = getExpirySortValue(a) - getExpirySortValue(b);
      if (expiryDiff) return expiryDiff;
      const discountDiff = (b.discount_percent || 0) - (a.discount_percent || 0);
      if (discountDiff) return discountDiff;
      return a.name.localeCompare(b.name, state.lang);
    }
    case "ending-soon":
      return getExpirySortValue(a) - getExpirySortValue(b) || a.name.localeCompare(b.name, state.lang);
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

function getLocalizedValue(game, field) {
  const localized = game[field] || {};
  if (state.lang !== "en" && localized[state.lang]) return localized[state.lang];
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
  if (htmlField && /<[a-z][\s\S]*>/i.test(htmlField)) return sanitizeHtml(htmlField);
  return plainTextToHtml(getGameDetailedDescription(game));
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
  const {
    search,
    offer,
    platforms,
    genres,
    status,
    uiLanguageFilter,
    endingSoon,
    wishlistOnly,
    minDiscount75,
    maxPrice500,
    steamDeck,
    controllerSupport,
  } = state.filters;
  const query = search.trim().toLowerCase();

  if (status === "active" && !game.is_active) return false;
  if (offer === "free" && game.offer_type !== "free") return false;
  if (offer === "sale" && game.offer_type !== "sale") return false;

  if (platforms.size > 0) {
    const gamePlatforms = game.platforms || [];
    if (![...platforms].some((platform) => gamePlatforms.includes(platform))) return false;
  }

  if (genres.size > 0) {
    const gameGenres = game.genres || [];
    if (![...genres].some((genre) => gameGenres.includes(genre))) return false;
  }

  if (uiLanguageFilter && !gameSupportsUiLanguage(game, state.lang)) return false;
  if (endingSoon && !isEndingSoon(game.discount_expiration)) return false;
  if (wishlistOnly && !isFavorite(game.app_id)) return false;
  if (minDiscount75 && (game.discount_percent || 0) < 75 && game.offer_type !== "free") return false;

  if (maxPrice500) {
    const price = getGamePrice(game);
    const finalCents = price.final ?? game.final_price;
    if (finalCents == null || finalCents > 500) return false;
  }

  if (steamDeck && !game.steam_deck_compat) return false;
  if (controllerSupport && !game.controller_support) return false;

  return matchesSearch(game, query);
}

function isNewToday(game) {
  if (!game.first_seen) return false;
  return Date.now() - new Date(game.first_seen).getTime() <= ONE_DAY_MS;
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

function renderPriceLine(game) {
  const price = getGamePrice(game);

  if (game.offer_type === "free") {
    const parts = [t(state.lang, "freeNow")];
    if (price.original) {
      parts.unshift(
        t(state.lang, "originalPrice", { price: formatPrice(price.original) }),
      );
    }
    return parts.join(" · ");
  }

  const parts = [];
  if (price.original) {
    parts.push(t(state.lang, "originalPrice", { price: formatPrice(price.original) }));
  }
  if (price.final || price.final === 0) {
    parts.push(t(state.lang, "salePrice", { price: formatPrice(price.final) }));
  }
  return parts.join(" · ");
}

function buildCardNode(game, compact = false) {
  const node = elements.template.content.cloneNode(true);
  const card = node.querySelector(".game-card");
  const img = node.querySelector("img");
  const dealBar = node.querySelector(".deal-bar");
  const favoriteBtn = node.querySelector(".card-favorite");
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

  if (compact) card.classList.add("compact");
  if (!game.is_active) card.classList.add("inactive");
  if (isEndingSoon(game.discount_expiration)) card.classList.add("ending-soon");

  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", getGameName(game));

  applyDealBar(dealBar, game);
  updateFavoriteButton(favoriteBtn, game.app_id);
  if (favoriteBtn) {
    favoriteBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleWishlist(game.app_id);
    });
  }

  img.src =
    game.header_image ||
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.app_id}/header.jpg`;
  img.alt = getGameName(game);
  img.addEventListener("error", handleImageError);

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

  if (compact) {
    description.classList.add("hidden");
    tagRow.classList.add("hidden");
    languageLabel.classList.add("hidden");
    languageRow.classList.add("hidden");
    platformRow.classList.add("hidden");
    addedAt.classList.add("hidden");
  } else {
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
  }

  const countdown = formatCountdown(game.discount_expiration);
  expiresAt.textContent = countdown;
  expiresAt.classList.toggle("hidden", !countdown);
  if (game.discount_expiration) expiresAt.dataset.expiry = String(game.discount_expiration);
  if (isEndingSoon(game.discount_expiration)) expiresAt.classList.add("ending-soon");

  link.href = game.steam_url;
  link.textContent = t(state.lang, "openSteam");
  viewDetails.textContent = t(state.lang, "viewDetails");

  card.addEventListener("click", (event) => {
    if (event.target.closest("a, .favorite-button, .card-favorite")) return;
    openGameModal(game);
  });

  card.addEventListener("keydown", (event) => {
    if (event.target.closest("a, .favorite-button, .card-favorite")) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openGameModal(game);
    }
  });

  return node;
}

function renderFreeSpotlight() {
  if (!elements.freeSpotlightSection || !elements.freeSpotlightGrid) return;

  const freeGames = state.games
    .filter((game) => game.is_active && game.offer_type === "free")
    .sort(compareGames);

  elements.freeSpotlightSection.classList.toggle("hidden", freeGames.length === 0);
  elements.freeSpotlightGrid.innerHTML = "";
  freeGames.slice(0, 8).forEach((game) => {
    elements.freeSpotlightGrid.appendChild(buildCardNode(game, true));
  });
}

function renderNewTodaySection() {
  const newGames = state.games
    .filter((game) => game.is_active && isNewToday(game))
    .sort((a, b) => {
      const freeDiff = Number(b.offer_type === "free") - Number(a.offer_type === "free");
      if (freeDiff) return freeDiff;
      return new Date(b.first_seen || 0) - new Date(a.first_seen || 0);
    });

  elements.newTodayGrid.innerHTML = "";
  elements.newTodaySection.classList.toggle("hidden", newGames.length === 0);

  newGames.slice(0, 12).forEach((game) => {
    elements.newTodayGrid.appendChild(buildCardNode(game, true));
  });
}

function renderLoadingSkeleton() {
  elements.gameGrid.innerHTML = "";
  for (let i = 0; i < 6; i += 1) {
    const skeleton = document.createElement("article");
    skeleton.className = "game-card skeleton-card";
    skeleton.innerHTML =
      '<div class="skeleton-media"></div><div class="skeleton-body"><div class="skeleton-line wide"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>';
    elements.gameGrid.appendChild(skeleton);
  }
  elements.resultsCount.textContent = t(state.lang, "loading");
  elements.emptyState.classList.add("hidden");
  elements.errorState.classList.add("hidden");
  elements.loadMore.classList.add("hidden");
}

function renderGames() {
  if (state.loadError) return;

  const filtered = state.games.filter(matchesFilters).sort(compareGames);
  const visible = filtered.slice(0, state.visibleCount);

  elements.gameGrid.innerHTML = "";
  visible.forEach((game) => {
    elements.gameGrid.appendChild(buildCardNode(game));
  });

  elements.resultsCount.textContent = t(state.lang, "resultsCountFiltered", {
    shown: visible.length,
    filtered: filtered.length,
    total: state.games.length,
  });

  elements.emptyState.classList.toggle("hidden", filtered.length > 0);
  elements.loadMore.classList.toggle("hidden", visible.length >= filtered.length);
  elements.loadMore.textContent = t(state.lang, "loadMore");

  renderFreeSpotlight();
  renderNewTodaySection();
  updateStatCardStates();
  updateDealFilterChips();
}

function updateCountdownLabels() {
  document.querySelectorAll(".expires-at[data-expiry]").forEach((node) => {
    const expiry = Number(node.dataset.expiry);
    node.textContent = formatCountdown(expiry);
    node.classList.toggle("hidden", !node.textContent);
    node.classList.toggle("ending-soon", isEndingSoon(expiry));
  });

  if (state.selectedGame && !elements.modal.classList.contains("hidden")) {
    const countdown = formatCountdown(state.selectedGame.discount_expiration);
    elements.modalExpires.textContent = countdown;
    elements.modalExpires.classList.toggle("hidden", !countdown);
    elements.modalExpires.classList.toggle(
      "ending-soon",
      isEndingSoon(state.selectedGame.discount_expiration),
    );
  }
}

function startCountdownTimer() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    updateCountdownLabels();
  }, COUNTDOWN_TICK_MS);
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

function getShareUrl(game) {
  const url = new URL(window.location.origin + window.location.pathname);
  const params = buildFilterParams({ includeApp: true });
  params.set("app", String(game.app_id));
  if (!game.is_active) params.set("status", "all");
  url.search = params.toString();
  return url.toString();
}

async function resolveDeepLink() {
  const appId = pendingDeepLinkAppId ?? getDeepLinkAppId();
  pendingDeepLinkAppId = null;
  if (!appId) return;

  let game = findGameByAppId(appId);
  if (!game && state.filters.status === "active") {
    await loadExpiredGames();
    game = findGameByAppId(appId);
  }
  if (!game) {
    showToast(t(state.lang, "deepLinkNotFound"));
    return;
  }

  let needsRerender = false;
  if (!game.is_active && state.filters.status === "active") {
    state.filters.status = "all";
    syncFilterControls();
    needsRerender = true;
  }

  if (needsRerender) renderGames();
  openGameModal(game);
}

function openGameModal(game) {
  state.lastFocusedElement = document.activeElement;
  state.selectedGame = game;
  elements.modalImage.onerror = handleImageError;
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

  applyDealBar(elements.modalDealBar, game);
  elements.modalDealBar?.classList.remove("hidden");
  updateFavoriteButton(elements.modalFavorite, game.app_id);

  const descriptionHtml = getGameDetailedDescriptionHtml(game);
  if (descriptionHtml) elements.modalDescription.innerHTML = descriptionHtml;
  else elements.modalDescription.textContent = t(state.lang, "noDescription");

  fillChipGroup(elements.modalGenres, game.genres || [], (genre) =>
    translateGenre(state.lang, genre),
  );
  fillChipGroup(elements.modalCategories, game.categories || [], (category) =>
    translateCategory(state.lang, category),
  );
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

  const countdown = formatCountdown(game.discount_expiration);
  elements.modalExpires.textContent = countdown;
  elements.modalExpires.classList.toggle("hidden", !countdown);
  elements.modalExpires.classList.toggle("ending-soon", isEndingSoon(game.discount_expiration));

  elements.modalSteamLink.href = game.steam_url;
  elements.modalSteamLink.textContent = t(state.lang, "openSteam");
  elements.modalCopyLink.textContent = t(state.lang, "copyLink");

  elements.modal.classList.remove("hidden");
  elements.modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  syncUrlParams({ includeApp: true });

  const dialog = elements.modal.querySelector(".modal-dialog") || elements.modal;
  state.releaseFocusTrap?.();
  state.releaseFocusTrap = trapFocus(dialog, () => closeGameModal());
}

function closeGameModal() {
  state.releaseFocusTrap?.();
  state.releaseFocusTrap = null;
  state.selectedGame = null;

  elements.modal.classList.add("hidden");
  elements.modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");

  if (state.lastFocusedElement && typeof state.lastFocusedElement.focus === "function") {
    state.lastFocusedElement.focus();
  }
  state.lastFocusedElement = null;

  syncUrlParams({ includeApp: false });
}

function bindEvents() {
  elements.searchInput.addEventListener("input", (event) => {
    state.filters.search = event.target.value;
    state.visibleCount = PAGE_SIZE;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      saveFilters();
      renderGames();
    }, SEARCH_DEBOUNCE_MS);
  });

  const filterChange = () => {
    state.visibleCount = PAGE_SIZE;
    saveFilters();
    renderGames();
  };

  elements.filterOffer.addEventListener("change", (event) => {
    state.filters.offer = event.target.value;
    filterChange();
  });

  elements.filterStatus.addEventListener("change", async (event) => {
    state.filters.status = event.target.value;
    if (state.filters.status === "all") await loadExpiredGames();
    filterChange();
  });

  elements.sortBy.addEventListener("change", (event) => {
    state.filters.sort = event.target.value;
    filterChange();
  });

  elements.statCards.forEach((button) => {
    button.addEventListener("click", () => applyStatFilter(button.dataset.statFilter));
  });

  elements.clearAllFilters.addEventListener("click", resetAllFilters);

  elements.uiLanguageFilter?.addEventListener("click", () => {
    state.filters.uiLanguageFilter = !state.filters.uiLanguageFilter;
    translatePage();
    filterChange();
  });

  elements.loadMore.addEventListener("click", () => {
    state.visibleCount += PAGE_SIZE;
    renderGames();
  });

  elements.retryLoad?.addEventListener("click", () => loadData());

  elements.platformFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-platform]");
    if (!button) return;
    const platform = button.dataset.platform;
    if (state.filters.platforms.has(platform)) state.filters.platforms.delete(platform);
    else state.filters.platforms.add(platform);
    updateChipStates();
    filterChange();
  });

  elements.genreFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-genre]");
    if (!button) return;
    const genre = button.dataset.genre;
    if (state.filters.genres.has(genre)) state.filters.genres.delete(genre);
    else state.filters.genres.add(genre);
    updateChipStates();
    filterChange();
  });

  elements.clearPlatforms.addEventListener("click", () => {
    state.filters.platforms.clear();
    updateChipStates();
    filterChange();
  });

  elements.clearGenres.addEventListener("click", () => {
    state.filters.genres.clear();
    updateChipStates();
    filterChange();
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

  elements.modalCopyLink?.addEventListener("click", async () => {
    if (!state.selectedGame) return;
    const shareUrl = getShareUrl(state.selectedGame);
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast(t(state.lang, "copyLinkSuccess"));
    } catch {
      showToast(shareUrl);
    }
  });

  elements.modalFavorite?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (state.selectedGame) toggleWishlist(state.selectedGame.app_id);
  });

  const toggleDealFilter = (key) => {
    state.filters[key] = !state.filters[key];
    if (key === "endingSoon" && !hasExpirationData()) return;
    filterChange();
  };

  elements.filterEndingSoon?.addEventListener("click", () => {
    if (!hasExpirationData()) return;
    toggleDealFilter("endingSoon");
  });
  elements.filterWishlist?.addEventListener("click", () => toggleDealFilter("wishlistOnly"));
  elements.filterDiscount75?.addEventListener("click", () => toggleDealFilter("minDiscount75"));
  elements.filterMaxPrice?.addEventListener("click", () => toggleDealFilter("maxPrice500"));
  elements.filterSteamDeck?.addEventListener("click", () => toggleDealFilter("steamDeck"));
  elements.filterController?.addEventListener("click", () => toggleDealFilter("controllerSupport"));

  elements.modalClose.addEventListener("click", closeGameModal);
  elements.modalBackdrop.addEventListener("click", closeGameModal);

  window.addEventListener("popstate", async () => {
    loadFiltersFromUrl();
    syncFilterControls();

    if (state.filters.status === "all") {
      await loadExpiredGames();
    }

    pendingDeepLinkAppId = getDeepLinkAppId();
    renderGames();

    if (pendingDeepLinkAppId) {
      await resolveDeepLink();
    } else if (state.selectedGame) {
      closeGameModal();
    }
  });
}

function detectRepoLink() {
  elements.repoLink.href = "https://github.com/HenryLok0/steam-deals-tracker";
}

function showLoadError(message) {
  state.loadError = message;
  elements.errorState.classList.remove("hidden");
  elements.errorState.querySelector("p").textContent = t(state.lang, "loadError");
  elements.emptyState.classList.add("hidden");
  elements.gameGrid.innerHTML = "";
  elements.loadMore.classList.add("hidden");
  elements.resultsCount.textContent = t(state.lang, "loadError");
}

async function loadExpiredGames() {
  if (state.expiredLoaded) return;
  try {
    const res = await fetch(DATA_EXPIRED_URL);
    if (!res.ok) return;
    const payload = await res.json();
    const expired = payload.games || [];
    const existingIds = new Set(state.games.map((g) => Number(g.app_id)));
    expired.forEach((game) => {
      if (!existingIds.has(Number(game.app_id))) state.games.push(game);
    });
    state.expiredLoaded = true;
  } catch (error) {
    console.warn("Failed to load expired games", error);
  }
}

async function loadData() {
  state.loadError = null;
  state.expiredLoaded = false;
  elements.errorState.classList.add("hidden");
  renderLoadingSkeleton();

  try {
    const [gamesPayload, metaPayload] = await Promise.all([
      fetch(DATA_ACTIVE_URL).then((res) => {
        if (!res.ok) throw new Error(`Failed to load games-active.json (${res.status})`);
        return res.json();
      }),
      fetch(META_URL).then((res) => {
        if (!res.ok) throw new Error(`Failed to load meta.json (${res.status})`);
        return res.json();
      }),
    ]);

    state.games = gamesPayload.games || [];
    state.meta = metaPayload || {};

    if (state.filters.status === "all") {
      await loadExpiredGames();
    }

    buildLanguageOptions();
    translatePage();
    buildGenreFilters(state.games);
    syncFilterControls();
    renderStats();
    renderGames();
    startCountdownTimer();
    await resolveDeepLink();
  } catch (error) {
    console.error(error);
    showLoadError(error.message);
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js?v=4").then((registration) => {
      registration.update();
    }).catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  }
}

pendingDeepLinkAppId = getDeepLinkAppId();
loadFiltersFromStorage();
if (window.location.search) loadFiltersFromUrl();

bindEvents();
detectRepoLink();
loadData();
registerServiceWorker();
