// ═══════════════════════════════════════════════════
// LYRA'S QUEST v2 — Content Script
// Fullscreen overlay + walking cat on every tab
// ═══════════════════════════════════════════════════

let overlay      = null;
let timerInterval = null;
const CIRC = 2 * Math.PI * 50;
const XP_THRESHOLDS = [0,100,250,500,900,1500,Infinity];
const LEVEL_NAMES   = ['','Novice Wanderer','Forest Scout','Shadow Blade','Storm Knight','Arcane Warrior','Legend of the Realm'];

function xpProgress(xp, level) {
  const lo = XP_THRESHOLDS[level-1] ?? 0;
  const hi = XP_THRESHOLDS[level]   ?? 1500;
  return Math.min(1, (xp-lo)/(hi-lo));
}

// ── Inject cat CSS once ───────────────────────────
function injectCatStyle() {
  if (document.getElementById('lyra-cat-style')) return;
  const s = document.createElement('style');
  s.id = 'lyra-cat-style';
  s.textContent = `
    #lyra-cat-walk {
      position:fixed;bottom:20px;left:-120px;z-index:2147483648;
      font-size:72px;line-height:1;pointer-events:none;
      filter:drop-shadow(0 0 14px rgba(255,180,80,0.7));
      transition:none;
    }
    #lyra-cat-walk.go {
      animation: lyra-cat-run 5s linear forwards;
    }
    @keyframes lyra-cat-run {
      0%   { left:-120px; }
      100% { left:calc(100vw + 120px); }
    }
  `;
  document.head.appendChild(s);
}

let catBusy = false;
function launchPageCat() {
  injectCatStyle();
  if (catBusy) return;
  catBusy = true;

  let cat = document.getElementById('lyra-cat-walk');
  if (!cat) {
    cat = document.createElement('div');
    cat.id = 'lyra-cat-walk';
    document.body.appendChild(cat);
  }
  const cats = ['🐱','🐈','🐈‍⬛','😺','😸'];
  cat.textContent = cats[Math.floor(Math.random() * cats.length)];
  cat.classList.remove('go');
  void cat.offsetWidth;
  cat.classList.add('go');
  cat.addEventListener('animationend', () => {
    cat.classList.remove('go');
    catBusy = false;
  }, { once: true });
}

// ── Build overlay ─────────────────────────────────
function buildOverlay() {
  if (document.getElementById('lyra-overlay')) return;
  const el = document.createElement('div');
  el.id = 'lyra-overlay';
  el.innerHTML = `
    <div id="lyra-levelup"></div>
    <div id="lyra-card">
      <div id="lyra-session-label">Session 0 Complete</div>
      <img id="lyra-character" src="${chrome.runtime.getURL('assets/lyra.png')}" alt="Lyra"/>
      <div id="lyra-quote"><p id="lyra-quote-text">Preparing…</p></div>
      <div id="lyra-skill-card" style="display:none">
        <div id="lyra-skill-header">
          <span id="lyra-skill-emoji">⚔️</span>
          <div id="lyra-skill-meta">
            <div id="lyra-skill-category">Skill</div>
            <div id="lyra-skill-title">Loading…</div>
          </div>
        </div>
        <p id="lyra-skill-lesson"></p>
        <div id="lyra-xp-badge">+0 XP</div>
      </div>
      <div id="lyra-timer-wrap">
        <svg id="lyra-timer-svg" viewBox="0 0 110 110">
          <circle id="lyra-timer-track" cx="55" cy="55" r="50"/>
          <circle id="lyra-timer-ring"  cx="55" cy="55" r="50"
            stroke-dasharray="${CIRC}" stroke-dashoffset="0"/>
          <text id="lyra-timer-text" x="55" y="52">5:00</text>
          <text id="lyra-timer-sub"  x="55" y="70">BREAK TIME</text>
        </svg>
        <div id="lyra-xp-bar-wrap"><div id="lyra-xp-bar" style="width:0%"></div></div>
      </div>
      <button id="lyra-btn" disabled>Rest… ⏳</button>
    </div>
  `;
  document.body.appendChild(el);
  overlay = el;
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
  const char = el.querySelector('#lyra-character');
  char.classList.add('walk-in');
  setTimeout(() => {
    char.classList.add('exhausted');
    setTimeout(() => char.classList.remove('exhausted'), 700);
  }, 900);
}

function removeOverlay() {
  clearInterval(timerInterval);
  timerInterval = null;
  if (!overlay) return;
  overlay.querySelector('#lyra-character')?.classList.add('restored');
  overlay.style.opacity = '0';
  overlay.style.transition = 'opacity 0.8s ease';
  setTimeout(() => { overlay?.remove(); overlay = null; }, 900);
}

function updateTimer(secondsLeft, totalSeconds) {
  if (!overlay) return;
  const m = Math.floor(secondsLeft/60);
  const s = secondsLeft % 60;
  overlay.querySelector('#lyra-timer-text').textContent = `${m}:${String(s).padStart(2,'0')}`;
  const progress = secondsLeft / totalSeconds;
  overlay.querySelector('#lyra-timer-ring').style.strokeDashoffset = CIRC - (CIRC * progress);
  const btn = overlay.querySelector('#lyra-btn');
  if (secondsLeft <= 5) {
    btn.disabled = false;
    btn.textContent = 'Back to the Quest! ⚔️';
  }
}

function populateSkill(skill, state, leveled) {
  if (!overlay || !skill) return;
  overlay.querySelector('#lyra-session-label').textContent =
    `Session ${state.session} Complete — ${LEVEL_NAMES[state.level]}`;
  overlay.querySelector('#lyra-quote-text').textContent    = skill.lyra_quote;
  overlay.querySelector('#lyra-skill-emoji').textContent   = skill.emoji;
  overlay.querySelector('#lyra-skill-category').textContent = skill.category.toUpperCase();
  overlay.querySelector('#lyra-skill-title').textContent   = skill.title;
  overlay.querySelector('#lyra-skill-lesson').textContent  = skill.lesson;
  overlay.querySelector('#lyra-xp-badge').textContent      = `+${skill.xp} XP  ·  Total: ${state.totalXP} XP`;
  overlay.querySelector('#lyra-skill-card').style.display = 'block';
  setTimeout(() => {
    if (overlay) overlay.querySelector('#lyra-xp-bar').style.width =
      (xpProgress(state.totalXP, state.level)*100) + '%';
  }, 400);
  if (leveled) {
    const banner = overlay.querySelector('#lyra-levelup');
    banner.textContent = `✦ LEVEL UP — ${LEVEL_NAMES[state.level]} ✦`;
    banner.classList.add('show');
    setTimeout(() => banner.classList.remove('show'), 4000);
  }
}

function showBreak(state, skill, leveled) {
  buildOverlay();
  const TOTAL = 5 * 60;
  let secsLeft = state.secondsLeft ?? TOTAL;
  setTimeout(() => populateSkill(skill, state, leveled), 600);
  overlay.querySelector('#lyra-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'DISMISS_BREAK' });
  });
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (secsLeft <= 0) { clearInterval(timerInterval); return; }
    secsLeft--;
    updateTimer(secsLeft, TOTAL);
  }, 1000);
  updateTimer(secsLeft, TOTAL);
}

// ── Message listener ──────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case 'LYRA_WORK_START':
      launchPageCat();
      break;
    case 'LYRA_BREAK_START':
      launchPageCat();
      setTimeout(() => showBreak(msg.state, msg.skill, msg.leveled), 300);
      break;
    case 'LYRA_BREAK_END':
    case 'LYRA_RESET':
      removeOverlay();
      break;
  }
});

// ── On load ───────────────────────────────────────
chrome.runtime.sendMessage({ type: 'GET_STATE' }, (res) => {
  if (!res) return;
  const { state } = res;
  if (state?.mode === 'break' && state?.currentSkill) {
    showBreak(state, state.currentSkill, false);
  }
});
