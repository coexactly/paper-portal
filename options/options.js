const SCIHUB_BASE_KEY = "sciHubBaseUrl";
const DEFAULT_SCIHUB_BASE_URL = "https://sci-hub.ru";
const LIBGEN_SEARCH_BASE_KEY = "libGenSearchBaseUrl";
const DEFAULT_LIBGEN_SEARCH_BASE_URL = "https://libgen.li/index.php?req=";

const form = document.getElementById("settings-form");
const sciHubInput = document.getElementById("scihub-base-url");
const libGenInput = document.getElementById("libgen-search-base-url");
const statusNode = document.getElementById("status");
const resetSciHubButton = document.getElementById("reset-scihub-default");
const resetLibGenButton = document.getElementById("reset-libgen-default");

initialize().catch(function (error) {
  renderStatus(error.message || "Could not load settings.", "error");
});

form.addEventListener("submit", function (event) {
  event.preventDefault();
  saveSettings().catch(function (error) {
    renderStatus(error.message || "Could not save settings.", "error");
  });
});

resetSciHubButton.addEventListener("click", function () {
  sciHubInput.value = DEFAULT_SCIHUB_BASE_URL;
  renderStatus("Reset Sci-Hub to the default mirror. Save to apply it.", "success");
});

resetLibGenButton.addEventListener("click", function () {
  libGenInput.value = DEFAULT_LIBGEN_SEARCH_BASE_URL;
  renderStatus("Reset LibGen to the default search. Save to apply it.", "success");
});

async function initialize() {
  const stored = await browser.storage.local.get([
    SCIHUB_BASE_KEY,
    LIBGEN_SEARCH_BASE_KEY
  ]);

  sciHubInput.value = normalizeBaseUrl(stored[SCIHUB_BASE_KEY] || DEFAULT_SCIHUB_BASE_URL);
  libGenInput.value = normalizeSearchBaseUrl(stored[LIBGEN_SEARCH_BASE_KEY] || DEFAULT_LIBGEN_SEARCH_BASE_URL);
}

async function saveSettings() {
  const normalizedSciHub = normalizeBaseUrl(sciHubInput.value);
  const normalizedLibGen = normalizeSearchBaseUrl(libGenInput.value);

  await browser.storage.local.set({
    [SCIHUB_BASE_KEY]: normalizedSciHub,
    [LIBGEN_SEARCH_BASE_KEY]: normalizedLibGen
  });

  sciHubInput.value = normalizedSciHub;
  libGenInput.value = normalizedLibGen;
  renderStatus("Saved.", "success");
}

function normalizeBaseUrl(value) {
  const candidate = String(value || "").trim();
  const parsed = new URL(candidate);

  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error("Use an absolute HTTP or HTTPS URL.");
  }

  return parsed.href.replace(/\/+$/, "");
}

function normalizeSearchBaseUrl(value) {
  const candidate = String(value || "").trim();
  const parsed = new URL(candidate);

  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error("Use an absolute HTTP or HTTPS URL.");
  }

  return parsed.href;
}

function renderStatus(message, state) {
  statusNode.textContent = message;
  statusNode.dataset.state = state || "";
}
