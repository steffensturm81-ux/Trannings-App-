'use strict';

const STORAGE_KEY = 'rb-plan-v1';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);
const numberValue = value => Number(String(value ?? '').replace(',', '.'));
const roundToPlate = value => Math.round(value / 2.5) * 2.5;
const formatTime = seconds => {
  const value = Math.max(0, Math.floor(seconds));
  return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0');
};
const hints = [
  'Einstieg · Kraftübungen RPE 7 · drei Wiederholungen Reserve',
  'Aufbau · Kraftübungen RPE 8 · zwei Wiederholungen Reserve',
  'Peak · Kraftübungen maximal RPE 9 · eine Wiederholung Reserve',
  'Deload · weniger Sätze und leichter trainieren'
];

let S = {week: 1, day: 0, log: {}, mx: {}, dur: {}, sessions: [], sound: true};

function validState(value) {
  return value && typeof value === 'object' && value.log && typeof value.log === 'object' && !Array.isArray(value.log);
}

function loadState(value) {
  if (!validState(value)) throw new Error('Ungültiges Backup');
  S = {...S, ...value};
  S.week = Math.max(1, Math.floor(Number(S.week) || 1));
  S.day = Math.min(3, Math.max(0, Number(S.day) || 0));
  S.mx = S.mx || {};
  S.dur = S.dur || {};
  S.sessions = Array.isArray(S.sessions) ? S.sessions : [];
  S.sound = S.sound !== false;
  if (S.t && !S.running) S.running = {key: S.week + '|' + S.day, start: S.t};
  delete S.t;
  if (S.running?.key) {
    const [week, day] = String(S.running.key).split('|').map(Number);
    if (week > 0 && day >= 0 && day < D.length) {
      S.week = week;
      S.day = day;
    }
  }
}

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) loadState(JSON.parse(saved));
} catch {
  alert('Alte Daten konnten nicht geladen werden.');
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(S));
    if ($('#storageStatus')) $('#storageStatus').textContent = 'Lokal gespeichert.';
  } catch {
    if ($('#storageStatus')) $('#storageStatus').textContent = 'Speichern fehlgeschlagen. Bitte Backup exportieren.';
  }
  updateHome();
}

const readLog = key => S.log[key] || {};
const currentPrefix = () => S.week + '|' + S.day;
const exerciseKey = (week, day, exercise, set) => `${week}|${day}|${D[day].e[exercise][6] ? 'v2-' : ''}${exercise}|${set}`;

let view = 'home';
let restEnd = Number(S.rest?.end) || 0;
let restSeconds = Number(S.rest?.seconds) || 90;
let lastRestSecond = null;
let restFinishedAnnounced = restEnd > 0 && restEnd <= Date.now();
let audioContext;
let wakeLock;
let wakeLockPending = false;

function targetWeight(exercise, exerciseIndex, setIndex) {
  for (let week = S.week - 1; week >= 1; week--) {
    const previous = readLog(exerciseKey(week, S.day, exerciseIndex, setIndex));
    const weight = numberValue(previous.w);
    if (weight > 0 && previous.d) return S.deload?.[S.week] ? Math.round(weight * .8 * 2) / 2 : weight;
  }
  const max = numberValue(S.mx[exercise[4]]);
  return exercise[4] && max > 0 ? roundToPlate(max * (S.deload?.[S.week] ? .6 : .725)) : '';
}

function exerciseFigure(name) {
  const art = ART[name];
  if (!art) return '';
  return `<svg class="exerciseFig" viewBox="0 0 240 122" role="img" aria-label="${escapeHtml(name)}: schematische Start- und Endposition">${art.slice(0, 2).map((poseName, index) => {
    const pose = POSES[poseName];
    const offset = index * 120 + 10;
    const point = joint => [pose[joint * 2] + offset, pose[joint * 2 + 1] + 14];
    const line = (start, end) => `<line x1="${point(start)[0]}" y1="${point(start)[1]}" x2="${point(end)[0]}" y2="${point(end)[1]}"/>`;
    const equipment = art[2] || '';
    let gear = '';
    if (equipment.includes('box')) gear += `<rect x="${offset + 70}" y="91" width="25" height="19"/>`;
    if (equipment.includes('bench')) gear += `<path d="M${offset + 10} 83h44v27 M${offset + 15} 83v27"/>`;
    if (equipment.includes('bar')) gear += `<path d="M${offset + 20} 22h60"/>`;
    if (equipment.includes('dip')) gear += `<path d="M${offset + 30} 74h45v36"/>`;
    if (equipment.includes('press')) gear += `<path d="M${offset + 70} 45l25 22 M${offset + 8} 75l35 25"/>`;
    if (equipment.includes('sled')) gear += `<path d="M${offset + 92} 59v51h-25"/>`;
    if (equipment.includes('weight') || equipment.includes('ball')) gear += `<circle cx="${point(6)[0]}" cy="${point(6)[1]}" r="5" fill="#e8b63e"/>`;
    return `<g><text x="${offset + 50}" y="10" text-anchor="middle" fill="#aaa79f" stroke="none" font-size="9">${index ? 'ENDE' : 'START'}</text><g stroke="#74664a" stroke-width="2">${gear}<path d="M${offset} 110h100"/></g><g stroke="#f5d77b" stroke-width="3.5">${line(1, 2) + line(2, 3) + line(3, 4) + line(1, 5) + line(5, 6) + (pose.length > 14 ? line(2, 7) + line(7, 8) : '')}<circle cx="${point(0)[0]}" cy="${point(0)[1]}" r="6"/></g></g>`;
  }).join('')}<path d="M116 58h8l-3 -3m3 3l-3 3" stroke="#e8b63e"/></svg>`;
}

function techniqueLink(name) {
  const query = encodeURIComponent(name + ' exercise technique');
  return `<a class="technique-link" target="_blank" rel="noopener noreferrer" href="https://www.youtube.com/results?search_query=${query}">Technikvideo</a>`;
}

function renderTraining() {
  $('#weeks').innerHTML = `
    <button data-week="${Math.max(1, S.week - 1)}" aria-label="Vorherige Trainingswoche">Zurück</button>
    <button class="active" id="weekJump">Woche ${S.week}</button>
    <button data-week="${S.week + 1}" aria-label="Nächste Trainingswoche">Weiter</button>
    <button id="deload" class="${S.deload?.[S.week] ? 'active' : ''}">${S.deload?.[S.week] ? 'Deload aktiv' : 'Deload für diese Woche'}</button>`;
  $('#days').innerHTML = D.map((day, index) => `<button data-day="${index}" class="${index === S.day ? 'active' : ''}">${day.t}<small>${day.n}</small></button>`).join('');

  const day = D[S.day];
  $('#hint').textContent = S.deload?.[S.week] ? hints[3] : hints[(S.week - 1) % 3];
  $('#dayname').textContent = day.n;
  let html = day.note ? `<aside class="card plan-note">${escapeHtml(day.note)}</aside>` : '';
  html += '<h2>Warm-up</h2><div class="panel card warm-list">';
  const warmup = S.day === 0 || S.day === 3 ? lower : upper;
  warmup.forEach((exercise, index) => {
    const key = currentPrefix() + '|w' + index;
    html += `<div class="warm"><input id="warm-${index}" type="checkbox" data-k="${key}" data-f="d" ${readLog(key).d ? 'checked' : ''}><label class="warm-copy" for="warm-${index}"><strong>${escapeHtml(exercise[0])}</strong><br><small>${escapeHtml(exercise[1])}</small>${exerciseFigure(exercise[0])}</label>${techniqueLink(exercise[0])}</div>`;
  });
  html += '</div><h2>Workout</h2>';

  day.e.forEach((exercise, exerciseIndex) => {
    const setCount = S.deload?.[S.week] ? Math.min(2, exercise[1]) : exercise[1];
    html += `<article><div class="flex spread exercise-head"><div><h3>${escapeHtml(exercise[0])}</h3><p class="muted">${setCount} × ${escapeHtml(exercise[2])} · ${exercise[3]} s Pause</p></div>${techniqueLink(exercise[0])}</div>${exerciseFigure(exercise[0])}${exercise[5] ? `<p>${escapeHtml(exercise[5])}</p>` : ''}<div class="set muted"><small>Satz</small><small>Gewicht</small><small>Wdh / Zeit / m</small></div>`;
    for (let setIndex = 0; setIndex < setCount; setIndex++) {
      const key = exerciseKey(S.week, S.day, exerciseIndex, setIndex);
      const value = readLog(key);
      const target = targetWeight(exercise, exerciseIndex, setIndex);
      html += `<div class="set"><label><input type="checkbox" data-k="${key}" data-f="d" data-rest="${exercise[3]}" ${value.d ? 'checked' : ''}> Satz ${setIndex + 1}</label><input aria-label="Gewicht Satz ${setIndex + 1}" inputmode="decimal" data-k="${key}" data-f="w" value="${escapeHtml(value.w)}" placeholder="${target || 'kg'}"><input aria-label="Leistung Satz ${setIndex + 1}" inputmode="decimal" data-k="${key}" data-f="r" value="${escapeHtml(value.r)}" placeholder="${escapeHtml(exercise[2])}"></div>`;
    }
    html += `<button data-pause="${exercise[3]}">Satzpause · ${exercise[3]} Sekunden</button></article>`;
  });

  $('#work').innerHTML = html;
  updateProgress();
  updateTimers();
  updateHome();
}

function visibleProgress() {
  const inputs = $$('#work input[type="checkbox"]');
  return {done: inputs.filter(input => input.checked).length, total: inputs.length};
}

function updateProgress() {
  const progress = visibleProgress();
  $('#progressText').textContent = `${progress.done} von ${progress.total} Einträgen erledigt`;
  const ratio = progress.total ? progress.done / progress.total : 0;
  $('#progressBar').style.width = ratio * 100 + '%';
  $('#sessionRing').style.setProperty('--progress', ratio * 360 + 'deg');
  $$('#work article').forEach(article => {
    const inputs = [...article.querySelectorAll('[type="checkbox"]')];
    article.classList.toggle('done', inputs.length > 0 && inputs.every(input => input.checked));
  });
  updateHome();
}

function expectedDayProgress() {
  const day = D[S.day];
  const warmupKeys = Array.from({length: 5}, (_, index) => currentPrefix() + '|w' + index);
  const setKeys = day.e.flatMap((exercise, exerciseIndex) => {
    const count = S.deload?.[S.week] ? Math.min(2, exercise[1]) : exercise[1];
    return Array.from({length: count}, (_, setIndex) => exerciseKey(S.week, S.day, exerciseIndex, setIndex));
  });
  const keys = [...warmupKeys, ...setKeys];
  return {done: keys.filter(key => readLog(key).d).length, total: keys.length};
}

function weekVolume() {
  let volume = 0;
  D.forEach((day, dayIndex) => day.e.forEach((exercise, exerciseIndex) => {
    for (let setIndex = 0; setIndex < exercise[1]; setIndex++) {
      const value = readLog(exerciseKey(S.week, dayIndex, exerciseIndex, setIndex));
      const weight = numberValue(value.w);
      const reps = numberValue(value.r);
      if (value.d && weight > 0 && reps > 0) volume += weight * reps;
    }
  }));
  return volume;
}

function updateHome() {
  if (!$('#homeDay')) return;
  const day = D[S.day];
  const progress = expectedDayProgress();
  $('#headerWeek').textContent = S.week;
  $('#homeDay').textContent = day.n;
  $('#homeStatus').textContent = `Woche ${S.week} · ${day.t}`;
  $('#homeProgressText').textContent = `${progress.done} von ${progress.total} Einträgen erledigt`;
  $('#homeProgressBar').style.width = (progress.total ? progress.done / progress.total * 100 : 0) + '%';
  $('#homeSessions').textContent = S.sessions.length;
  $('#homeVolume').textContent = Math.round(weekVolume()).toLocaleString('de-DE') + ' kg';
  $('#openWorkout').textContent = S.running ? 'Training fortsetzen' : 'Training öffnen';
  $('#activeSessionStatus').textContent = S.running ? 'Training läuft' : 'Bereit';
}

function renderStats() {
  const completed = Object.values(S.log).filter(value => value?.d).length;
  let html = `<div class="grid"><div class="panel card"><div class="stat">${completed}</div><small>Erledigte Einträge inklusive Warm-up</small></div><div class="panel card"><div class="stat">${S.sessions.length}</div><small>Abgeschlossene Sessions</small></div></div><h2>Gewichtsentwicklung</h2>`;
  D.forEach((day, dayIndex) => day.e.forEach((exercise, exerciseIndex) => {
    const weeks = [...new Set(Object.keys(S.log).map(key => Number(key.split('|')[0])).filter(week => week > 0))].sort((a, b) => a - b);
    const values = weeks.map(week => Math.max(0, ...Array.from({length: exercise[1]}, (_, setIndex) => {
      const value = readLog(exerciseKey(week, dayIndex, exerciseIndex, setIndex));
      return value.d ? numberValue(value.w) || 0 : 0;
    })));
    const max = Math.max(...values);
    if (!Number.isFinite(max) || !max) return;
    html += `<div class="panel card"><b>${escapeHtml(exercise[0])} · ${day.t}</b>${values.map((value, index) => `<div class="flex"><small>W${weeks[index]}</small><div style="flex:1"><div class="bar" style="width:${100 * value / max}%"></div></div><small>${value ? value + ' kg' : '–'}</small></div>`).join('')}</div>`;
  }));
  html += '<h2>Historie</h2>';
  if (!S.sessions.length) html += '<p class="muted">Noch keine beendeten Sessions.</p>';
  S.sessions.slice().reverse().forEach(session => {
    const [week, day] = String(session.key).split('|');
    html += `<div class="panel card"><b>Woche ${escapeHtml(week)} · ${escapeHtml(D[day]?.n || 'Training')}</b><br><small>${escapeHtml(new Date(session.end).toLocaleString('de-DE'))} · ${formatTime(session.seconds)}</small>${session.report ? `<div><button data-report="${session.end}">YAZIO-Bericht anzeigen</button></div>` : ''}</div>`;
  });
  const oldDurations = Object.entries(S.dur).filter(([key]) => !S.sessions.some(session => session.key === key));
  if (oldDurations.length) {
    html += '<h3>Frühere Zeitmessungen</h3>';
    oldDurations.forEach(([key, seconds]) => {
      const [week, day] = key.split('|');
      html += `<p>Woche ${escapeHtml(week)} · ${escapeHtml(D[day]?.n || 'Training')} · ${formatTime(seconds)}</p>`;
    });
  }
  $('#historyContent').innerHTML = html;
}

function setView(nextView) {
  const views = ['home', 'train', 'history', 'settings'];
  view = views.includes(nextView) ? nextView : 'home';
  views.forEach(name => $('#' + name).hidden = name !== view);
  $$('.bottom-nav [data-view]').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $('#restDock').hidden = view !== 'train' || !restEnd;
  if (view === 'history') renderStats();
  updateHome();
  window.scrollTo({top: 0, behavior: 'smooth'});
}

function unlockAudio() {
  if (!S.sound) return;
  try {
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    void audioContext.resume().catch(() => {});
  } catch {
    audioContext = null;
  }
}

function playTone(frequency = 660, duration = .16) {
  if (!S.sound || audioContext?.state !== 'running') return;
  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(.14, now);
  gain.gain.exponentialRampToValueAtTime(.001, now + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + .02);
}

function announce(message, options = {}) {
  if (!S.sound) return;
  unlockAudio();
  playTone(options.frequency || 660, options.duration || .16);
  if (options.vibrate && navigator.vibrate) navigator.vibrate(options.vibrate);
  if (options.speak === false || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const speech = new SpeechSynthesisUtterance(message);
  speech.lang = 'de-DE';
  const voice = speechSynthesis.getVoices().find(candidate => candidate.lang === 'de-DE');
  if (voice) speech.voice = voice;
  speechSynthesis.speak(speech);
}

async function keepAwake() {
  const active = Boolean(S.running || restEnd > Date.now());
  if (!active || wakeLockPending || wakeLock && !wakeLock.released || document.hidden || !navigator.wakeLock) return;
  wakeLockPending = true;
  try {
    const acquired = await navigator.wakeLock.request('screen');
    if (S.running || restEnd > Date.now()) wakeLock = acquired;
    else await acquired.release();
  } catch {
    wakeLock = null;
  } finally {
    wakeLockPending = false;
  }
}

function releaseWakeLockIfIdle() {
  if (S.running || restEnd > Date.now()) return;
  if (wakeLock) void wakeLock.release().catch(() => {});
  wakeLock = null;
}

function startRest(seconds) {
  unlockAudio();
  restSeconds = seconds;
  restEnd = Date.now() + seconds * 1000;
  lastRestSecond = seconds;
  restFinishedAnnounced = false;
  S.rest = {end: restEnd, seconds};
  saveState();
  announce(`Satzpause. ${seconds} Sekunden.`, {frequency: 540, vibrate: 35});
  void keepAwake();
  updateTimers();
}

function stopRest() {
  restEnd = 0;
  lastRestSecond = null;
  restFinishedAnnounced = false;
  delete S.rest;
  saveState();
  updateTimers();
  releaseWakeLockIfIdle();
}

function updateTimers() {
  const now = Date.now();
  const restRemaining = restEnd ? Math.max(0, Math.ceil((restEnd - now) / 1000)) : 0;
  if (restEnd && restRemaining === 10 && lastRestSecond !== 10) announce('Noch zehn Sekunden.', {frequency: 620});
  if (restEnd && restRemaining > 0 && restRemaining <= 3 && lastRestSecond !== restRemaining) playTone(720 + (3 - restRemaining) * 80, .1);
  if (restEnd && restRemaining === 0 && !restFinishedAnnounced) {
    restFinishedAnnounced = true;
    announce('Pause beendet. Nächster Satz.', {frequency: 880, duration: .24, vibrate: [70, 45, 70]});
    releaseWakeLockIfIdle();
  }
  lastRestSecond = restRemaining;
  $('#restTime').textContent = formatTime(restRemaining);
  $('#restLabel').textContent = restEnd && restRemaining === 0 ? 'Pause beendet' : 'Satzpause';
  $('#restStart').textContent = restSeconds + ' s Pause';
  $('#restDock').hidden = view !== 'train' || !restEnd;

  const running = S.running;
  $('#session').textContent = running ? 'Training beenden' : 'Training starten';
  $('#sessionTime').textContent = running ? formatTime((now - running.start) / 1000) : formatTime(S.dur[currentPrefix()] || 0);
  $('#activeSessionStatus').textContent = running ? 'Training läuft' : 'Bereit';
}

function activeSelectionBlocked() {
  if (!S.running) return false;
  alert('Beende zuerst das laufende Training, bevor du Woche oder Trainingstag wechselst.');
  return true;
}

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.view) {
    setView(button.dataset.view);
  } else if (button.id === 'weekJump') {
    if (activeSelectionBlocked()) return;
    const week = Number(prompt('Zu welcher Trainingswoche wechseln?', S.week));
    if (Number.isSafeInteger(week) && week > 0 && week <= 10000) {
      S.week = week;
      saveState();
      renderTraining();
    }
  } else if (button.id === 'deload') {
    S.deload = S.deload || {};
    S.deload[S.week] = !S.deload[S.week];
    saveState();
    renderTraining();
  } else if (button.dataset.week || button.dataset.day !== undefined) {
    if (activeSelectionBlocked()) return;
    if (button.dataset.week) S.week = Number(button.dataset.week);
    else S.day = Number(button.dataset.day);
    saveState();
    renderTraining();
  } else if (button.dataset.pause) {
    startRest(Number(button.dataset.pause));
  } else if (button.dataset.report) {
    const entry = S.sessions.find(session => String(session.end) === button.dataset.report);
    if (entry) {
      setView('train');
      showReport(entry);
    }
  }
});

document.addEventListener('input', event => {
  const target = event.target;
  if (target.dataset.m) {
    S.mx[target.dataset.m] = target.value;
    saveState();
    return;
  }
  if (!target.dataset.k) return;
  const value = S.log[target.dataset.k] || (S.log[target.dataset.k] = {});
  if (target.dataset.f === 'd' && target.checked) value.completedAt = Date.now();
  value[target.dataset.f] = target.type === 'checkbox' ? target.checked : target.value;
  saveState();
  updateProgress();
  if (target.checked && target.dataset.rest) startRest(Number(target.dataset.rest));
});

$('#session').onclick = () => {
  unlockAudio();
  if (S.running) {
    const running = S.running;
    const end = Date.now();
    const seconds = Math.max(1, Math.round((end - running.start) / 1000));
    S.dur[running.key] = seconds;
    const entry = {key: running.key, start: running.start, end, seconds, report: measurePerformance(running, seconds)};
    S.sessions.push(entry);
    delete S.running;
    restEnd = 0;
    delete S.rest;
    showReport(entry);
    saveState();
    announce('Training abgeschlossen. Starke Arbeit.', {frequency: 920, duration: .28, vibrate: [90, 60, 90]});
    releaseWakeLockIfIdle();
  } else {
    $('#report').hidden = true;
    S.running = {key: currentPrefix(), start: Date.now(), before: Object.keys(S.log).filter(key => S.log[key]?.d)};
    saveState();
    announce(`Training gestartet. ${D[S.day].n}.`, {frequency: 720, vibrate: 45});
    void keepAwake();
  }
  updateTimers();
};

$('#restStart').onclick = () => startRest(restSeconds);
$('#quickRest').onclick = () => startRest(90);
$('#restStop').onclick = stopRest;
$('#reset').onclick = () => {
  if (S.running) {
    alert('Beende zuerst das laufende Training.');
    return;
  }
  if (!confirm('Alle Einträge dieses Trainingstags löschen?')) return;
  Object.keys(S.log).filter(key => key.startsWith(currentPrefix() + '|')).forEach(key => delete S.log[key]);
  saveState();
  renderTraining();
};

function renderMaxes() {
  $('#maxes').innerHTML = [['bp', 'Bankdrücken'], ['pp', 'Push Press']].map(([key, name]) => `<label class="set"><span>${name}</span><input class="rm" data-m="${key}" inputmode="decimal" value="${escapeHtml(S.mx[key])}" placeholder="kg"><span>kg</span></label>`).join('');
}

$('#export').onclick = () => {
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], {type: 'application/json'}));
  link.href = url;
  link.download = 'gridiron-training-backup.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

$('#import').onclick = () => $('#file').click();
$('#file').onchange = async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const value = JSON.parse(await file.text());
    if (!validState(value)) throw new Error('Ungültiges Backup');
    if (confirm('Lokale Daten durch dieses Backup ersetzen?')) {
      loadState(value);
      saveState();
      syncSettings();
      renderMaxes();
      renderTraining();
    }
  } catch {
    alert('Backup konnte nicht gelesen werden.');
  } finally {
    $('#file').value = '';
  }
};

function recommendIntensity(report, seconds) {
  const minutes = Math.max(seconds / 60, 1);
  const density = report.volume / minutes;
  const repRate = report.reps / minutes;
  const setRate = report.sets / minutes;
  const score = density / Math.max(report.mass, 1) + repRate * .15 + setRate * .8;
  const met = score >= 3.2 ? 6 : score >= 1.7 ? 5 : 3.5;
  return {met, density, repRate, score};
}

function measurePerformance(running, seconds) {
  const [week, day] = running.key.split('|').map(Number);
  let sets = 0;
  let reps = 0;
  let volume = 0;
  D[day].e.forEach((exercise, exerciseIndex) => {
    for (let setIndex = 0; setIndex < exercise[1]; setIndex++) {
      const key = exerciseKey(week, day, exerciseIndex, setIndex);
      const value = readLog(key);
      if (!value.d || running.before?.includes(key) && !(value.completedAt >= running.start)) continue;
      sets++;
      const recordedReps = numberValue(value.r);
      const weight = numberValue(value.w);
      if (!/Sek|sec|\bm\b/i.test(exercise[2]) && recordedReps > 0 && Number.isFinite(recordedReps)) {
        reps += recordedReps;
        if (weight > 0 && Number.isFinite(weight)) volume += weight * recordedReps;
      }
    }
  });
  const report = {sets, reps, volume, mass: Number(S.mass) || 102};
  const recommendation = recommendIntensity(report, seconds);
  return {...report, met: recommendation.met, recommendedMet: recommendation.met, density: recommendation.density, performanceScore: recommendation.score};
}

function showReport(entry) {
  const report = {sets: 0, reps: 0, volume: 0, mass: Number(S.mass) || 102, ...entry.report};
  entry.report = report;
  const recommendation = recommendIntensity(report, entry.seconds);
  report.recommendedMet = [3.5, 5, 6].includes(Number(report.recommendedMet)) ? Number(report.recommendedMet) : recommendation.met;
  report.met = [3.5, 5, 6].includes(Number(report.met)) ? Number(report.met) : report.recommendedMet;
  report.density = Number.isFinite(Number(report.density)) ? Number(report.density) : recommendation.density;
  const minutes = Math.max(1, Math.round(entry.seconds / 60));
  const intensityName = value => ({'3.5': 'Normal', '5': 'Anstrengend', '6': 'Sehr intensiv'})[String(value)] || 'Normal';
  const element = $('#report');
  element.hidden = false;
  element.innerHTML = `
    <p class="eyebrow">POST GAME REPORT</p>
    <h2>Training abgeschlossen</h2>
    <strong id="kcal"></strong>
    <p class="muted" id="range"></p>
    <div class="report-stats">
      <div class="report-stat"><strong>${minutes}</strong><span>Minuten</span></div>
      <div class="report-stat"><strong>${report.sets}</strong><span>Sätze</span></div>
      <div class="report-stat"><strong>${report.reps}</strong><span>Wdh.</span></div>
      <div class="report-stat"><strong>${Math.round(report.volume).toLocaleString('de-DE')}</strong><span>kg Last</span></div>
    </div>
    <label>Intensität inklusive Pausen
      <select id="met">
        <option value="3.5">Normal · 3,5 MET</option>
        <option value="5">Anstrengend · 5 MET</option>
        <option value="6">Sehr intensiv · 6 MET</option>
      </select>
    </label>
    <p class="muted" id="performanceHint"></p>
    <textarea id="yazio" readonly aria-label="Kopierbarer YAZIO-Bericht"></textarea>
    <div class="button-row"><button class="primary" id="copyReport">Für YAZIO kopieren</button><button id="copyKcal">Nur kcal kopieren</button></div>
    <p id="copyStatus" role="status"></p>`;
  $('#met').value = String(report.met);

  const update = () => {
    report.met = Number($('#met').value);
    const caloriesFor = met => Math.round(Math.max(0, met - 1) * 3.5 * report.mass / 200 * entry.seconds / 60);
    report.kcal = caloriesFor(report.met);
    $('#kcal').textContent = `≈ ${report.kcal} aktive kcal`;
    $('#range').textContent = `Orientierung · ${caloriesFor(3.5)} bis ${caloriesFor(6)} kcal`;
    $('#performanceHint').textContent = `Vorschlag aus Gewichten, Wiederholungen und Zeit: ${intensityName(report.recommendedMet)}. Trainingsdichte ${Math.round(report.density).toLocaleString('de-DE')} kg pro Minute. Die Berechnung bleibt eine Schätzung.`;
    $('#yazio').value = `GRIDIRON Krafttraining | ${minutes} Min. | ${report.kcal} aktive kcal (geschätzt) | ${report.sets} Sätze | ${report.reps} Wdh. | ${Math.round(report.volume)} kg Last | Intensität ${intensityName(report.met)}`;
    saveState();
  };
  $('#met').onchange = update;
  update();

  const copy = async value => {
    try {
      await navigator.clipboard.writeText(value);
      $('#copyStatus').textContent = 'Kopiert. Du kannst den Wert jetzt in YAZIO eintragen.';
    } catch {
      $('#yazio').focus();
      $('#yazio').select();
      $('#copyStatus').textContent = 'Der Bericht ist markiert. Bitte kopiere ihn manuell.';
    }
  };
  $('#copyKcal').onclick = () => copy(String(report.kcal));
  $('#copyReport').onclick = () => copy($('#yazio').value);
  element.scrollIntoView({behavior: 'smooth', block: 'center'});
}

function syncSettings() {
  $('#bodyMass').value = S.mass || 102;
  $('#soundEnabled').checked = S.sound;
}

$('#bodyMass').onchange = () => {
  const value = Number($('#bodyMass').value);
  if (value >= 30 && value <= 300) {
    S.mass = value;
    saveState();
  } else {
    $('#bodyMass').value = S.mass || 102;
  }
};

$('#soundEnabled').onchange = () => {
  S.sound = $('#soundEnabled').checked;
  saveState();
  if (S.sound) {
    unlockAudio();
    announce('Ton und Ansagen sind aktiv.', {frequency: 720});
    $('#soundStatus').textContent = 'Ton und Ansagen sind aktiv.';
  } else {
    window.speechSynthesis?.cancel();
    $('#soundStatus').textContent = 'Ton und Ansagen sind ausgeschaltet.';
  }
};

$('#soundTest').onclick = () => {
  unlockAudio();
  if (!S.sound) {
    $('#soundStatus').textContent = 'Aktiviere zuerst den Ton.';
    return;
  }
  announce('GRIDIRON ist bereit.', {frequency: 760, vibrate: 40});
  $('#soundStatus').textContent = 'Testsignal und Ansage wurden abgespielt.';
};

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    updateTimers();
    void keepAwake();
  }
});

window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  try {
    loadState(JSON.parse(event.newValue));
    syncSettings();
    renderMaxes();
    renderTraining();
    if (view === 'history') renderStats();
  } catch {
    // Keep the current in-memory state if another tab contains invalid data.
  }
});

syncSettings();
renderMaxes();
renderTraining();
setView('home');
setInterval(updateTimers, 250);

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Offline-Modus:', error));
}
