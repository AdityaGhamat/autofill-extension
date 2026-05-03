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
    document
      .querySelectorAll(".tab")
      .forEach((t) =>
        t.addEventListener("click", () => switchTab(t.dataset.tab)),
      );
    $("btnSettings").addEventListener("click", () => switchTab("settings"));

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
      await msg({ action: "SAVE_RESUME_DATA", data, file: filePayload });
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
    msg({ action: "SAVE_RESUME_DATA", data: resumeData, file: filePayload });
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
      toast("Groq API Key required for AI Mapping.", "err");
      switchTab("settings");
      return;
    }

    $("btnAnalyze").disabled = true;
    $("btnAnalyze").textContent = "⏳ Scraping & Analyzing...";

    try {
      const scrapeRes = await msg({ action: "SCRAPE_QUESTIONS" });
      const questions = scrapeRes?.questions || [];
      if (questions.length === 0) {
        toast("No custom questions found on page.", "err");
        return;
      }

      toast(`Found ${questions.length} questions. Asking AI...`);

      const prompt = `You are a robotic job application JSON generator. Read the resume and map the EXACT questions to the correct answers.

Resume:
${JSON.stringify(resumeData)}

Questions to Answer:
${JSON.stringify(questions)}

MANDATORY RULES FOR ANSWERS:
1. Cover Letter: Write a professional 100-word cover letter highlighting MERN stack, React, and Node.js.
2. Gender: Confidently infer the gender based on the applicant's first name and output exactly "Male" or "Female". If completely ambiguous, output "Decline to self-identify".
3. Race/Veteran/Disability: Output exactly "Decline to self-identify" or "I don't wish to answer".
4. "How did you hear" / Source: Output exactly "LinkedIn".
5. "Legally authorized to work" / Background Checks / Relocation: Output exactly "Yes".
6. Sponsorship / Visa: Output exactly "No".
7. Technical Questions (e.g., Python): If asked about a skill NOT on the resume, DO NOT output "N/A". Instead, write a 1-sentence response pivoting to your actual skills (e.g., "While I do not have production experience with Python, my backend expertise is focused on Node.js and the MERN stack.").
8. Unanswerable non-technical fields: Output exactly "N/A".

Return ONLY a raw JSON object where the keys are the EXACT question strings, and the values are your answers. DO NOT output markdown formatting or conversational text.`;

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
            temperature: 0.1,
            response_format: { type: "json_object" },
          }),
        },
      );

      const data = await response.json();
      aiAnswers = JSON.parse(data.choices[0].message.content);

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
      ${a.length > 50 ? `<textarea class="finp dy-inp" data-q="${q}" rows="3" style="width:100%">${a}</textarea>` : `<input class="finp dy-inp" data-q="${q}" value="${a}" style="width:100%"/>`}
      `;
      wrap.appendChild(row);
    }
  }

  async function doFill() {
    if (!resumeData) {
      toast("Parse a resume first", "err");
      return;
    }

    const pvActive = document
      .getElementById("tab-preview")
      .classList.contains("active");
    if (pvActive) saveEdits();

    document.querySelectorAll(".dy-inp").forEach((inp) => {
      aiAnswers[inp.dataset.q] = inp.value;
    });

    $("btnFill").disabled = true;
    $("btnFill").textContent = "⏳ Filling…";
    try {
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

  async function loadSaved() {
    try {
      const r = await msg({ action: "GET_RESUME_DATA" });
      if (r?.data) {
        resumeData = r.data;
        filePayload = r.file;
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
    aiAnswers = {};
    $("pvEmpty").style.display = "block";
    $("pvContent").style.display = "none";
    $("autofillWrap").style.display = "none";
    $("dynamic-questions").innerHTML = "";
    clearFile();
    toast("Data cleared");
  }

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
