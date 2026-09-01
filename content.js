(function () {
  if (window.__ytEqInit) return;
  window.__ytEqInit = true;

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

  const SMOOTH_TIME = 0.05; // seconds, avoids zipper/click noise on param changes

  let audioCtx = null;
  let boundVideo = null;
  let preampGain, subFilter, bassFilter, midFilter, trebleFilter, airFilter;
  let compressor, volumeGain, analyser;

  function ramp(param, value) {
    const now = audioCtx.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, SMOOTH_TIME);
  }

  function buildGraph(video) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaElementSource(video);

    preampGain = audioCtx.createGain();

    // Sub-bass kept as its own low shelf, separate from the "bass" peak,
    // so boosting low end doesn't dump all the gain into one narrow band
    // (that's what was clipping/buzzing before).
    subFilter = audioCtx.createBiquadFilter();
    subFilter.type = "lowshelf";
    subFilter.frequency.value = 70;

    bassFilter = audioCtx.createBiquadFilter();
    bassFilter.type = "peaking";
    bassFilter.frequency.value = 200;
    bassFilter.Q.value = 1;

    midFilter = audioCtx.createBiquadFilter();
    midFilter.type = "peaking";
    midFilter.frequency.value = 1000;
    midFilter.Q.value = 0.9;

    trebleFilter = audioCtx.createBiquadFilter();
    trebleFilter.type = "peaking";
    trebleFilter.frequency.value = 3500;
    trebleFilter.Q.value = 0.9;

    airFilter = audioCtx.createBiquadFilter();
    airFilter.type = "highshelf";
    airFilter.frequency.value = 10000;

    // Smart limiter: catches the peaks that boosted bands create so they
    // compress instead of clip (clipping is what reads as "noisy" bass).
    compressor = audioCtx.createDynamicsCompressor();
    compressor.knee.value = 24;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    volumeGain = audioCtx.createGain();

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;

    source.connect(preampGain);
    preampGain.connect(subFilter);
    subFilter.connect(bassFilter);
    bassFilter.connect(midFilter);
    midFilter.connect(trebleFilter);
    trebleFilter.connect(airFilter);
    airFilter.connect(compressor);
    compressor.connect(volumeGain);
    volumeGain.connect(analyser);
    analyser.connect(audioCtx.destination);

    boundVideo = video;

    video.addEventListener("play", () => {
      if (audioCtx.state === "suspended") audioCtx.resume();
    });
  }

  function applySettings(s) {
    if (!preampGain) return;
    ramp(preampGain.gain, Math.pow(10, s.preamp / 20));
    ramp(subFilter.gain, s.sub);
    ramp(bassFilter.gain, s.bass);
    ramp(midFilter.gain, s.mid);
    ramp(trebleFilter.gain, s.treble);
    ramp(airFilter.gain, s.air);
    ramp(volumeGain.gain, s.volume / 100);

    if (s.limiter) {
      compressor.threshold.setTargetAtTime(-24, audioCtx.currentTime, SMOOTH_TIME);
      compressor.ratio.setTargetAtTime(6, audioCtx.currentTime, SMOOTH_TIME);
    } else {
      compressor.threshold.setTargetAtTime(0, audioCtx.currentTime, SMOOTH_TIME);
      compressor.ratio.setTargetAtTime(1, audioCtx.currentTime, SMOOTH_TIME);
    }

    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  }

  function tryInit(settings) {
    const video = document.querySelector("video");
    if (!video) return false;
    if (audioCtx && boundVideo === video) {
      applySettings(settings);
      return true;
    }
    if (audioCtx) return true; // graph already bound to a (still valid) video element
    try {
      buildGraph(video);
      applySettings(settings);
      return true;
    } catch (e) {
      console.error("[YT EQ Pro] failed to init audio graph", e);
      return false;
    }
  }

  chrome.storage.local.get(DEFAULTS, (settings) => {
    const poll = setInterval(() => {
      if (tryInit(settings)) clearInterval(poll);
    }, 500);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    chrome.storage.local.get(DEFAULTS, applySettings);
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "GET_SPECTRUM") {
      if (!analyser) {
        sendResponse({ active: false });
        return;
      }
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      sendResponse({ active: true, data: Array.from(data) });
    }
    return true;
  });
})();
