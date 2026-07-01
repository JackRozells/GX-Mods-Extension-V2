/* GX Mods sidebar panel — music controls + RAM limiter / cleaner.
   Talks to the background page through the same storage.local + message paths
   the popup uses, so everything stays in sync no matter where it's changed. */

const MOD_DATABASE_KEY = "GXMusicMods";

/* ---- elements ---- */
const trackTitle = document.getElementById("trackTitle");
const trackSource = document.getElementById("trackSource");
const intensityFill = document.getElementById("intensityFill");
const prevBtn = document.getElementById("prevBtn");
const playPauseBtn = document.getElementById("playPauseBtn");
const nextBtn = document.getElementById("nextBtn");
const volumeSlider = document.getElementById("volume");
const volumePercentage = document.getElementById("volumePercentage");
const globalMuteBox = document.getElementById("globalMute");

const ramSummary = document.getElementById("ramSummary");
const ramGaugeFill = document.getElementById("ramGaugeFill");
const loadedCount = document.getElementById("loadedCount");
const unloadedCount = document.getElementById("unloadedCount");
const cleanerBtn = document.getElementById("cleanerBtn");
const cleanerResult = document.getElementById("cleanerResult");
const ramLimiterBox = document.getElementById("ramLimiter");
const idleContainer = document.getElementById("idleContainer");
const idleSlider = document.getElementById("idleMinutes");
const idleValue = document.getElementById("idleValue");

const settingsBtn = document.getElementById("settingsBtn");

/* ---- state ---- */
let trackList = [];        // [{value, label, source}] including "off"
let currentTrack = "off";
let enabled = true;

/* ===================== Music ===================== */

async function buildTrackList() {
  trackList = [
    { value: "off", label: "No music", source: "" },
    { value: "town", label: "Town", source: "Built-in" },
    { value: "journey", label: "Journey", source: "Built-in" },
  ];

  let modData = {};
  try {
    modData = (await localforage.getItem(MOD_DATABASE_KEY)) || {};
  } catch (err) {
    console.warn("[GXM] sidebar couldn't read mods:", err);
  }

  for (const [id, data] of Object.entries(modData)) {
    if (!data.layers) continue;
    if (Array.isArray(data.layers) && data.layers[0] && data.layers[0].hasOwnProperty("name")) {
      for (const songData of data.layers) {
        trackList.push({ value: `${id}/${songData.id}`, label: songData.name, source: data.displayName });
      }
    } else {
      trackList.push({ value: id, label: data.displayName || id, source: "Mod" });
    }
  }
}

function playableTracks() {
  return trackList.filter((t) => t.value !== "off");
}

function trackInfo(value) {
  return trackList.find((t) => t.value === value) || { value, label: value, source: "" };
}

function isPlaying() {
  return enabled && currentTrack !== "off";
}

function updateNowPlaying() {
  const info = trackInfo(currentTrack);
  if (currentTrack === "off") {
    trackTitle.textContent = "No music";
    trackSource.textContent = "";
  } else {
    trackTitle.textContent = info.label;
    trackSource.textContent = enabled ? info.source : "Paused";
  }
  document.body.classList.toggle("playing", isPlaying());
  if (!isPlaying()) intensityFill.style.width = "0%";
}

function applyTrack(value) {
  currentTrack = value;
  browser.storage.local.set({ trackName: value });
  browser.runtime.sendMessage("trackchange_" + value);
  updateNowPlaying();
}

function setEnabled(value) {
  enabled = value;
  browser.storage.local.set({ enabled: value });
  updateNowPlaying();
}

function step(delta) {
  const list = playableTracks();
  if (list.length === 0) return;
  let idx = list.findIndex((t) => t.value === currentTrack);
  // From "off" (idx === -1): next -> first track, prev -> last track.
  idx = (idx + delta + list.length) % list.length;
  if (currentTrack === "off" && delta < 0) idx = list.length - 1;
  applyTrack(list[idx].value);
  if (!enabled) setEnabled(true);
}

playPauseBtn.addEventListener("click", () => {
  if (isPlaying()) {
    setEnabled(false);
  } else {
    if (currentTrack === "off") {
      const list = playableTracks();
      if (list.length) applyTrack(list[0].value);
    }
    setEnabled(true);
  }
});

nextBtn.addEventListener("click", () => step(1));
prevBtn.addEventListener("click", () => step(-1));

volumeSlider.addEventListener("input", () => {
  volumePercentage.textContent = volumeSlider.value;
  browser.runtime.sendMessage("volumeChange=" + volumeSlider.value);
});
volumeSlider.addEventListener("change", () => {
  browser.storage.local.set({ volume: Number(volumeSlider.value) });
});

globalMuteBox.addEventListener("change", () => {
  browser.storage.local.set({ globalMute: globalMuteBox.checked });
});

/* Live intensity meter — polls the background's current music level, but only
   while the sidebar is visible and something is actually playing. */
async function pollIntensity() {
  if (document.hidden || !isPlaying()) return;
  try {
    const res = await browser.runtime.sendMessage({ intent: "musicLevel" });
    if (res && typeof res.level === "number") {
      const pct = Math.max(6, Math.min(res.level / 50, 1) * 100);
      intensityFill.style.width = pct + "%";
    }
  } catch (err) {
    /* background not ready yet — ignore */
  }
}
setInterval(pollIntensity, 250);

/* ===================== RAM ===================== */

async function refreshRam() {
  let tabs;
  try {
    tabs = await browser.tabs.query({});
  } catch (err) {
    return;
  }
  const total = tabs.length;
  const unloaded = tabs.filter((t) => t.discarded).length;
  const loaded = total - unloaded;

  loadedCount.textContent = loaded;
  unloadedCount.textContent = unloaded;
  ramSummary.textContent = `${loaded} / ${total} tabs loaded`;
  ramGaugeFill.style.width = (total ? (loaded / total) * 100 : 0) + "%";
}

let cleanerResultTimer = null;
function showCleanerResult(text) {
  cleanerResult.textContent = text;
  cleanerResult.classList.add("show");
  clearTimeout(cleanerResultTimer);
  cleanerResultTimer = setTimeout(() => cleanerResult.classList.remove("show"), 4000);
}

cleanerBtn.addEventListener("click", async () => {
  cleanerBtn.disabled = true;
  try {
    const res = await browser.runtime.sendMessage({ intent: "ramCleaner" });
    const n = res && typeof res.discarded === "number" ? res.discarded : 0;
    showCleanerResult(n === 0 ? "Nothing to unload" : `Unloaded ${n} tab${n === 1 ? "" : "s"}`);
  } catch (err) {
    showCleanerResult("Couldn't free RAM");
  }
  await refreshRam();
  cleanerBtn.disabled = false;
});

ramLimiterBox.addEventListener("change", () => {
  browser.storage.local.set({ ramLimiterEnabled: ramLimiterBox.checked });
  idleContainer.classList.toggle("hidden", !ramLimiterBox.checked);
});

idleSlider.addEventListener("input", () => {
  idleValue.textContent = idleSlider.value + " min";
});
idleSlider.addEventListener("change", () => {
  browser.storage.local.set({ ramLimiterIdleMinutes: Number(idleSlider.value) });
});

setInterval(() => {
  if (!document.hidden) refreshRam();
}, 2000);

/* ===================== Footer ===================== */

settingsBtn.addEventListener("click", () => {
  browser.runtime.openOptionsPage();
});

/* ===================== Init + sync ===================== */

async function init() {
  await buildTrackList();

  const s = await browser.storage.local.get();
  enabled = typeof s.enabled === "undefined" ? true : s.enabled;
  currentTrack = s.trackName || "off";
  volumeSlider.value = typeof s.volume === "undefined" ? 50 : s.volume;
  volumePercentage.textContent = volumeSlider.value;
  globalMuteBox.checked = !!s.globalMute;

  ramLimiterBox.checked = !!s.ramLimiterEnabled;
  const idleMinutes = typeof s.ramLimiterIdleMinutes === "undefined" ? 20 : s.ramLimiterIdleMinutes;
  idleSlider.value = idleMinutes;
  idleValue.textContent = idleMinutes + " min";
  idleContainer.classList.toggle("hidden", !ramLimiterBox.checked);

  updateNowPlaying();
  refreshRam();
}

/* Keep the panel in sync when settings change from the popup, shortcuts, etc. */
browser.storage.local.onChanged.addListener((changes) => {
  if (changes.enabled) {
    enabled = changes.enabled.newValue;
    updateNowPlaying();
  }
  if (changes.trackName) {
    currentTrack = changes.trackName.newValue || "off";
    updateNowPlaying();
  }
  if (changes.volume) {
    volumeSlider.value = changes.volume.newValue;
    volumePercentage.textContent = changes.volume.newValue;
  }
  if (changes.globalMute) {
    globalMuteBox.checked = !!changes.globalMute.newValue;
  }
  if (changes.ramLimiterEnabled) {
    ramLimiterBox.checked = !!changes.ramLimiterEnabled.newValue;
    idleContainer.classList.toggle("hidden", !ramLimiterBox.checked);
  }
  if (changes.ramLimiterIdleMinutes) {
    idleSlider.value = changes.ramLimiterIdleMinutes.newValue;
    idleValue.textContent = changes.ramLimiterIdleMinutes.newValue + " min";
  }
});

init();
