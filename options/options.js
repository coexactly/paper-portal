const SCIHUB_BASE_KEY = "sciHubBaseUrl";
const DEFAULT_SCIHUB_BASE_URL = "https://sci-hub.se";

const form = document.getElementById("settings-form");
const input = document.getElementById("scihub-base-url");
const statusNode = document.getElementById("status");
const resetButton = document.getElementById("reset-default");

initialize().catch(function (error) {
  renderStatus(error.message || "Could not load settings.", "error");
});

form.addEventListener("submit", function (event) {
  event.preventDefault();
  saveSettings().catch(function (error) {
    renderStatus(error.message || "Could not save settings.", "error");
  });
});

resetButton.addEventListener("click", function () {
  input.value = DEFAULT_SCIHUB_BASE_URL;
  renderStatus("Reset to the default mirror. Save to apply it.", "success");
});

async function initialize() {
  const stored = await browser.storage.local.get(SCIHUB_BASE_KEY);
  input.value = normalizeBaseUrl(stored[SCIHUB_BASE_KEY] || DEFAULT_SCIHUB_BASE_URL);
}

async function saveSettings() {
  const normalized = normalizeBaseUrl(input.value);

  await browser.storage.local.set({
    [SCIHUB_BASE_KEY]: normalized
  });

  input.value = normalized;
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

function renderStatus(message, state) {
  statusNode.textContent = message;
  statusNode.dataset.state = state || "";
}
