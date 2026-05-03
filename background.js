// ═══════════════════════════════════════════════════
// LYRA'S QUEST v2 — Background Service Worker
// System-clock based timer (no drift)
// ═══════════════════════════════════════════════════

const WORK_MINUTES  = 25;
const BREAK_MINUTES = 5;
const ALARM_END     = 'lyra_end';

const DEFAULT_STATE = {
  mode: 'idle',
  endTime: null,          // epoch ms when current phase ends
  totalSeconds: WORK_MINUTES * 60,
  session: 0,
  totalXP: 0,
  level: 1,
  skillsLearned: [],
  currentSkill: null,
};

const LEVEL_NAMES = ['','Novice Wanderer','Forest Scout','Shadow Blade','Storm Knight','Arcane Warrior','Legend of the Realm'];
const XP_THRESHOLDS = [0,100,250,500,900,1500,Infinity];

function calcLevel(xp) {
  for (let i = 1; i < XP_THRESHOLDS.length; i++) {
    if (xp < XP_THRESHOLDS[i]) return i;
  }
  return 6;
}

async function getState() {
  const { lyraState } = await chrome.storage.local.get('lyraState');
  return lyraState ?? { ...DEFAULT_STATE };
}

async function setState(patch) {
  const current = await getState();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ lyraState: next });
  return next;
}

// secondsLeft computed from system clock
function secondsLeft(state) {
  if (!state.endTime || state.mode === 'idle') return state.totalSeconds;
  return Math.max(0, Math.round((state.endTime - Date.now()) / 1000));
}

async function pickRandomSkill() {
  const url   = chrome.runtime.getURL('skills.json');
  const res   = await fetch(url);
  const all   = await res.json();
  const state = await getState();
  const recent = state.skillsLearned.slice(-10).map(s => s.id);
  const pool   = all.filter(s => !recent.includes(s.id));
  const chosen = pool.length ? pool : all;
  return chosen[Math.floor(Math.random() * chosen.length)];
}

async function broadcast(msg) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    try { await chrome.tabs.sendMessage(tab.id, msg); } catch (_) {}
  }
}

async function startWork() {
  await chrome.alarms.clear(ALARM_END);
  const endTime = Date.now() + WORK_MINUTES * 60 * 1000;
  const state = await setState({
    mode: 'work',
    endTime,
    totalSeconds: WORK_MINUTES * 60,
  });
  chrome.alarms.create(ALARM_END, { delayInMinutes: WORK_MINUTES });
  await broadcast({ type: 'LYRA_WORK_START', state });
}

async function startBreak() {
  await chrome.alarms.clear(ALARM_END);
  const skill  = await pickRandomSkill();
  const prev   = await getState();
  const newXP  = prev.totalXP + skill.xp;
  const newLvl = calcLevel(newXP);
  const leveled = newLvl > prev.level;
  const endTime = Date.now() + BREAK_MINUTES * 60 * 1000;

  const state = await setState({
    mode: 'break',
    endTime,
    totalSeconds: BREAK_MINUTES * 60,
    session: prev.session + 1,
    totalXP: newXP,
    level: newLvl,
    currentSkill: skill,
    skillsLearned: [...prev.skillsLearned, { id: skill.id, title: skill.title, category: skill.category }],
  });

  chrome.alarms.create(ALARM_END, { delayInMinutes: BREAK_MINUTES });
  await broadcast({ type: 'LYRA_BREAK_START', state, skill, leveled });

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: "⚔️ Lyra's Quest — Break Time!",
    message: `Session ${state.session} complete! Skill unlocked: ${skill.title}`,
  });
}

async function endBreak() {
  await chrome.alarms.clear(ALARM_END);
  const state = await setState({
    mode: 'idle',
    endTime: null,
    totalSeconds: WORK_MINUTES * 60,
    currentSkill: null,
  });
  await broadcast({ type: 'LYRA_BREAK_END', state });
}

async function pause() {
  const state = await getState();
  if (state.mode === 'idle') return;
  await chrome.alarms.clear(ALARM_END);
  const remaining = secondsLeft(state);
  await setState({ mode: 'idle', endTime: null, totalSeconds: remaining });
  await broadcast({ type: 'LYRA_PAUSED' });
}

async function reset() {
  await chrome.alarms.clear(ALARM_END);
  const s = await setState({ ...DEFAULT_STATE });
  await broadcast({ type: 'LYRA_RESET', state: s });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_END) return;
  const state = await getState();
  if (state.mode === 'work')  await startBreak();
  else if (state.mode === 'break') await endBreak();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'START_WORK':    await startWork();  break;
      case 'PAUSE':         await pause();      break;
      case 'RESET':         await reset();      break;
      case 'DISMISS_BREAK': await endBreak();   break;
      case 'GET_STATE': {
        const state = await getState();
        const sLeft = secondsLeft(state);
        sendResponse({ state: { ...state, secondsLeft: sLeft }, levelName: LEVEL_NAMES[state.level] });
        return;
      }
      // DEV: jump timer to N seconds remaining
      case 'DEV_SCRUB': {
        const state = await getState();
        if (state.mode !== 'idle') {
          const newEnd = Date.now() + msg.seconds * 1000;
          await chrome.alarms.clear(ALARM_END);
          chrome.alarms.create(ALARM_END, { delayInMinutes: msg.seconds / 60 });
          await setState({ endTime: newEnd });
        }
        break;
      }
    }
    const state = await getState();
    const sLeft = secondsLeft(state);
    sendResponse({ ok: true, state: { ...state, secondsLeft: sLeft }, levelName: LEVEL_NAMES[state.level] });
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({ lyraState: { ...DEFAULT_STATE } });
});
