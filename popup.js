(function () {
  "use strict";

  let currentFile = null,
    resumeData = null,
    filePayload = null,
    aiAnswers = {};
  const $ = (id) => document.getElementById(id);

  document.addEventListener("DOMContentLoaded", () => {
    checkSite();
    loadSaved();
    loadKey();
    bindAll();
  });

  function bindAll() {
    // Tabs
    document
      .querySelectorAll(".tab")
      .forEach((t) =>
        t.addEventListener("click", () => switchTab(t.dataset.tab)),
      );
    $("btnSettings").addEventListener("click", () => switchTab("settings"));
    // Upload
    $("btnAnalyze").addEventListener("click", doAnalyze);
    $("uploadZone").addEventListener("click", () => $("fileInput").click());
    $("uploadZone").addEventListener("dragover", (e) => {
      e.preventDefault();
      $("uploadZone").classList.add("over");
    });
    $("uploadZone").addEventListener("dragleave", () =>
      $("uploadZone").classList.remove("over"),
    );
    $("uploadZone").addEventListener("drop", (e) => {
      e.preventDefault();
      $("uploadZone").classList.remove("over");
      const f = e.dataTransfer?.files?.[0];
      if (f) onFile(f);
    });
    $("fileInput").addEventListener("change", (e) => {
      if (e.target.files[0]) onFile(e.target.files[0]);
    });
    $("fcRm").addEventListener("click", clearFile);
    $("btnParse").addEventListener("click", doParse);
    $("btnFill").addEventListener("click", doFill);
    $("btnSaveEdits").addEventListener("click", saveEdits);
    $("btnSaveKey").addEventListener("click", saveKey);
    $("btnClearKey").addEventListener("click", clearKey);
    $("btnClearData").addEventListener("click", clearData);
  }

  function switchTab(name) {
    document
      .querySelectorAll(".tab")
      .forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    document
      .querySelectorAll(".panel")
      .forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
  }

  // ── Site check ──────────────────────────────────────────────────────────────
  async function checkSite() {
    try {
      const r = await msg({ action: "CHECK_TAB" });
      const ok = r?.supported;
      $("siteStatus").className = `status ${ok ? "ok" : "bad"}`;
      $("sDot").className = `dot ${ok ? "g" : "r"}`;
      $("sTxt").textContent = ok
        ? "Greenhouse form detected ✓"
        : "Open a Greenhouse job application page";
    } catch {
      $("sTxt").textContent = "Navigate to a Greenhouse job form";
    }
  }

  // ── File ─────────────────────────────────────────────────────────────────────
  function onFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["pdf", "docx", "doc"].includes(ext)) {
      toast("Upload a PDF or DOCX file", "err");
      return;
    }
    currentFile = file;
    $("uploadZone").style.display = "none";
    $("fileCard").style.display = "flex";
    $("fcIcon").textContent = ext === "pdf" ? "📄" : "📝";
    $("fcName").textContent = file.name;
    $("fcSize").textContent = fmtBytes(file.size);
    $("btnParse").disabled = false;
  }
  function clearFile() {
    currentFile = null;
    $("fileInput").value = "";
    $("fileCard").style.display = "none";
    $("uploadZone").style.display = "block";
    $("btnParse").disabled = true;
    $("autofillWrap").style.display = "none";
  }

  // ── Parse ────────────────────────────────────────────────────────────────────
  async function doParse() {
    if (!currentFile) return;
    setLoading(true, "Extracting text…");
    try {
      const kr = await msg({ action: "GET_API_KEY" });
      const key = kr?.key || null;
      if (key) setLoading(true, "Analysing with Groq AI…");
      const data = await window.parseResume(currentFile, key);
      resumeData = data;
      filePayload = await toDataURL(currentFile);
      await msg({ action: "SAVE_RESUME_DATA", data });
      populatePreview(data);
      setLoading(false);
      $("autofillWrap").style.display = "block";
      toast(
        `Parsed via ${data._source === "groq" ? "Groq AI ✨" : "heuristics"}`,
      );
      switchTab("preview");
    } catch (e) {
      setLoading(false);
      toast(e.message || "Parsing failed", "err");
      console.error(e);
    }
  }

  // ── Preview ──────────────────────────────────────────────────────────────────
  function populatePreview(d) {
    $("pvEmpty").style.display = "none";
    $("pvContent").style.display = "block";
    $("p_name").value = d.name || "";
    $("p_email").value = d.email || "";
    $("p_phone").value = d.phone || "";
    $("p_location").value = d.location || "";
    $("p_linkedin").value = d.links?.linkedin || "";
    $("p_github").value = d.links?.github || "";
    $("p_portfolio").value = d.links?.portfolio || "";
    $("p_skills").value = (d.skills || []).join(", ");
    const b = $("srcBadge");
    b.textContent = d._source === "groq" ? "AI" : "Heuristics";
    b.className = `badge ${d._source === "groq" ? "ai" : "heu"}`;
  }
  function saveEdits() {
    if (!resumeData) return;
    resumeData.name = $("p_name").value;
    resumeData.email = $("p_email").value;
    resumeData.phone = $("p_phone").value;
    resumeData.location = $("p_location").value;
    resumeData.links = resumeData.links || {};
    resumeData.links.linkedin = $("p_linkedin").value;
    resumeData.links.github = $("p_github").value;
    resumeData.links.portfolio = $("p_portfolio").value;
    resumeData.skills = $("p_skills")
      .value.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    msg({ action: "SAVE_RESUME_DATA", data: resumeData });
    toast("Edits saved ✓");
  }

  async function doAnalyze() {
    if (!resumeData) {
      toast("Parse a resume first", "err");
      return;
    }
    const kr = await msg({ action: "GET_API_KEY" });
    const key = kr?.key;
    if (!key) {
      toast("Groq API Key required for AI Mapping. Check Settings.", "err");
      switchTab("settings");
      return;
    }

    $("btnAnalyze").disabled = true;
    $("btnAnalyze").textContent = "⏳ Scraping & Analyzing...";

    try {
      // 1. Scrape page
      const scrapeRes = await msg({ action: "SCRAPE_QUESTIONS" });
      const questions = scrapeRes?.questions || [];
      if (questions.length === 0) {
        toast("No custom questions found on page.", "err");
        return;
      }

      toast(`Found ${questions.length} questions. Asking AI...`);

      // 2. Call Groq
      const prompt = `You are an expert job applicant. Read the resume and answer these application questions.\n\nResume:\n${JSON.stringify(resumeData)}\n\nQuestions:\n${JSON.stringify(questions)}\n\nInstructions:\n- If it asks for a Cover Letter, write a 100-word professional cover letter highlighting the resume's MERN stack experience.\n- If it asks for years of experience with specific tech, calculate it from the resume dates.\n- If it asks about government affiliations/sponsorship/visas, default to 'No' or standard safe answers.\n- Return ONLY a valid JSON object mapping the exact question string to your answer string.\n\nJSON Output:`;

      const response = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2,
            response_format: { type: "json_object" },
          }),
        },
      );

      const data = await response.json();
      aiAnswers = JSON.parse(data.choices[0].message.content);

      // 3. Show in Preview
      renderDynamicQuestions();
      toast("AI Analysis complete! Review in Preview tab.");
      switchTab("preview");
    } catch (e) {
      toast("Analysis failed", "err");
      console.error(e);
    } finally {
      $("btnAnalyze").disabled = false;
      $("btnAnalyze").textContent = "🧠 Analyze Page & Match (AI)";
    }
  }

  function renderDynamicQuestions() {
    const wrap = $("dynamic-questions");
    wrap.innerHTML = '<div class="sec-title">AI Custom Answers (Review)</div>';
    for (const [q, a] of Object.entries(aiAnswers)) {
      const row = document.createElement("div");
      row.style.marginBottom = "8px";
      row.innerHTML = `
      <div style="font-size:11px; color:#888; margin-bottom:3px;">${q}</div>
      ${
        a.length > 50
          ? `<textarea class="finp dy-inp" data-q="${q}" rows="3" style="width:100%">${a}</textarea>`
          : `<input class="finp dy-inp" data-q="${q}" value="${a}" style="width:100%"/>`
      }
    `;
      wrap.appendChild(row);
    }
  }

  // ── Autofill ─────────────────────────────────────────────────────────────────
  // ── Autofill & AI Analysis ───────────────────────────────────────────────────

  async function doAnalyze() {
    if (!resumeData) {
      toast("Parse a resume first", "err");
      return;
    }
    const kr = await msg({ action: "GET_API_KEY" });
    const key = kr?.key;
    if (!key) {
      toast("Groq API Key required for AI Mapping. Check Settings.", "err");
      switchTab("settings");
      return;
    }

    $("btnAnalyze").disabled = true;
    $("btnAnalyze").textContent = "⏳ Scraping & Analyzing...";

    try {
      // 1. Scrape page
      const scrapeRes = await msg({ action: "SCRAPE_QUESTIONS" });
      const questions = scrapeRes?.questions || [];
      if (questions.length === 0) {
        toast("No custom questions found on page.", "err");
        return;
      }

      toast(`Found ${questions.length} questions. Asking AI...`);

      // 2. Call Groq
      const prompt = `You are an expert job applicant. Read the resume and answer these application questions.\n\nResume:\n${JSON.stringify(resumeData)}\n\nQuestions:\n${JSON.stringify(questions)}\n\nInstructions:\n- If it asks for a Cover Letter, write a 100-word professional cover letter highlighting the resume's MERN stack experience.\n- If it asks for years of experience with specific tech, calculate it from the resume dates.\n- If it asks about government affiliations/sponsorship/visas, default to 'No' or standard safe answers.\n- Return ONLY a valid JSON object mapping the exact question string to your answer string.\n\nJSON Output:`;

      const response = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2,
            response_format: { type: "json_object" },
          }),
        },
      );

      const data = await response.json();
      aiAnswers = JSON.parse(data.choices[0].message.content);

      // 3. Show in Preview
      renderDynamicQuestions();
      toast("AI Analysis complete! Review in Preview tab.");
      switchTab("preview");
    } catch (e) {
      toast("Analysis failed", "err");
      console.error(e);
    } finally {
      $("btnAnalyze").disabled = false;
      $("btnAnalyze").textContent = "🧠 Analyze Page & Match (AI)";
    }
  }

  function renderDynamicQuestions() {
    const wrap = $("dynamic-questions");
    wrap.innerHTML = '<div class="sec-title">AI Custom Answers (Review)</div>';
    for (const [q, a] of Object.entries(aiAnswers)) {
      const row = document.createElement("div");
      row.style.marginBottom = "8px";
      row.innerHTML = `
      <div style="font-size:11px; color:#888; margin-bottom:3px;">${q}</div>
      ${
        a.length > 50
          ? `<textarea class="finp dy-inp" data-q="${q}" rows="3" style="width:100%">${a}</textarea>`
          : `<input class="finp dy-inp" data-q="${q}" value="${a}" style="width:100%"/>`
      }
    `;
      wrap.appendChild(row);
    }
  }

  async function doFill() {
    if (!resumeData) {
      toast("Parse a resume first", "err");
      return;
    }

    // Sync standard edits
    const pvActive = document
      .getElementById("tab-preview")
      .classList.contains("active");
    if (pvActive) saveEdits();

    // Sync AI dynamic edits
    document.querySelectorAll(".dy-inp").forEach((inp) => {
      aiAnswers[inp.dataset.q] = inp.value;
    });

    $("btnFill").disabled = true;
    $("btnFill").textContent = "⏳ Filling…";
    try {
      // Send standard data + AI answers
      const r = await msg({
        action: "TRIGGER_AUTOFILL",
        resumeData,
        resumeFile: filePayload,
        aiAnswers,
      });
      if (r?.success) {
        toast(
          `✅ Filled ${r.result?.filled?.length || 0} fields — review before submitting`,
        );
      } else {
        toast(r?.error || "Autofill failed", "err");
      }
    } catch {
      toast("Could not reach the page — try reloading it", "err");
    } finally {
      $("btnFill").disabled = false;
      $("btnFill").textContent = "⚡ Autofill This Form";
    }
  }

  // ── Session restore ──────────────────────────────────────────────────────────
  async function loadSaved() {
    try {
      const r = await msg({ action: "GET_RESUME_DATA" });
      if (r?.data) {
        resumeData = r.data;
        populatePreview(r.data);
        $("autofillWrap").style.display = "block";
        $("uploadZone").style.display = "none";
        $("fileCard").style.display = "flex";
        $("fcName").textContent = "Previously parsed resume";
        $("fcSize").textContent = "Session cached";
        $("fcIcon").textContent = "✅";
        $("btnParse").disabled = false;
      }
    } catch (_) {}
  }

  // ── API key ──────────────────────────────────────────────────────────────────
  async function loadKey() {
    const r = await msg({ action: "GET_API_KEY" });
    if (r?.key) $("groqKey").value = r.key;
  }
  async function saveKey() {
    const k = $("groqKey").value.trim();
    if (!k) {
      toast("Enter a key first", "err");
      return;
    }
    if (k.length < 10) {
      toast("Key looks invalid", "err");
      return;
    }
    await msg({ action: "SAVE_API_KEY", key: k });
    toast("API key saved ✓");
  }
  async function clearKey() {
    await msg({ action: "CLEAR_API_KEY" });
    $("groqKey").value = "";
    toast("API key cleared");
  }
  async function clearData() {
    await msg({ action: "CLEAR_RESUME_DATA" });
    resumeData = null;
    filePayload = null;
    currentFile = null;
    $("pvEmpty").style.display = "block";
    $("pvContent").style.display = "none";
    $("autofillWrap").style.display = "none";
    clearFile();
    toast("Data cleared");
  }

  // ── Utils ────────────────────────────────────────────────────────────────────
  function setLoading(on, txt = "") {
    $("loader").classList.toggle("on", on);
    $("loaderTxt").textContent = txt;
    $("btnParse").disabled = on;
    if (on) $("autofillWrap").style.display = "none";
  }
  function toast(t, type = "") {
    const el = $("toast");
    el.textContent = t;
    el.className = `toast ${type === "err" ? "err" : ""} show`;
    setTimeout(() => el.classList.remove("show"), 3200);
  }
  function fmtBytes(b) {
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
  }
  function toDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () =>
        res({ dataUrl: r.result, name: file.name, type: file.type });
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }
  function msg(m) {
    return new Promise((res, rej) => {
      try {
        chrome.runtime.sendMessage(m, (r) => {
          if (chrome.runtime.lastError)
            rej(new Error(chrome.runtime.lastError.message));
          else res(r);
        });
      } catch (e) {
        rej(e);
      }
    });
  }
})();
