/* Life in the UK study app — no dependencies, data injected via data.js (window.STUDY_DATA) */
(function () {
  "use strict";

  const DATA = window.STUDY_DATA || [];
  const LS_KEY = "liuk-progress-v1";

  // ---------- state ----------
  let store = loadStore();
  let deck = [];          // filtered+ordered card list
  let deckPos = 0;
  let showingAnswer = false;
  let activeChapters = new Set(DATA.map(c => c.chapter));

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || { cards: {}, checks: {} }; }
    catch { return { cards: {}, checks: {} }; }
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
    if (nCards) html += `<p class="page-ref">${nCards} flashcards cover this section — practice them in the Flashcards tab.</p>`;
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
    const onlyUnknown = document.getElementById("only-unknown").checked;
    deck = ALL_CARDS.filter(c => activeChapters.has(c._chapter));
    if (onlyUnknown) deck = deck.filter(c => store.cards[c._id] !== "know");
    if (!keepOrder) shuffle(deck);
    deckPos = 0;
    showingAnswer = false;
    renderCard();
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  function renderCard() {
    const face = document.getElementById("card-face");
    const meta = document.getElementById("card-meta");
    const prog = document.getElementById("card-progress");
    const grade = document.getElementById("grade-actions");
    const flipBtn = document.getElementById("flip-btn");
    const fc = document.getElementById("flashcard");

    if (!deck.length) {
      face.innerHTML = `<span class="label">Deck</span>🎉 No cards match this filter — everything here is marked as known. Untick “only cards I don't know” or pick another chapter.`;
      meta.textContent = "";
      prog.textContent = "0 cards";
      grade.classList.add("hidden");
      flipBtn.classList.add("hidden");
      fc.classList.remove("answer");
      return;
    }
    flipBtn.classList.remove("hidden");
    const card = deck[deckPos];
    const known = store.cards[card._id] === "know";
    prog.textContent = `Card ${deckPos + 1} of ${deck.length}` + (known ? " · ✓ marked known" : "");
    if (showingAnswer) {
      face.innerHTML = `<span class="label">Answer</span>` + inlineMd(card.a);
      grade.classList.remove("hidden");
      fc.classList.add("answer");
      flipBtn.textContent = "Show question (Space)";
    } else {
      face.innerHTML = `<span class="label">Question</span>` + inlineMd(card.q);
      grade.classList.add("hidden");
      fc.classList.remove("answer");
      flipBtn.textContent = "Flip (Space)";
    }
    meta.textContent = `Ch ${card._chapter} · §${card.section} · p.${card.page}` + (card.tags && card.tags.length ? " · " + card.tags.join(", ") : "");
  }

  function flip() { showingAnswer = !showingAnswer; renderCard(); }
  function next() { if (deck.length) { deckPos = (deckPos + 1) % deck.length; showingAnswer = false; renderCard(); } }
  function prev() { if (deck.length) { deckPos = (deckPos - 1 + deck.length) % deck.length; showingAnswer = false; renderCard(); } }
  function grade(known) {
    if (!deck.length) return;
    const card = deck[deckPos];
    store.cards[card._id] = known ? "know" : "learning";
    saveStore();
    // if filtering unknowns and card became known, remove it from deck
    if (known && document.getElementById("only-unknown").checked) {
      deck.splice(deckPos, 1);
      if (deckPos >= deck.length) deckPos = 0;
      showingAnswer = false;
      renderCard();
    } else {
      next();
    }
  }

  document.getElementById("flip-btn").addEventListener("click", flip);
  document.getElementById("flashcard").addEventListener("click", flip);
  document.getElementById("next-btn").addEventListener("click", next);
  document.getElementById("prev-btn").addEventListener("click", prev);
  document.getElementById("know-btn").addEventListener("click", () => grade(true));
  document.getElementById("dont-know-btn").addEventListener("click", () => grade(false));
  document.getElementById("shuffle-btn").addEventListener("click", () => rebuildDeck());
  document.getElementById("only-unknown").addEventListener("change", () => rebuildDeck());
  document.getElementById("reset-deck-btn").addEventListener("click", () => {
    if (!confirm("Clear know/learning marks for all cards in the current filter?")) return;
    deck.forEach(c => delete store.cards[c._id]);
    saveStore();
    rebuildDeck(true);
  });

  document.addEventListener("keydown", e => {
    if (!document.getElementById("tab-cards").classList.contains("active")) return;
    if (e.target.tagName === "INPUT") return;
    if (e.code === "Space") { e.preventDefault(); flip(); }
    else if (e.key === "ArrowRight") next();
    else if (e.key === "ArrowLeft") prev();
    else if (e.key === "1" && showingAnswer) grade(false);
    else if (e.key === "2" && showingAnswer) grade(true);
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

  // ---------- stats ----------
  function renderStats() {
    const wrap = document.getElementById("stats-content");
    let html = `<div class="stat-grid">`;
    DATA.forEach(ch => {
      const cards = ALL_CARDS.filter(c => c._chapter === ch.chapter);
      const known = cards.filter(c => store.cards[c._id] === "know").length;
      const learning = cards.filter(c => store.cards[c._id] === "learning").length;
      const pct = cards.length ? Math.round((known / cards.length) * 100) : 0;
      html += `<div class="stat-card">
        <h3>${ch.chapter <= 5 ? "Ch " + ch.chapter + ": " : ""}${esc(ch.title)}</h3>
        <div class="bar"><div style="width:${pct}%"></div></div>
        <div class="stat-num">${known} known · ${learning} still learning · ${cards.length - known - learning} unseen · ${cards.length} total (${pct}%)</div>
      </div>`;
    });
    const total = ALL_CARDS.length;
    const totalKnown = ALL_CARDS.filter(c => store.cards[c._id] === "know").length;
    html += `</div><p class="hint" style="margin-top:1rem">Overall: <strong>${totalKnown}/${total}</strong> cards known (${total ? Math.round(totalKnown / total * 100) : 0}%). The test asks 24 questions from anywhere in the book; aim for consistent coverage across every chapter, not just your favourites.</p>`;
    wrap.innerHTML = html;
  }

  // ---------- boot ----------
  renderSummaryNav();
  renderChapterFilters();
  renderChecklists();
  rebuildDeck();
  // auto-open first section
  const firstBtn = document.querySelector("#summary-nav button");
  if (firstBtn) firstBtn.click();
})();
