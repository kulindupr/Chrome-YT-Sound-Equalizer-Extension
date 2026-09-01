const DEFAULTS = {
  preamp: 0,
  sub: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  air: 0,
  volume: 100,
  limiter: true,
};

const BAND_KEYS = ["preamp", "sub", "bass", "mid", "treble", "air"];

const BUILTIN_PRESETS = {
  flat: { preamp: 0, sub: 0, bass: 0, mid: 0, treble: 0, air: 0 },
  bass: { preamp: 0, sub: 8, bass: 6, mid: 0, treble: -1, air: -2 },
  treble: { preamp: 0, sub: -2, bass: -1, mid: 0, treble: 6, air: 6 },
  vocal: { preamp: 0, sub: -4, bass: -2, mid: 7, treble: 3, air: 1 },
  loudness: { preamp: 2, sub: 6, bass: 3, mid: -2, treble: 3, air: 5 },
  podcast: { preamp: 0, sub: -6, bass: -2, mid: 6, treble: 2, air: -1 },
  movie: { preamp: 1, sub: 5, bass: 2, mid: -1, treble: 4, air: 3 },
};

const sliders = {
  volume: document.getElementById("volume"),
  preamp: document.getElementById("preamp"),
  sub: document.getElementById("sub"),
  bass: document.getElementById("bass"),
  mid: document.getElementById("mid"),
  treble: document.getElementById("treble"),
  air: document.getElementById("air"),
};

const labels = {
  volume: document.getElementById("volumeVal"),
  preamp: document.getElementById("preampVal"),
  sub: document.getElementById("subVal"),
  bass: document.getElementById("bassVal"),
  mid: document.getElementById("midVal"),
  treble: document.getElementById("trebleVal"),
  air: document.getElementById("airVal"),
};

const limiterToggle = document.getElementById("limiter");
const statusLine = document.getElementById("statusLine");

function fmt(key, val) {
  return key === "volume" ? `${val}%` : `${val}`;
}

function paint(settings) {
  for (const key of Object.keys(sliders)) {
    sliders[key].value = settings[key];
    labels[key].textContent = fmt(key, settings[key]);
  }
  limiterToggle.checked = !!settings.limiter;
}

function save(partial) {
  chrome.storage.local.set(partial);
}

chrome.storage.local.get(DEFAULTS, paint);

for (const key of Object.keys(sliders)) {
  sliders[key].addEventListener("input", () => {
    const val = Number(sliders[key].value);
    labels[key].textContent = fmt(key, val);
    save({ [key]: val });
  });
}

limiterToggle.addEventListener("change", () => {
  save({ limiter: limiterToggle.checked });
});

document.getElementById("reset").addEventListener("click", () => {
  const flat = { ...BUILTIN_PRESETS.flat, volume: 100, limiter: true };
  paint(flat);
  save(flat);
});

document.getElementById("presets").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-preset]");
  if (!btn) return;
  const preset = BUILTIN_PRESETS[btn.dataset.preset];
  chrome.storage.local.get(DEFAULTS, (current) => {
    const merged = { ...current, ...preset };
    paint(merged);
    save(merged);
  });
});

// --- custom presets ---

function renderCustomPresets(list) {
  const container = document.getElementById("customPresets");
  container.innerHTML = "";
  list.forEach((preset, i) => {
    const btn = document.createElement("button");
    btn.innerHTML = `${preset.name} <span class="del" data-i="${i}">&times;</span>`;
    btn.addEventListener("click", (e) => {
      if (e.target.classList.contains("del")) {
        e.stopPropagation();
        deleteCustomPreset(i);
        return;
      }
      chrome.storage.local.get(DEFAULTS, (current) => {
        const merged = { ...current, ...preset.values };
        paint(merged);
        save(merged);
      });
    });
    container.appendChild(btn);
  });
}

function loadCustomPresets(cb) {
  chrome.storage.local.get({ customPresets: [] }, (r) => cb(r.customPresets));
}

function deleteCustomPreset(index) {
  loadCustomPresets((list) => {
    list.splice(index, 1);
    chrome.storage.local.set({ customPresets: list }, () => renderCustomPresets(list));
  });
}

loadCustomPresets(renderCustomPresets);

document.getElementById("savePreset").addEventListener("click", () => {
  const nameInput = document.getElementById("presetName");
  const name = nameInput.value.trim();
  if (!name) return;
  chrome.storage.local.get(DEFAULTS, (current) => {
    const values = {};
    BAND_KEYS.forEach((k) => (values[k] = current[k]));
    loadCustomPresets((list) => {
      list.push({ name, values });
      chrome.storage.local.set({ customPresets: list }, () => {
        renderCustomPresets(list);
        nameInput.value = "";
      });
    });
  });
});

// --- live spectrum visualizer ---

const canvas = document.getElementById("viz");
const ctx = canvas.getContext("2d");
let activeTabId = null;

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) activeTabId = tabs[0].id;
});

function drawSpectrum(data) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!data || !data.length) {
    statusLine.textContent = "Waiting for playback…";
    return;
  }
  statusLine.textContent = "Live · equalizing";
  const barCount = data.length;
  const barWidth = w / barCount;
  const grad = ctx.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, "#7c3aed");
  grad.addColorStop(1, "#ec4899");
  ctx.fillStyle = grad;
  for (let i = 0; i < barCount; i++) {
    const barH = (data[i] / 255) * h;
    ctx.fillRect(i * barWidth + 1, h - barH, barWidth - 2, barH);
  }
}

function pollSpectrum() {
  if (activeTabId == null) return;
  chrome.tabs.sendMessage(activeTabId, { type: "GET_SPECTRUM" }, (resp) => {
    if (chrome.runtime.lastError) {
      statusLine.textContent = "Open a YouTube video";
      return;
    }
    if (resp && resp.active) drawSpectrum(resp.data);
    else statusLine.textContent = "Waiting for playback…";
  });
}

setInterval(pollSpectrum, 120);
pollSpectrum();
