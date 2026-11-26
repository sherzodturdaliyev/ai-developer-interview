// Single-file build only: runs the same handlers as server.mjs inside the page.
// The Gemini key is typed by the user, kept in memory (or localStorage if they opt in),
// and sent only to Google's API. It is never part of the file itself.

const SETTINGS_KEY = "adi-demo-gemini-settings";
const keyEl = document.getElementById("gemini-key");
const modelEl = document.getElementById("gemini-model");
const rememberEl = document.getElementById("gemini-remember");

try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
  if (saved) {
    keyEl.value = saved.key ?? "";
    if (saved.model) modelEl.value = saved.model;
    rememberEl.checked = true;
  }
} catch {
  /* storage unavailable or corrupt; start empty */
}

function persist() {
  try {
    if (rememberEl.checked) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ key: keyEl.value.trim(), model: modelEl.value.trim() }));
    } else {
      localStorage.removeItem(SETTINGS_KEY);
    }
  } catch {
    /* ignore */
  }
}

const listeners = [];
let debounce;
for (const el of [keyEl, modelEl, rememberEl]) {
  el.addEventListener(el === rememberEl ? "change" : "input", () => {
    persist();
    clearTimeout(debounce);
    debounce = setTimeout(() => listeners.forEach((fn) => fn()), 250);
  });
}

function currentHandlers() {
  const config = loadConfig({
    GEMINI_API_KEY: keyEl.value,
    GEMINI_MODEL: modelEl.value,
    GEMINI_BASE_URL: window.ADI_GEMINI_BASE_URL, // only set by tests
    AI_INTERVIEW_PROVIDER: "gemini",
    AI_EVALUATION_PROVIDER: "gemini",
    AI_EVALUATION_FALLBACK_PROVIDER: "",
  });
  return createHandlers(createProviderManager(config, { log: (e) => console.info("[ai]", e) }));
}

return {
  onSettingsChange(fn) {
    listeners.push(fn);
  },
  async request(path, body) {
    const handler = currentHandlers()[`${body === undefined ? "GET" : "POST"} ${path}`];
    if (!handler) throw new Error(`Unknown operation: ${path}`);
    try {
      // Copy the body so handlers never mutate UI state.
      return await handler(body === undefined ? undefined : JSON.parse(JSON.stringify(body)));
    } catch (err) {
      const e = new Error(err?.message ?? String(err));
      e.code = err instanceof ValidationError ? "VALIDATION_ERROR" : err?.code ?? "INTERNAL_ERROR";
      throw e;
    }
  },
};
