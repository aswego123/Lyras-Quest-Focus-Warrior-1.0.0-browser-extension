// ═══════════════════════════════════════════════════
// LYRA'S QUEST v2 — popup.js
// System clock, dev scrubber, cat walk, level-up toast
// ═══════════════════════════════════════════════════

const CIRC = 408.4;   // 2π×65
const WORK = 25 * 60;
const BRK  =  5 * 60;

const XP_THRESHOLDS = [0,100,250,500,900,1500,Infinity];
const LEVEL_NAMES   = ['','Novice Wanderer','Forest Scout','Shadow Blade','Storm Knight','Arcane Warrior','Legend of the Realm'];
const QUOTES = [
  'Every battle begins with a single step.',
  'Rest is not weakness — it is wisdom.',
  'A warrior who never rests never improves.',
  'The quest grows longer. Your strength grows too.',
  'Knowledge is the sharpest blade.',
];

function xpPct(xp, level) {
  const lo = XP_THRESHOLDS[level-1] ?? 0;
  const hi = XP_THRESHOLDS[level]   ?? 1500;
  return Math.min(1, (xp-lo) / (hi-lo));
}
function fmt(s) {
  const m = Math.floor(s/60);
  return `${m}:${String(s%60).padStart(2,'0')}`;
}

let poll = null;
let prevLevel = 1;
let catBusy = false;

// ── Cat walk animation ────────────────────────────
function launchCat() {
  if (catBusy) return;
  catBusy = true;
  const cat = document.getElementById('cat');
  // pick a random cat emoji
  const cats = ['🐱','🐈','🐈‍⬛','😺','😸','🙀'];
  cat.textContent = cats[Math.floor(Math.random() * cats.length)];
  cat.classList.remove('go');
  // force reflow
  void cat.offsetWidth;
  cat.classList.add('go');
  cat.addEventListener('animationend', () => {
    cat.classList.remove('go');
    catBusy = false;
  }, { once: true });
}

// ── Level-up toast ────────────────────────────────
function showLevelUp(name) {
  const t = document.getElementById('toast');
  t.textContent = `✦ LEVEL UP — ${name} ✦`;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

// ── Ring update ───────────────────────────────────
function setRing(left, total, isBreak) {
  const pct    = Math.max(0, left / total);
  const offset = CIRC * (1 - pct);
  document.getElementById('ring-main').style.strokeDashoffset = offset;
  document.getElementById('ring-glow').style.strokeDashoffset = offset;
  document.getElementById('ring-main').classList.toggle('brk', isBreak);
  document.getElementById('ring-glow').classList.toggle('brk', isBreak);
}

// ── Render full state ─────────────────────────────
function render(state, levelName) {
  const isWork  = state.mode === 'work';
  const isBreak = state.mode === 'break';
  const sLeft   = state.secondsLeft ?? (isBreak ? BRK : WORK);
  const total   = isBreak ? BRK : WORK;

  // Timer
  document.getElementById('ring-time').textContent = fmt(sLeft);
  document.getElementById('ring-sub').textContent  = isBreak ? 'BREAK' : 'FOCUS';
  document.getElementById('mode-tag').textContent  =
    isWork ? 'ON QUEST ⚔️' : isBreak ? '🌿 RESTING' : 'READY FOR QUEST';
  setRing(sLeft, total, isBreak);

  // Scrubber: sync to current time
  const scrubber = document.getElementById('scrubber');
  const scrubVal = document.getElementById('scrub-val');
  const maxVal = isBreak ? BRK : WORK;
  scrubber.max = maxVal;
  if (!scrubber.matches(':active')) {
    scrubber.value = sLeft;
  }
  scrubVal.textContent = fmt(sLeft) + ' remaining';

  // XP + level
  const lvl = state.level ?? 1;
  const lName = levelName || LEVEL_NAMES[lvl];
  document.getElementById('lvl-pill').textContent  = `LVL ${lvl}`;
  document.getElementById('s-lvl').textContent     = lvl;
  document.getElementById('xp-name').textContent   = lName;
  document.getElementById('xp-num').textContent    = `${state.totalXP} XP`;
  document.getElementById('xp-fill').style.width   = (xpPct(state.totalXP, lvl)*100) + '%';

  // Level-up detection
  if (lvl > prevLevel) {
    showLevelUp(lName);
    launchCat();
  }
  prevLevel = lvl;

  // Stats
  document.getElementById('s-sess').textContent   = state.session ?? 0;
  document.getElementById('s-skills').textContent = state.skillsLearned?.length ?? 0;

  // Last skill
  const skills = state.skillsLearned ?? [];
  if (skills.length) {
    const last = skills[skills.length-1];
    document.getElementById('skill-peek').classList.add('on');
    document.getElementById('sp-title').textContent = last.title;
    document.getElementById('sp-cat').textContent   = last.category.toUpperCase();
  }

  // Footer quote
  document.getElementById('footer').textContent =
    QUOTES[(state.session ?? 0) % QUOTES.length];

  // Buttons
  const go  = document.getElementById('btn-start');
  const rst = document.getElementById('btn-reset');
  if (isWork) {
    go.textContent = '⏸ PAUSE'; go.disabled = false; rst.disabled = false;
  } else if (isBreak) {
    go.textContent = '🌿 RESTING…'; go.disabled = true; rst.disabled = false;
  } else {
    go.textContent = sLeft < WORK ? '▶ RESUME' : '⚔️ BEGIN QUEST';
    go.disabled = false;
    rst.disabled = (state.session === 0 && sLeft === WORK);
  }
}

// ── Polling ───────────────────────────────────────
function startPolling() {
  clearInterval(poll);
  poll = setInterval(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, res => {
      if (res?.state) render(res.state, res.levelName);
    });
  }, 500); // 500ms for snappy feel
}

// ── Init ──────────────────────────────────────────
chrome.runtime.sendMessage({ type: 'GET_STATE' }, res => {
  if (res?.state) {
    prevLevel = res.state.level ?? 1;
    render(res.state, res.levelName);
  }
  startPolling();
});

// ── Start/Pause button ────────────────────────────
document.getElementById('btn-start').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, res => {
    const mode = res?.state?.mode;
    if (mode === 'work') {
      chrome.runtime.sendMessage({ type: 'PAUSE' });
    } else {
      chrome.runtime.sendMessage({ type: 'START_WORK' }, () => {
        // Cat walks when quest begins
        launchCat();
      });
    }
  });
});

// ── Reset button ──────────────────────────────────
document.getElementById('btn-reset').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'RESET' });
});

// ── DEV SCRUBBER ──────────────────────────────────
// Drags the system-clock end time forward/backward in real time
const scrubber = document.getElementById('scrubber');
const scrubVal = document.getElementById('scrub-val');

scrubber.addEventListener('input', () => {
  const secs = parseInt(scrubber.value, 10);
  scrubVal.textContent = fmt(secs) + ' remaining';
});

scrubber.addEventListener('change', () => {
  const secs = parseInt(scrubber.value, 10);
  // Only works while timer is active
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, res => {
    if (res?.state?.mode !== 'idle') {
      chrome.runtime.sendMessage({ type: 'DEV_SCRUB', seconds: secs }, () => {
        scrubVal.textContent = fmt(secs) + ' remaining — updated!';
      });
    } else {
      scrubVal.textContent = 'Start timer first to scrub';
    }
  });
});

// ── Listen for break start (cat walk) ────────────
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'LYRA_BREAK_START' || msg.type === 'LYRA_WORK_START') {
    launchCat();
  }
});
