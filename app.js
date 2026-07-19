/* Life in the UK study app — no dependencies, data injected via data.js (window.STUDY_DATA) */
(function () {
  "use strict";

  const DATA = window.STUDY_DATA || [];
  const LS_KEY = "liuk-progress-v1";

  // ---------- state ----------
  let store = loadStore();
  let deck = [];          // filtered+ordered card list
  let deckPos = 0;
  let current = null;     // { card, options: [{text, correct}], answered: index|null }
  let sessionRight = 0, sessionWrong = 0;
  let activeChapters = new Set(DATA.map(c => c.chapter));

  function loadStore() {
    let s;
    try { s = JSON.parse(localStorage.getItem(LS_KEY)) || {}; }
    catch { s = {}; }
    // migrate old flip-card marks ("know"/"learning") to quiz records
    const cards = {};
    for (const [id, v] of Object.entries(s.cards || {})) {
      if (v === "know") cards[id] = { c: 1, w: 0, last: "c" };
      else if (v === "learning") cards[id] = { c: 0, w: 1, last: "w" };
      else if (v && typeof v === "object") cards[id] = v;
    }
    return { cards, checks: s.checks || {} };
  }
  function saveStore() { localStorage.setItem(LS_KEY, JSON.stringify(store)); }

  // Stable card id: chapter + section + question hash
  function cardId(card) {
    let h = 0;
    const s = card.section + "|" + card.q;
    for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return "c" + (h >>> 0).toString(36);
  }

  const ALL_CARDS = [];
  DATA.forEach(ch => (ch.flashcards || []).forEach(c => {
    c._id = cardId(c);
    c._chapter = ch.chapter;
    c._chapterTitle = ch.title;
    ALL_CARDS.push(c);
  }));

  // ---------- tiny markdown renderer (bold, italics, headings, bullets) ----------
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function inlineMd(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  }
  function md(text) {
    const lines = (text || "").split(/\r?\n/);
    let html = "", inList = false;
    for (const raw of lines) {
      const line = raw.trimEnd();
      const bullet = line.match(/^\s*[-*•]\s+(.*)/);
      const heading = line.match(/^(#{1,4})\s+(.*)/);
      if (bullet) {
        if (!inList) { html += "<ul>"; inList = true; }
        html += "<li>" + inlineMd(bullet[1]) + "</li>";
      } else {
        if (inList) { html += "</ul>"; inList = false; }
        if (heading) {
          const lvl = Math.min(heading[1].length + 2, 5);
          html += `<h${lvl}>` + inlineMd(heading[2]) + `</h${lvl}>`;
        } else if (line.trim()) {
          html += "<p>" + inlineMd(line) + "</p>";
        }
      }
    }
    if (inList) html += "</ul>";
    return html;
  }

  // ---------- tabs ----------
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "stats") renderStats();
    });
  });

  // ---------- summaries ----------
  function renderSummaryNav() {
    const nav = document.getElementById("summary-nav");
    nav.innerHTML = "";
    DATA.forEach(ch => {
      const t = document.createElement("div");
      t.className = "chap-title";
      t.textContent = (ch.chapter <= 5 ? "Ch " + ch.chapter + ": " : "") + ch.title;
      nav.appendChild(t);
      (ch.sections || []).forEach(sec => {
        const b = document.createElement("button");
        b.textContent = sec.id + " " + sec.title;
        b.addEventListener("click", () => {
          nav.querySelectorAll("button").forEach(x => x.classList.remove("active"));
          b.classList.add("active");
          renderSection(ch, sec);
        });
        nav.appendChild(b);
      });
    });
  }

  function renderSection(ch, sec) {
    const el = document.getElementById("summary-content");
    let html = `<h2>${esc(sec.id)} ${esc(sec.title)}</h2>`;
    html += md(sec.summary);
    if (sec.checkUnderstand && sec.checkUnderstand.length) {
      html += `<div class="check-box"><h4>✅ Check that you understand</h4><ul>` +
        sec.checkUnderstand.map(x => "<li>" + inlineMd(x) + "</li>").join("") +
        `</ul></div>`;
    }
    const nCards = ALL_CARDS.filter(c => c.section === sec.id).length;
    if (nCards) html += `<p class="page-ref">${nCards} questions cover this section — practice them in the Quiz tab.</p>`;
    el.innerHTML = html;
    if (el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- flashcards ----------
  function renderChapterFilters() {
    const wrap = document.getElementById("chapter-filters");
    wrap.innerHTML = "";
    const allBtn = document.createElement("button");
    allBtn.className = "chip active";
    allBtn.textContent = "All chapters";
    allBtn.addEventListener("click", () => {
      activeChapters = new Set(DATA.map(c => c.chapter));
      wrap.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
      allBtn.classList.add("active");
      rebuildDeck();
    });
    wrap.appendChild(allBtn);
    DATA.forEach(ch => {
      const b = document.createElement("button");
      b.className = "chip";
      b.textContent = ch.chapter <= 5 ? "Ch " + ch.chapter : "⭐ Key facts";
      b.title = ch.title;
      b.addEventListener("click", () => {
        // single-chapter select via chip; toggle behavior with multiple active
        if (allBtn.classList.contains("active")) {
          allBtn.classList.remove("active");
          activeChapters = new Set();
        }
        if (b.classList.toggle("active")) activeChapters.add(ch.chapter);
        else activeChapters.delete(ch.chapter);
        if (activeChapters.size === 0) {
          activeChapters = new Set(DATA.map(c => c.chapter));
          allBtn.classList.add("active");
        }
        rebuildDeck();
      });
      wrap.appendChild(b);
    });
  }

  function rebuildDeck(keepOrder) {
    const onlyWrong = document.getElementById("only-wrong").checked;
    deck = ALL_CARDS.filter(c => activeChapters.has(c._chapter));
    if (onlyWrong) deck = deck.filter(c => (store.cards[c._id] || {}).last === "w");
    if (!keepOrder) shuffle(deck);
    deckPos = 0;
    sessionRight = 0;
    sessionWrong = 0;
    presentCard();
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  // ----- MCQ option generation -----
  // Distractor styles modelled on the real Life in the UK test:
  //  - date questions use nearby years clustered around the true date
  //  - number questions use plausible alternative values, same units
  //  - yes/no questions become two-option true/false style
  //  - everything else samples same-category answers from other cards
  function normAns(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

  // Nearby years, mixing close misses with wider ones (the real test shows
  // e.g. 1388 / 1455 / 1462 / 1478). Never in the future for past events.
  function yearAlternatives(y, count) {
    const out = new Set();
    let guard = 0;
    while (out.size < count && guard++ < 300) {
      const offsets = [randInt(1, 4), randInt(5, 15), randInt(20, 70), 10 * randInt(1, 9)];
      let cand = y + (Math.random() < 0.5 ? -1 : 1) * offsets[randInt(0, 3)];
      if (cand > 2025 && y <= 2025) cand = y - (cand - y);
      if (cand > 0 && cand !== y) out.add(cand);
    }
    return [...out];
  }

  function decadeAlternatives(y, count) {
    const out = new Set();
    let guard = 0;
    while (out.size < count && guard++ < 300) {
      let cand = y + (Math.random() < 0.5 ? -1 : 1) * 10 * randInt(1, 7);
      if (cand > 2020 && y <= 2020) cand = y - (cand - y);
      if (cand > 0 && cand !== y) out.add(cand);
    }
    return [...out];
  }

  function numberAlternatives(n, count) {
    if (n >= 1000 && n <= 2029) return yearAlternatives(n, count);
    const out = new Set();
    let guard = 0;
    while (out.size < count && guard++ < 300) {
      let cand;
      if (n <= 12) {
        cand = n + (Math.random() < 0.5 ? -1 : 1) * randInt(1, 4);
      } else {
        const deltas = [randInt(1, 3), Math.round(n * 0.1), Math.round(n * 0.25), Math.round(n * 0.5)].filter(d => d > 0);
        cand = n + (Math.random() < 0.5 ? -1 : 1) * deltas[randInt(0, deltas.length - 1)];
      }
      if (cand > 0 && cand !== n) out.add(cand);
    }
    return [...out];
  }

  function formatLike(origStr, n) {
    return /\d,\d/.test(origStr) ? n.toLocaleString("en-US") : String(n);
  }

  function firstNumber(s) {
    const m = s.match(/\d[\d,]*/);
    return m ? parseInt(m[0].replace(/,/g, ""), 10) : NaN;
  }

  // "Who" answers are either a named individual ("Dylan Thomas, a Welsh
  // poet…") or a group ("Knights and wealthy people…"). Mixing the two
  // makes the odd shape a giveaway, so distractors must match.
  function whoShape(s) {
    const t = s.trim();
    if (/^(sir|dame|lord|lady|st\.?|saint|king|queen|prince|princess|admiral|general|dr)\b/i.test(t)) return "single";
    // Look for a plural noun in the opening words ("Protestant refugees…").
    // Capitalised words mid-sentence are proper nouns ("Her cousin James VI"),
    // and a leading name pair ("James Goodfellow") is skipped too — unless a
    // lowercase plural follows it ("French Protestant refugees").
    const notPlural = new Set(["was", "is", "his", "this", "its", "as", "has", "across", "perhaps", "whilst", "against", "various", "famous", "religious", "numerous", "previous", "times"]);
    const isPlural = w => {
      const x = w.toLowerCase().replace(/[^a-z']/g, "");
      return /^(people|women|men|children)$/.test(x) ||
        (x.length > 3 && x.endsWith("s") && !x.endsWith("ss") && !notPlural.has(x));
    };
    const capcap = /^[A-Z][a-z]*\.?\s+(?:[A-Z]|d'|O')/.test(t);
    const tokens = t.replace(/^the\s+/i, "").split(/[\s,;—()]+/).slice(0, 4);
    for (let i = 0; i < tokens.length; i++) {
      if (/^[A-Z0-9]/.test(tokens[i]) && (i > 0 || capcap)) continue;
      if (isPlural(tokens[i])) return "group";
    }
    return "single";
  }

  // Interrogative category of a question — used to match distractor shape
  function qWord(q) {
    const s = q.trim().toLowerCase();
    if (/^(when\b|in (what|which) year|what year|for how long|how long|how many|how much|how old|what percentage|what proportion)/.test(s)) {
      return /^when\b|year/.test(s.slice(0, 16)) ? "when" : "amount";
    }
    if (/^who\b/.test(s)) return "who";
    if (/^where\b/.test(s)) return "where";
    return null;
  }

  function buildOptions(card) {
    const a = card.a.trim();

    // Yes/no → true/false style, full answer becomes the explanation
    const yn = a.match(/^(yes|no)\b/i);
    if (yn) {
      const isYes = yn[1].toLowerCase() === "yes";
      const bare = normAns(a) === (isYes ? "yes" : "no");
      return {
        options: [{ text: "Yes", correct: isYes }, { text: "No", correct: !isYes }],
        explanation: bare ? null : a
      };
    }

    // Date followed by an explanation ("From 1979 to 1990 — the longest-serving…"):
    // options are the date part with shifted years; full answer shown after
    let m = a.match(/^((?:from|in|around|about|c\.)?\s*\d{3,4}(?:\s*(?:to|until|[–—-])\s*\d{2,4})?)\s*[—–]\s*.+$/i);
    if (m) {
      const lead = m[1].trim();
      const base = firstNumber(lead);
      const opts = [{ text: lead, correct: true }];
      yearAlternatives(base, 3).forEach(y2 => {
        const d = y2 - base;
        opts.push({ text: lead.replace(/\d{2,4}/g, s => String(+s + d)), correct: false });
      });
      opts.sort((x, y) => firstNumber(x.text) - firstNumber(y.text));
      return { options: opts, explanation: a };
    }

    // Year range ("1455–1485"): shift the whole range, keep the span
    m = a.match(/^(\d{3,4})(\s*[–-]\s*)(\d{2,4})(\.?)$/);
    if (m) {
      const start = +m[1];
      const endFull = m[3].length < 3 ? +m[1].slice(0, m[1].length - m[3].length) * Math.pow(10, m[3].length) + +m[3] : +m[3];
      const span = endFull - start;
      const opts = [{ text: a, correct: true }];
      yearAlternatives(start, 3).forEach(s2 => {
        const e2 = s2 + span;
        const suffix = m[3].length < 3 && String(e2).length === String(s2).length && String(e2).slice(0, -m[3].length) === String(s2).slice(0, -m[3].length)
          ? String(e2).slice(-m[3].length) : String(e2);
        opts.push({ text: s2 + m[2] + suffix + m[4], correct: false });
      });
      opts.sort((x, y) => firstNumber(x.text) - firstNumber(y.text));
      return { options: opts, explanation: null };
    }

    // Short answer containing exactly one number: perturb it in place,
    // keeping the surrounding words ("Every 5 years" → "Every 3 years")
    const nums = a.length <= 45 ? a.match(/\d+(?:,\d{3})*/g) : null;
    if (nums && nums.length === 1) {
      const numStr = nums[0];
      const n = parseInt(numStr.replace(/,/g, ""), 10);
      const idx = a.indexOf(numStr);
      const after = a.slice(idx + numStr.length);
      const isDecade = after[0] === "s";
      const ordSuffix = (after.match(/^(st|nd|rd|th)\b/) || [])[1];
      const alts = isDecade ? decadeAlternatives(n, 3) : numberAlternatives(n, 3);
      const opts = [{ text: a, correct: true }];
      alts.forEach(v => {
        const text = ordSuffix
          ? a.replace(numStr + ordSuffix, ordinal(v))
          : a.replace(numStr, formatLike(numStr, v));
        opts.push({ text, correct: false });
      });
      opts.sort((x, y) => firstNumber(x.text) - firstNumber(y.text));
      return { options: opts, explanation: null };
    }

    const qt = qWord(card.q);

    // Amount answers written as words ("Three times. He is a Scottish…"):
    // perturb the word-number, trim to the first clause, explain after
    const WORD_NUMS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
    m = qt === "amount" ? a.match(/^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i) : null;
    if (m) {
      const n = WORD_NUMS.indexOf(m[1].toLowerCase()) + 1;
      const lead = a.match(/^[^,.;—]+/)[0].trim();
      const cap = w => w[0].toUpperCase() + w.slice(1);
      // "One times"/"One Oscars" is ungrammatical — floor at 2 before a plural
      const nextWord = (lead.slice(m[1].length).trim().match(/^\w+/) || [""])[0];
      const minVal = /s$/i.test(nextWord) ? 2 : 1;
      const opts = [{ text: lead + ".", correct: true, v: n }];
      const seen = new Set([n]);
      let guard = 0;
      while (opts.length < 4 && guard++ < 100) {
        const n2 = Math.min(12, Math.max(minVal, n + (Math.random() < 0.5 ? -1 : 1) * randInt(1, 4)));
        if (seen.has(n2)) continue;
        seen.add(n2);
        opts.push({ text: lead.replace(m[1], cap(WORD_NUMS[n2 - 1])) + ".", correct: false, v: n2 });
      }
      opts.sort((x, y) => x.v - y.v);
      return { options: opts, explanation: lead.length + 1 < a.length ? a : null };
    }

    // Corpus sampling: same-category answers from other cards, preferring
    // shared tags, same section/chapter, similar length and — crucially —
    // the same question shape (a "when/how many" question whose answer has
    // numbers only gets distractors containing numbers; "who" prefers
    // other "who" answers)
    const correctNorm = normAns(a);
    const tags = new Set(card.tags || []);
    const needsDigit = (qt === "when" || qt === "amount") && /\d/.test(a);
    const whoNeed = qt === "who" ? whoShape(a) : null;
    const collect = strict => {
      const list = [];
      for (const c of ALL_CARDS) {
        if (c === card) continue;
        const norm = normAns(c.a);
        if (norm === correctNorm) continue;
        if (strict && needsDigit && !/\d/.test(c.a)) continue;
        if (strict && whoNeed && whoShape(c.a) !== whoNeed) continue;
        let score = 0;
        (c.tags || []).forEach(t => { if (tags.has(t)) score += 2; });
        if (c.section === card.section) score += 2;
        else if (c._chapter === card._chapter) score += 1;
        if (qt && qWord(c.q) === qt) score += 3;
        const ratio = c.a.length / Math.max(a.length, 1);
        if (ratio > 0.45 && ratio < 2.2) score += 1.5;
        if (ratio > 0.7 && ratio < 1.4) score += 1;
        list.push({ c, norm, score: score + Math.random() * 2 });
      }
      return list;
    };
    let cands = collect(true);
    if (cands.length < 6) cands = collect(false);
    cands.sort((x, y) => y.score - x.score);
    const opts = [{ text: card.a, correct: true }];
    const used = new Set([correctNorm]);
    for (const k of cands) {
      if (opts.length >= 4) break;
      if (used.has(k.norm)) continue;
      used.add(k.norm);
      opts.push({ text: k.c.a, correct: false });
    }
    shuffle(opts);
    return { options: opts, explanation: null };
  }

  function presentCard() {
    if (!deck.length) { current = null; renderQuiz(); return; }
    const card = deck[deckPos];
    const built = buildOptions(card);
    current = { card, options: built.options, explanation: built.explanation, answered: null };
    renderQuiz();
  }

  function renderQuiz() {
    const qEl = document.getElementById("quiz-question");
    const optsEl = document.getElementById("quiz-options");
    const fbEl = document.getElementById("quiz-feedback");
    const meta = document.getElementById("card-meta");
    const prog = document.getElementById("card-progress");
    const cardEl = document.getElementById("quiz-card");

    if (!current) {
      qEl.innerHTML = `🎉 No questions match this filter — nothing here is marked wrong. Untick “only questions I got wrong” or pick another chapter.`;
      optsEl.innerHTML = "";
      fbEl.classList.add("hidden");
      meta.textContent = "";
      prog.textContent = "0 questions";
      cardEl.classList.remove("right", "wrong");
      return;
    }

    const card = current.card;
    const rec = store.cards[card._id];
    const hist = rec ? ` · overall ✓${rec.c || 0} ✗${rec.w || 0}` : "";
    const session = (sessionRight + sessionWrong) ? ` · this round ✓${sessionRight} ✗${sessionWrong}` : "";
    prog.textContent = `Question ${deckPos + 1} of ${deck.length}${session}${hist}`;

    qEl.innerHTML = inlineMd(card.q);
    optsEl.innerHTML = "";
    const answered = current.answered !== null;
    current.options.forEach((opt, i) => {
      const b = document.createElement("button");
      b.className = "quiz-opt";
      b.innerHTML = `<span class="key">${"ABCD"[i]}</span><span>${inlineMd(opt.text)}</span>`;
      if (answered) {
        b.disabled = true;
        if (opt.correct) b.classList.add("correct");
        else if (i === current.answered) b.classList.add("wrong");
        else b.classList.add("dim");
      } else {
        b.addEventListener("click", () => answer(i));
      }
      optsEl.appendChild(b);
    });

    const expEl = document.getElementById("quiz-explain");
    if (answered) {
      const gotIt = current.options[current.answered].correct;
      fbEl.textContent = gotIt ? "✓ Correct!" : "✗ Not quite — the correct answer is highlighted.";
      fbEl.className = gotIt ? "good" : "bad";
      cardEl.classList.toggle("right", gotIt);
      cardEl.classList.toggle("wrong", !gotIt);
      if (current.explanation) {
        expEl.innerHTML = inlineMd(current.explanation);
        expEl.classList.remove("hidden");
      } else {
        expEl.classList.add("hidden");
      }
    } else {
      fbEl.className = "hidden";
      expEl.classList.add("hidden");
      cardEl.classList.remove("right", "wrong");
    }

    meta.textContent = `Ch ${card._chapter} · §${card.section} · p.${card.page}` + (card.tags && card.tags.length ? " · " + card.tags.join(", ") : "");
    document.getElementById("next-btn").textContent = answered ? "Next → (Enter)" : "Skip →";
  }

  function answer(i) {
    if (!current || current.answered !== null) return;
    current.answered = i;
    const gotIt = current.options[i].correct;
    const rec = store.cards[current.card._id] || { c: 0, w: 0, last: null };
    if (gotIt) { rec.c = (rec.c || 0) + 1; rec.last = "c"; sessionRight++; }
    else { rec.w = (rec.w || 0) + 1; rec.last = "w"; sessionWrong++; }
    store.cards[current.card._id] = rec;
    saveStore();
    renderQuiz();
  }

  function next() {
    if (!deck.length) return;
    const onlyWrong = document.getElementById("only-wrong").checked;
    const cur = deck[deckPos];
    // in drill mode, a question answered correctly leaves the deck
    if (onlyWrong && current && current.answered !== null && (store.cards[cur._id] || {}).last === "c") {
      deck.splice(deckPos, 1);
      if (!deck.length) { current = null; renderQuiz(); return; }
      if (deckPos >= deck.length) deckPos = 0;
    } else {
      deckPos = (deckPos + 1) % deck.length;
    }
    presentCard();
  }
  function prev() {
    if (!deck.length) return;
    deckPos = (deckPos - 1 + deck.length) % deck.length;
    presentCard();
  }

  document.getElementById("next-btn").addEventListener("click", next);
  document.getElementById("prev-btn").addEventListener("click", prev);
  document.getElementById("shuffle-btn").addEventListener("click", () => rebuildDeck());
  document.getElementById("only-wrong").addEventListener("change", () => rebuildDeck());
  document.getElementById("reset-deck-btn").addEventListener("click", () => {
    if (!confirm("Clear right/wrong history for all questions in the selected chapters?")) return;
    ALL_CARDS.filter(c => activeChapters.has(c._chapter)).forEach(c => delete store.cards[c._id]);
    saveStore();
    rebuildDeck(true);
  });

  document.addEventListener("keydown", e => {
    if (!document.getElementById("tab-cards").classList.contains("active")) return;
    if (e.target.tagName === "INPUT") return;
    const answered = current && current.answered !== null;
    if (/^[1-4]$/.test(e.key) && current && !answered) {
      const i = +e.key - 1;
      if (i < current.options.length) answer(i);
    }
    else if (e.key === "Enter" || e.code === "Space") { if (answered) { e.preventDefault(); next(); } }
    else if (e.key === "ArrowRight") next();
    else if (e.key === "ArrowLeft") prev();
  });

  // ---------- checklists ----------
  function renderChecklists() {
    const wrap = document.getElementById("checklist-content");
    wrap.innerHTML = "";
    DATA.forEach(ch => {
      (ch.sections || []).forEach(sec => {
        if (!sec.checkUnderstand || !sec.checkUnderstand.length) return;
        const g = document.createElement("div");
        g.className = "check-group";
        g.innerHTML = `<h3>Ch ${ch.chapter} · ${esc(sec.id)} ${esc(sec.title)}</h3>`;
        sec.checkUnderstand.forEach((item, i) => {
          const key = "k" + ch.chapter + "|" + sec.id + "|" + i;
          const label = document.createElement("label");
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = !!store.checks[key];
          if (cb.checked) label.classList.add("done");
          cb.addEventListener("change", () => {
            store.checks[key] = cb.checked;
            label.classList.toggle("done", cb.checked);
            saveStore();
          });
          const span = document.createElement("span");
          span.innerHTML = inlineMd(item);
          label.appendChild(cb);
          label.appendChild(span);
          g.appendChild(label);
        });
        wrap.appendChild(g);
      });
    });
  }

  // ---------- timeline ----------
  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // Pull every date mention out of a card's text. Bare 3-digit numbers are
  // skipped (feet, miles, "999") — small years must carry an explicit AD/BC.
  function extractDates(text) {
    const found = new Map(); // label -> sort key
    const add = (key, label) => { if (!found.has(label)) found.set(label, key); };
    let m;
    const bc = /\b(\d{1,4})\s*BC\b/g;
    while ((m = bc.exec(text))) add(-m[1], m[1] + " BC");
    const adPrefix = /\bAD\s*(\d{1,4})\b/g;
    while ((m = adPrefix.exec(text))) add(+m[1], "AD " + m[1]);
    const adSuffix = /\b(?:(\d{1,4})[–-])?(\d{1,4})\s*AD\b/g;
    while ((m = adSuffix.exec(text))) {
      if (m[1]) add(+m[1], "AD " + m[1]);
      add(+m[2], "AD " + m[2]);
    }
    const year = /\b(1[0-9]{3}|20[0-2][0-9])\b/g;
    while ((m = year.exec(text))) add(+m[1], m[1]);
    const decade = /\b([12]\d{2}0)s\b/g;
    while ((m = decade.exec(text))) add(+m[1] + 0.4, m[1] + "s");
    const century = /\b(\d{1,2})(?:st|nd|rd|th)(?=(?:\s+and\s+\d{1,2}(?:st|nd|rd|th))?[- ]centur)/gi;
    while ((m = century.exec(text))) add((m[1] - 1) * 100 + 0.6, ordinal(+m[1]) + " century");
    return found;
  }

  const TIMELINE = (() => {
    const groups = new Map(); // label -> {key, label, events}
    ALL_CARDS.forEach(card => {
      extractDates(card.q + " " + card.a).forEach((key, label) => {
        let g = groups.get(label);
        if (!g) groups.set(label, g = { key, label, events: [] });
        g.events.push(card);
      });
    });
    return [...groups.values()].sort((a, b) => a.key - b.key);
  })();

  function eraOf(key) {
    if (key < 0) return "Before AD 1";
    if (key < 1000) return "AD 1–999";
    return Math.floor(key / 100) * 100 + "s";
  }

  function renderTimeline() {
    const wrap = document.getElementById("timeline-content");
    const nEvents = TIMELINE.reduce((n, g) => n + g.events.length, 0);
    let html = `<p class="hint">Every dated fact from the flashcards — <strong>${nEvents}</strong> facts across <strong>${TIMELINE.length}</strong> dates, oldest first. A card appears under each date it mentions.</p>`;
    let era = null;
    html += `<div class="timeline">`;
    TIMELINE.forEach(g => {
      const e = eraOf(g.key);
      if (e !== era) { era = e; html += `<div class="tl-era">${esc(e)}</div>`; }
      html += `<div class="tl-group"><div class="tl-year">${esc(g.label)}</div>`;
      g.events.forEach(card => {
        const chap = card._chapter <= 5 ? "Ch " + card._chapter : "⭐ Key facts";
        html += `<div class="tl-event"><div class="tl-q">${inlineMd(card.q)}</div><div class="tl-a">${inlineMd(card.a)}</div><div class="tl-meta">${chap} · §${esc(String(card.section))} · p.${card.page}</div></div>`;
      });
      html += `</div>`;
    });
    html += `</div>`;
    wrap.innerHTML = html;
  }

  // ---------- stats ----------
  function renderStats() {
    const wrap = document.getElementById("stats-content");
    let html = `<div class="stat-grid">`;
    DATA.forEach(ch => {
      const cards = ALL_CARDS.filter(c => c._chapter === ch.chapter);
      const right = cards.filter(c => (store.cards[c._id] || {}).last === "c").length;
      const wrong = cards.filter(c => (store.cards[c._id] || {}).last === "w").length;
      const pctR = cards.length ? Math.round((right / cards.length) * 100) : 0;
      const pctW = cards.length ? Math.round((wrong / cards.length) * 100) : 0;
      html += `<div class="stat-card">
        <h3>${ch.chapter <= 5 ? "Ch " + ch.chapter + ": " : ""}${esc(ch.title)}</h3>
        <div class="bar"><div class="ok" style="width:${pctR}%"></div><div class="bad" style="width:${pctW}%"></div></div>
        <div class="stat-num">${right} right · ${wrong} wrong · ${cards.length - right - wrong} unseen · ${cards.length} total (${pctR}% right)</div>
      </div>`;
    });
    const total = ALL_CARDS.length;
    const totalRight = ALL_CARDS.filter(c => (store.cards[c._id] || {}).last === "c").length;
    const totalWrong = ALL_CARDS.filter(c => (store.cards[c._id] || {}).last === "w").length;
    html += `</div><p class="hint" style="margin-top:1rem">Overall (by latest attempt): <strong>${totalRight}/${total}</strong> right (${total ? Math.round(totalRight / total * 100) : 0}%), ${totalWrong} to drill via “only questions I got wrong”. The test asks 24 questions from anywhere in the book; aim for consistent coverage across every chapter, not just your favourites.</p>`;
    wrap.innerHTML = html;
  }

  // ---------- boot ----------
  renderSummaryNav();
  renderChapterFilters();
  renderChecklists();
  renderTimeline();
  rebuildDeck();
  // auto-open first section
  const firstBtn = document.querySelector("#summary-nav button");
  if (firstBtn) firstBtn.click();
})();
