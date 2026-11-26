// Browser side of the demo. Talks only to this server's /api; no API keys here.
// Voice uses the browser's Web Speech API (speech recognition + speech synthesis).

const $ = (id) => document.getElementById(id);

/** Safe element builder: text is always set via textContent. */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of [].concat(children)) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

function showAlert(id, message, tone = "error") {
  const box = $(id);
  box.textContent = message;
  box.classList.toggle("info", tone === "info");
  box.classList.toggle("hidden", !message);
}

async function api(path, body) {
  let res;
  try {
    res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Demo serverga ulanib bo‘lmadi. Server ishlayaptimi?");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error?.message ?? `So‘rov bajarilmadi (${res.status})`);
    err.code = data?.error?.code;
    throw err;
  }
  return data;
}

const JOB_LABEL = { interview: "intervyu", evaluation: "baholash" };
const LEVEL_LABEL = { easy: "oson", medium: "o‘rtacha", hard: "qiyin" };
const UNC_LABEL = { low: "past", medium: "o‘rtacha", high: "yuqori" };
const CRITERION_LABEL = {
  technical_correctness: "Texnik to‘g‘rilik",
  conceptual_understanding: "Tushunchalarni tushunish",
  problem_solving: "Muammoni yechish mantig‘i",
  explanation: "Texnik tushunchalarni tushuntirish",
  practical_knowledge: "Amaliy bilim",
};

// ───────── Speech ─────────

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
const SPEECH_LANG = { en: "en-US", ru: "ru-RU", uz: "uz-UZ" };
const SILENCE_MS = 1800;

function pickVoice(lang) {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const prefix = lang.split("-")[0];
  return voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang?.toLowerCase().startsWith(prefix)) ?? null;
}

// Voices load asynchronously in some browsers.
window.speechSynthesis?.addEventListener?.("voiceschanged", () => updateVoiceNote());

function updateVoiceNote() {
  const mode = $("mode").value;
  const lang = SPEECH_LANG[$("language").value];
  const notes = [];
  if (mode === "voice") {
    if (!SpeechRecognitionImpl) notes.push("Bu brauzerda nutqni aniqlash yo‘q. Ovozli javob uchun Chrome yoki Edge’dan foydalaning yoki matn rejimini tanlang.");
    else notes.push("Nutqni brauzeringiz aniqlaydi (Chrome’da ovoz Google serverlarida qayta ishlanadi). Intervyuerga faqat aniqlangan matn yuboriladi.");
    if (!window.speechSynthesis) notes.push("Bu brauzer savollarni ovoz chiqarib o‘qiy olmaydi, ular matn ko‘rinishida chiqadi.");
    else if (window.speechSynthesis.getVoices().length > 0 && !pickVoice(lang)) {
      notes.push(`Bu brauzerda ${lang} ovozi o‘rnatilmagan, shuning uchun savollar faqat matn ko‘rinishida chiqadi.`);
    }
  }
  $("voice-note").textContent = notes.join(" ");
}

// ───────── State ─────────

const state = {
  config: null,
  mode: "voice",
  transcript: [],
  startedAt: 0,
  timerId: null,
  busy: false,
  finished: false,
  recognition: null,
  listening: false,
  silenceTimer: null,
  finalText: "",
  stream: null,
  usage: [],
};

const elapsedSeconds = () => Math.floor((Date.now() - state.startedAt) / 1000);

function setOrb(mode, label) {
  const orb = $("ai-orb");
  orb.classList.remove("speaking", "thinking", "listening");
  if (mode) orb.classList.add(mode);
  $("ai-state").textContent = label;
}

function renderTranscript() {
  const list = $("transcript");
  list.replaceChildren(
    ...state.transcript.map((t) =>
      el("li", { class: `msg ${t.role}` }, [
        el("span", { class: "who", text: t.role === "interviewer" ? "Intervyuer" : "Siz" }),
        t.text,
        t.category ? el("div", { class: "meta", text: `${t.category} · ${LEVEL_LABEL[t.difficulty] ?? t.difficulty}` }) : null,
      ]),
    ),
  );
  list.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "end" });
}

function tickTimer() {
  const total = state.config.durationMinutes * 60;
  const left = total - elapsedSeconds();
  const abs = Math.abs(left);
  const text = `${left < 0 ? "+" : ""}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  const timer = $("timer");
  timer.textContent = text;
  timer.classList.toggle("low", left <= 90 && left > 0);
  timer.classList.toggle("over", left <= 0);
}

// ───────── Status ─────────

async function loadStatus() {
  const box = $("provider-status");
  try {
    const status = await api("/api/status");
    box.replaceChildren(
      ...["interview", "evaluation"].flatMap((job) =>
        status[job].map((p) =>
          el("span", {
            class: `pill ${p.configured ? "ok" : "bad"}`,
            title: p.configured ? "Tayyor" : `Yetishmayapti: ${p.missing.join(", ")}`,
            text: `${JOB_LABEL[job]}: ${p.name} ${p.configured ? "✓" : "✕"}`,
          }),
        ),
      ),
    );
    const interviewReady = status.interview.some((p) => p.configured);
    const evaluationReady = status.evaluation.some((p) => p.configured);
    if (!interviewReady) {
      const missing = status.interview.flatMap((p) => p.missing);
      showAlert("setup-alert", `AI intervyuer sozlanmagan. demo/.env fayliga ${missing.join(", ")} qo‘shing va serverni qayta ishga tushiring. Oflayn yoki soxta intervyuer yo‘q.`);
      $("start-btn").disabled = true;
    } else if (!evaluationReady) {
      showAlert("setup-alert", "Baholash provayderi sozlanmagan. Intervyuni o‘tkazish mumkin, lekin DEEPSEEK_* yoki GEMINI_* sozlamalari qo‘shilmaguncha yakuniy baholash ishlamaydi.", "info");
    }
  } catch (err) {
    showAlert("setup-alert", err.message);
    $("start-btn").disabled = true;
  }
}

// ───────── Setup ─────────

function readConfig() {
  const f = $("setup-form");
  const v = (name) => f.elements[name].value;
  return {
    position: v("position"),
    seniority: v("seniority"),
    programmingLanguage: v("programmingLanguage"),
    categories: v("categories").split(",").map((s) => s.trim()).filter(Boolean),
    durationMinutes: Number(v("durationMinutes")),
    difficulty: v("difficulty"),
    language: v("language"),
    rules: v("rules"),
  };
}

async function startCamera() {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    const video = $("self-video");
    video.srcObject = state.stream;
    video.classList.remove("hidden");
    $("self-placeholder").classList.add("hidden");
  } catch {
    $("self-placeholder").textContent = "Kamera mavjud emas";
  }
}

function stopCamera() {
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
}

$("setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const config = readConfig();
  if (config.categories.length === 0) return showAlert("setup-alert", "Kamida bitta texnik yo‘nalish kiriting.");
  showAlert("setup-alert", "");

  state.config = config;
  state.mode = $("mode").value === "voice" && SpeechRecognitionImpl ? "voice" : "text";
  state.transcript = [];
  state.finished = false;
  state.usage = [];

  $("screen-setup").classList.add("hidden");
  $("screen-room").classList.remove("hidden");
  $("room-title").textContent = `${config.seniority[0].toUpperCase()}${config.seniority.slice(1)} ${config.position}`;
  $("room-subtitle").textContent = `${config.programmingLanguage} · ${config.categories.join(", ")} · ${config.durationMinutes} min`;
  $("mic-btn").classList.toggle("hidden", state.mode !== "voice");
  $("autosend-wrap").classList.toggle("hidden", state.mode !== "voice");

  if ($("camera").checked) await startCamera();

  state.startedAt = Date.now();
  tickTimer();
  state.timerId = setInterval(tickTimer, 1000);
  await nextTurn();
});

["mode", "language"].forEach((id) => $(id).addEventListener("change", updateVoiceNote));

// ───────── Conversation ─────────

function setBusy(busy) {
  state.busy = busy;
  $("send-btn").disabled = busy || state.finished;
  $("mic-btn").disabled = busy || state.finished;
  $("answer").disabled = busy || state.finished;
}

async function nextTurn() {
  setBusy(true);
  setOrb("thinking", "Intervyuer o‘ylayapti…");
  showAlert("room-alert", "");
  try {
    const turn = await api("/api/interview/turn", {
      config: state.config,
      transcript: state.transcript,
      elapsedSeconds: elapsedSeconds(),
    });
    state.usage.push(turn.meta);
    state.transcript.push({ role: "interviewer", text: turn.message, category: turn.category, difficulty: turn.difficulty });
    renderTranscript();
    if (turn.interviewComplete) state.finished = true;
    await speak(turn.message);
    if (state.finished) {
      setOrb(null, "Intervyu tugadi");
      setBusy(true);
      return finishInterview();
    }
    setBusy(false);
    if (state.mode === "voice") startListening();
    else {
      setOrb(null, "Javobingizni yozing");
      $("answer").focus();
    }
  } catch (err) {
    setBusy(false);
    setOrb(null, "Xatolik yuz berdi");
    showAlert("room-alert", `${err.message} Javobni qayta yuborib urinib ko‘rishingiz yoki intervyuni tugatishingiz mumkin.`);
    const last = state.transcript[state.transcript.length - 1];
    if (state.transcript.length === 0) {
      // The first question failed to load; Send retries it.
      $("send-btn").textContent = "Qayta urinish";
    } else if (last?.role === "candidate" && !$("answer").value.trim()) {
      // Put the unanswered text back so Send retries with it (and it can be edited).
      $("answer").value = last.text;
    }
  }
}

function speak(text) {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const lang = SPEECH_LANG[state.config.language];
    const voice = pickVoice(lang);
    if (state.mode !== "voice" || !synth || !voice) return resolve();
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.voice = voice;
    u.rate = 1;
    u.onend = u.onerror = () => resolve();
    setOrb("speaking", "Intervyuer gapiryapti…");
    synth.speak(u);
  });
}

/** Barge-in: the candidate starts talking or typing while the interviewer is speaking. */
function interruptSpeech() {
  if (window.speechSynthesis?.speaking) window.speechSynthesis.cancel();
}

function startListening() {
  if (!SpeechRecognitionImpl || state.listening || state.busy || state.finished) return;
  interruptSpeech();
  const rec = new SpeechRecognitionImpl();
  rec.lang = SPEECH_LANG[state.config.language];
  rec.continuous = true;
  rec.interimResults = true;
  state.finalText = $("answer").value.trim() ? `${$("answer").value.trim()} ` : "";

  rec.onresult = (event) => {
    // Results can still arrive after stop(); ignore them once this session was ended.
    if (state.recognition !== rec) return;
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) state.finalText += `${r[0].transcript.trim()} `;
      else interim += r[0].transcript;
    }
    $("answer").value = (state.finalText + interim).trim();
    // Turn detection: send after a pause once we have some final text.
    clearTimeout(state.silenceTimer);
    if ($("autosend").checked && state.finalText.trim()) {
      state.silenceTimer = setTimeout(() => submitAnswer(), SILENCE_MS);
    }
  };
  rec.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      showAlert("room-alert", "Mikrofonga ruxsat berilmagan. Brauzerda ruxsat bering yoki javobni yozing.");
    } else if (event.error !== "no-speech" && event.error !== "aborted") {
      showAlert("room-alert", `Nutqni aniqlashda xato: ${event.error}. Javobni yozib yuborishingiz mumkin.`);
    }
  };
  rec.onend = () => {
    if (state.recognition === rec) state.recognition = null;
    state.listening = false;
    $("mic-btn").classList.remove("live");
    $("mic-btn").textContent = "🎙 Gapirish";
    if (!state.busy && !state.finished) setOrb(null, "Javob berish uchun «Gapirish»ni bosing yoki yozing");
  };
  try {
    rec.start();
  } catch {
    return;
  }
  state.recognition = rec;
  state.listening = true;
  $("mic-btn").classList.add("live");
  $("mic-btn").textContent = "■ To‘xtatish";
  setOrb("listening", "Tinglayapman… tayyor bo‘lsangiz javob bering");
}

function stopListening() {
  clearTimeout(state.silenceTimer);
  const rec = state.recognition;
  state.recognition = null;
  state.listening = false;
  rec?.stop();
}

async function submitAnswer() {
  if (state.busy || state.finished) return;
  stopListening();
  interruptSpeech();
  const text = $("answer").value.trim();

  // Retry path when the first question failed to load.
  if (state.transcript.length === 0) {
    $("send-btn").textContent = "Javobni yuborish";
    return nextTurn();
  }
  if (!text) return showAlert("room-alert", "Javob bo‘sh. Avval gapiring yoki yozing.");
  if (state.transcript[state.transcript.length - 1]?.role !== "candidate") {
    state.transcript.push({ role: "candidate", text });
  } else {
    // A previous send failed after the answer was recorded; replace it with the edited text.
    state.transcript[state.transcript.length - 1].text = text;
  }
  $("answer").value = "";
  state.finalText = "";
  renderTranscript();
  await nextTurn();
}

$("send-btn").addEventListener("click", submitAnswer);
$("mic-btn").addEventListener("click", () => (state.listening ? stopListening() : startListening()));
$("answer").addEventListener("input", interruptSpeech);
$("answer").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitAnswer();
});
$("end-btn").addEventListener("click", () => {
  if (state.busy && !state.finished) return;
  state.finished = true;
  finishInterview();
});

// ───────── Evaluation & report ─────────

async function finishInterview() {
  stopListening();
  interruptSpeech();
  clearInterval(state.timerId);
  stopCamera();
  $("screen-room").classList.add("hidden");
  $("screen-report").classList.remove("hidden");
  $("report-loading").classList.remove("hidden");
  $("report").classList.add("hidden");
  showAlert("report-alert", "");

  // A trailing unanswered question stays in the transcript; the evaluator scores candidate lines only.
  try {
    const result = await api("/api/interview/evaluate", { config: state.config, transcript: state.transcript });
    renderReport(result);
  } catch (err) {
    $("report-loading").classList.add("hidden");
    showAlert("report-alert", `Baholash bajarilmadi: ${err.message}`);
    $("report").classList.remove("hidden");
    $("report").replaceChildren(
      el("div", { class: "report-actions" }, [
        el("button", { class: "btn btn-primary", text: "Baholashni qayta urinish", onclick: () => finishInterview() }),
        el("button", { class: "btn btn-ghost", text: "Yangi intervyu", onclick: () => location.reload() }),
      ]),
    );
  }
}

const REC_LABEL = {
  strong_hire: ["Albatta ishga olish", "ok"],
  hire: ["Ishga olish", "ok"],
  no_hire: ["Ishga olmaslik", "bad"],
  strong_no_hire: ["Albatta ishga olmaslik", "bad"],
  needs_more_assessment: ["Qo‘shimcha baholash kerak", "warn"],
};
const UNC_TONE = { low: "ok", medium: "warn", high: "bad" };

function renderReport(result) {
  $("report-loading").classList.add("hidden");
  const root = $("report");
  root.classList.remove("hidden");
  const ev = result.evaluation;
  const review = { notes: "", decision: "", overrides: {} };

  const qaSection = el("section", { class: "card section" }, [
    el("h3", { text: "Savollar va javoblar" }),
    ...result.questionsAndAnswers.map((qa, n) =>
      el("div", { class: "qa" }, [
        el("p", { class: "q", text: `${n + 1}-savol. ${qa.question}` }),
        qa.category ? el("p", { class: "muted small", text: `${qa.category} · ${LEVEL_LABEL[qa.difficulty] ?? qa.difficulty}` }) : null,
        ...(qa.answers.length ? qa.answers.map((a) => el("p", { text: a.text })) : [el("p", { class: "muted", text: "Javob berilmagan" })]),
      ]),
    ),
  ]);

  if (!ev) {
    root.replaceChildren(
      el("div", { class: "report" }, [
        el("div", { class: "alert info", text: result.reason }),
        qaSection,
        el("div", { class: "report-actions" }, [el("button", { class: "btn btn-primary", text: "Yangi intervyu", onclick: () => location.reload() })]),
      ]),
    );
    return;
  }

  const [recText, recTone] = REC_LABEL[ev.recommendation] ?? [ev.recommendation, ""];
  // Checks added by the server's evidence verification, rendered in the UI language.
  const uncertaintyItems = [
    ...ev.uncertainty.reasons,
    ...(ev.uncertainty.checks ?? []).map((c) =>
      c.code === "missing_evidence"
        ? `Tasdiqlanadigan dalil topilmadi: ${c.criteria.map((k) => CRITERION_LABEL[k] ?? k).join(", ")}.`
        : `${c.count} ta iqtibos suhbat matniga mos kelmadi va olib tashlandi.`,
    ),
  ];
  const quoteFor = (idx) => result.questionsAndAnswers.findIndex((qa) => qa.answers.some((a) => a.answerIndex === idx));

  const criteria = ev.criteria.map((c) => {
    const bar = el("span");
    bar.style.width = `${c.score * 10}%`;
    const overrideInput = el("input", { type: "number", min: 0, max: 10, step: 0.5, placeholder: String(c.score), "aria-label": `${CRITERION_LABEL[c.key] ?? c.label} uchun tekshiruvchi bahosi` });
    overrideInput.addEventListener("input", () => {
      const v = overrideInput.value === "" ? undefined : Math.min(10, Math.max(0, Number(overrideInput.value)));
      if (v === undefined || Number.isNaN(v)) delete review.overrides[c.key];
      else review.overrides[c.key] = v;
      updateReviewedScore();
    });
    return el("div", { class: "criterion" }, [
      el("div", { class: "criterion-head" }, [
        el("strong", { text: CRITERION_LABEL[c.key] ?? c.label }),
        el("span", {}, [c.evidenceMissing ? el("span", { class: "badge warn", text: "Tasdiqlangan dalil yo‘q" }) : null, el("span", { class: "badge", text: `${c.score} / 10` })]),
      ]),
      el("div", { class: "bar" }, [bar]),
      c.rationale ? el("p", { class: "small", text: c.rationale }) : null,
      ...c.evidence.map((e) => el("p", { class: "quote", text: `“${e.quote}” — ${quoteFor(e.answerIndex) + 1}-savolga javobdan` })),
      el("label", { class: "override" }, ["Tekshiruvchi bahosi:", overrideInput]),
    ]);
  });

  const reviewedScore = el("p", { class: "small muted" });
  function updateReviewedScore() {
    const keys = Object.keys(review.overrides);
    if (keys.length === 0) return (reviewedScore.textContent = "");
    const total = ev.criteria.reduce((s, c) => s + (review.overrides[c.key] ?? c.score) * 10 * c.weight, 0);
    reviewedScore.textContent = `Tekshiruvchi tuzatishlari bilan ball: ${Math.round(total)} / 100`;
  }

  const notes = el("textarea", { rows: 4, placeholder: "Tekshiruvchi izohlari (faqat shu brauzerda saqlanadi)" });
  notes.addEventListener("input", () => (review.notes = notes.value));
  const decision = el("select", {}, [
    el("option", { value: "", text: "Yakuniy qaror: hali qabul qilinmagan" }),
    ...Object.entries(REC_LABEL).map(([k, [label]]) => el("option", { value: k, text: label })),
  ]);
  decision.addEventListener("change", () => (review.decision = decision.value));

  const download = () => {
    const report = { ...result, humanReview: { ...review, reviewedAt: new Date().toISOString() }, aiUsage: state.usage };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `interview-report-${Date.now()}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  root.replaceChildren(
    el("div", { class: "report" }, [
      el("div", { class: "alert info", text: "Bu AI tayyorlagan qoralama. Ishga olish bo‘yicha qaror qabul qilishdan oldin uni inson tekshirib, tasdiqlashi yoki tuzatishi kerak." }),
      el("section", { class: "card report-head" }, [
        el("div", { class: "score-ring" }, [el("div", {}, [String(ev.overallScore), el("small", { text: "100 dan" })])]),
        el("div", {}, [
          el("h2", { text: `${state.config.position} · ${state.config.seniority}` }),
          el("p", { class: "small muted", text: `${state.config.programmingLanguage} · ${state.config.categories.join(", ")}` }),
          el("p", {}, [
            el("span", { class: `badge ${recTone}`, text: recText }),
            el("span", { class: `badge ${UNC_TONE[ev.uncertainty.level]}`, text: `Noaniqlik: ${UNC_LABEL[ev.uncertainty.level]}` }),
          ]),
          el("p", { class: "small", text: ev.summary }),
          el("p", { class: "small muted", text: `Baholagan: ${result.meta.provider} (${result.meta.model})${result.meta.fallbackFrom ? `, ${result.meta.fallbackFrom} ishlamagani uchun` : ""}` }),
        ]),
      ]),
      el("section", { class: "card section" }, [el("h3", { text: "Baholash tafsilotlari" }), ...criteria, reviewedScore]),
      el("div", { class: "grid-2" }, [
        el("section", { class: "card section" }, [el("h3", { text: "Kuchli tomonlar" }), el("ul", { class: "plain" }, ev.strengths.length ? ev.strengths.map((s) => el("li", { text: s })) : [el("li", { class: "muted", text: "Aniqlanmadi" })])]),
        el("section", { class: "card section" }, [el("h3", { text: "Qo‘shimcha tekshirish kerak bo‘lgan sohalar" }), el("ul", { class: "plain" }, ev.areasForFurtherAssessment.length ? ev.areasForFurtherAssessment.map((s) => el("li", { text: s })) : [el("li", { class: "muted", text: "Aniqlanmadi" })])]),
      ]),
      el("section", { class: "card section" }, [
        el("h3", { text: "Baholash noaniqligi" }),
        el("ul", { class: "plain" }, uncertaintyItems.length ? uncertaintyItems.map((r) => el("li", { text: r })) : [el("li", { class: "muted", text: "Sabab ko‘rsatilmagan" })]),
      ]),
      qaSection,
      el("section", { class: "card section" }, [el("h3", { text: "Inson tekshiruvi" }), el("div", { class: "composer" }, [decision, notes])]),
      el("div", { class: "report-actions" }, [
        el("button", { class: "btn btn-secondary", text: "Hisobotni yuklab olish (JSON)", onclick: download }),
        el("button", { class: "btn btn-primary", text: "Yangi intervyu", onclick: () => location.reload() }),
      ]),
    ]),
  );
}

updateVoiceNote();
loadStatus();
