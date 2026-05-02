(function () {
  const FIELD_DEFS = [
    {
      key: "first_name",
      ids: ["first_name"],
      labels: ["first name"],
      type: "text",
    },
    {
      key: "last_name",
      ids: ["last_name"],
      labels: ["last name"],
      type: "text",
    },
    {
      key: "preferred_first_name",
      ids: ["preferred_name", "preferred_first_name"],
      labels: ["preferred first name", "preferred name"],
      type: "text",
    },
    {
      key: "email",
      ids: ["email"],
      labels: ["email", "email address"],
      type: "text",
    },
    {
      key: "phone",
      ids: ["phone"],
      labels: ["phone", "phone number", "mobile"],
      type: "text",
    },
    {
      key: "location",
      ids: ["location", "city"],
      labels: ["location (city)", "location", "city", "current location"],
      type: "text",
    },
    // ── Social links ── (present on ALL 3 pages as custom question text inputs)
    {
      key: "linkedin",
      ids: ["linkedin_profile", "linkedin", "linkedin_url"],
      labels: [
        "linkedin profile",
        "linkedin profile url",
        "linkedin",
        "linkedin url",
      ],
      type: "text",
    },
    {
      key: "github",
      ids: ["github_url", "github", "github_profile"],
      labels: ["github", "github profile", "github url"],
      type: "text",
    },
    {
      key: "portfolio",
      ids: ["portfolio", "website", "portfolio_url"],
      labels: ["portfolio", "website", "personal website", "portfolio url"],
      type: "text",
    },
    // ── PilotHQ specific ──
    {
      key: "cover_letter_text",
      ids: ["cover_letter"],
      labels: ["cover letter"],
      type: "textarea",
    },
    {
      key: "why_interested",
      ids: [],
      labels: [
        "why are you interested in this software engineer role",
        "why are you interested",
        "why interested",
      ],
      type: "textarea",
    },
  ];

  // ─── DROPDOWN FIELDS — map label → value to select ───────────────────────────
  // These are the Select... dropdowns on each page.
  // We DON'T auto-fill most of these (too risky without user input)
  // but we DO handle Country if we have location data.
  const DROPDOWN_DEFS = [
    {
      key: "country",
      labels: ["country"],
      // We won't auto-select — leave for user
      autoFill: false,
    },
  ];

  // ─── Message listener ────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "PING") {
      sendResponse({ status: "ready" });
      return true;
    }
    // NEW: Return scraped questions to background
    if (msg.action === "SCRAPE_QUESTIONS") {
      waitForFormReady().then(() => {
        sendResponse({ success: true, questions: scrapeFormQuestions() });
      });
      return true;
    }
    if (msg.action === "AUTOFILL") {
      doAutofill(msg.data, msg.resumeFile, msg.aiAnswers)
        .then((r) => sendResponse({ success: true, result: r }))
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true;
    }
  });

  // ─── MAIN AUTOFILL ───────────────────────────────────────────────────────────
  async function doAutofill(data, fileData, aiAnswers = {}) {
    const results = { filled: [], skipped: [], errors: [] };

    await waitForFormReady();
    await exposeHiddenTextareas(); // NEW: Open cover letter boxes
    await sleep(800);

    log(
      "Form ready. Inputs found:",
      document.querySelectorAll("input, textarea, select").length,
    );

    const values = {
      first_name: firstName(data.name),
      last_name: lastName(data.name),
      preferred_first_name: firstName(data.name),
      email: data.email,
      phone: data.phone,
      location: extractCity(data.location),
    };

    // 1. Fill standard fields
    for (const def of FIELD_DEFS) {
      if (
        [
          "cover_letter_text",
          "why_interested",
          "linkedin",
          "github",
          "portfolio",
        ].includes(def.key)
      )
        continue;

      const val = values[def.key];
      if (!val) {
        results.skipped.push(def.key);
        continue;
      }

      const el = findField(def);
      if (el) {
        reactFill(el, val)
          ? results.filled.push(def.key)
          : results.errors.push(def.key);
      }
    }

    // 2. NEW: Fill Dynamic AI Fields
    log("Starting dynamic AI field injection...");
    for (const [questionLabel, aiAnswer] of Object.entries(aiAnswers)) {
      if (!aiAnswer || aiAnswer === "" || aiAnswer.toLowerCase() === "n/a")
        continue;

      const el = findElementByLabelText(questionLabel);
      if (!el) {
        results.skipped.push(`AI: ${questionLabel.substring(0, 15)}`);
        continue;
      }

      let ok = false;
      if (el.tagName === "SELECT") {
        ok = fillDropdown(el, aiAnswer);
      } else if (el.type === "radio") {
        ok = fillRadioGroup(el.name, aiAnswer);
      } else {
        ok = reactFill(el, aiAnswer);
      }

      ok
        ? results.filled.push(`AI: ${questionLabel.substring(0, 15)}...`)
        : results.errors.push(`AI: ${questionLabel.substring(0, 15)}`);
    }

    // 3. Resume file upload
    if (fileData) {
      try {
        const file = dataURLtoFile(
          fileData.dataUrl,
          fileData.name,
          fileData.type,
        );
        const fi = findFileInput();
        if (fi) {
          fillFile(fi, file)
            ? results.filled.push("resume_file")
            : results.skipped.push("resume_file");
        } else {
          results.skipped.push("resume_file");
        }
      } catch (e) {
        results.errors.push("resume_file: " + e.message);
      }
    }

    showBanner(results);
    return results;
  }

  // ─── FIELD FINDER — 4 strategies in priority order ───────────────────────────
  function findField(def) {
    // Strategy 1: Exact element ID
    for (const id of def.ids) {
      const el = document.getElementById(id);
      if (el && isInputEl(el) && isVisible(el)) {
        log(`Found by ID: #${id}`);
        return el;
      }
    }

    // Strategy 2: name attribute
    for (const id of def.ids) {
      const el = document.querySelector(`[name="${id}"]`);
      if (el && isInputEl(el) && isVisible(el)) {
        log(`Found by name: [name=${id}]`);
        return el;
      }
    }

    // Strategy 3: <label> text → for= → input
    // Greenhouse wraps each field in:
    //   <div class="field">
    //     <label for="INPUT_ID">Label Text *</label>
    //     <input id="INPUT_ID" type="text" />
    //   </div>
    for (const label of document.querySelectorAll("label")) {
      const labelText = cleanLabel(label.textContent);
      if (def.labels.some((l) => labelText === l || labelText.startsWith(l))) {
        // Try for= link
        if (label.htmlFor) {
          const el = document.getElementById(label.htmlFor);
          if (el && isInputEl(el) && isVisible(el)) {
            log(`Found by label[for]: "${labelText}" → #${label.htmlFor}`);
            return el;
          }
        }
        // Try direct child
        const child = label.parentElement?.querySelector("input, textarea");
        if (child && isVisible(child)) {
          log(`Found by label child: "${labelText}"`);
          return child;
        }
        // Try next sibling
        const sib = label.nextElementSibling;
        if (sib && isInputEl(sib) && isVisible(sib)) {
          log(`Found by label sibling: "${labelText}"`);
          return sib;
        }
        // Try parent's input
        const parentInput = label
          .closest('.field, .application-field, [class*="field"], li')
          ?.querySelector("input, textarea");
        if (parentInput && isVisible(parentInput)) {
          log(`Found by label parent container: "${labelText}"`);
          return parentInput;
        }
      }
    }

    // Strategy 4: placeholder / aria-label / id text matching
    const selector =
      def.type === "textarea"
        ? "textarea"
        : 'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input:not([type])';
    for (const el of document.querySelectorAll(selector)) {
      if (!isVisible(el)) continue;
      const attrs = [
        cleanLabel(el.getAttribute("aria-label") || ""),
        cleanLabel(el.placeholder || ""),
        (el.name || "").toLowerCase(),
        (el.id || "").toLowerCase(),
      ];
      if (def.labels.some((l) => attrs.some((a) => a.includes(l)))) {
        log(`Found by attribute: "${def.key}" in attrs`);
        return el;
      }
    }

    return null;
  }

  // ─── REACT-COMPATIBLE FILL ───────────────────────────────────────────────────
  // Greenhouse uses React. This is the correct way to set a value
  // so React's state picks it up.
  function reactFill(el, value) {
    if (!el || !value) return false;
    try {
      // 1. Focus element
      el.focus();

      // 2. Use native prototype setter to set value
      //    (bypasses React's synthetic tracking so onChange fires correctly)
      const proto =
        el.tagName === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (nativeSetter) nativeSetter.call(el, value);
      else el.value = value;

      // 3. Dispatch events in order React expects
      el.dispatchEvent(new Event("focus", { bubbles: true }));
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: value,
        }),
      );
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));

      // 4. Verify
      const success = el.value === value;
      if (!success)
        log(`WARN: fill may not have registered for "${el.id || el.name}"`);
      return true; // return true even if unverifiable (React state may hold the value)
    } catch (e) {
      log("reactFill error:", e.message);
      return false;
    }
  }

  // ─── FILE INPUT FILL ─────────────────────────────────────────────────────────
  function fillFile(el, file) {
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      el.files = dt.files;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    } catch (e) {
      log("fillFile error:", e.message);
      return false;
    }
  }
  function fillDropdown(el, value) {
    if (!el || !value) return false;
    const options = Array.from(el.options);

    const match = options.find(
      (opt) =>
        opt.text.toLowerCase().includes(value.toLowerCase()) ||
        opt.value.toLowerCase() === value.toLowerCase(),
    );

    if (match) {
      el.value = match.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;
  }

  function fillRadioGroup(nameAttribute, desiredValue) {
    // Find all radio buttons with this name
    const radios = document.querySelectorAll(
      `input[type="radio"][name="${nameAttribute}"]`,
    );
    for (const radio of radios) {
      // Check if the adjacent label matches our desired value (e.g., "Yes")
      const label =
        radio.closest("label") ||
        document.querySelector(`label[for="${radio.id}"]`);
      if (
        label &&
        label.textContent.toLowerCase().includes(desiredValue.toLowerCase())
      ) {
        radio.checked = true;
        radio.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  function findFileInput() {
    const all = document.querySelectorAll('input[type="file"]');
    for (const inp of all) {
      const n = (inp.name || "").toLowerCase();
      const id = (inp.id || "").toLowerCase();
      const acc = (inp.accept || "").toLowerCase();
      if (
        n.includes("resume") ||
        id.includes("resume") ||
        n.includes("cv") ||
        id.includes("cv") ||
        acc.includes("pdf") ||
        acc.includes(".doc")
      )
        return inp;
    }
    // Single file input = resume
    if (all.length === 1) return all[0];
    return null;
  }

  // ─── WAIT FOR FORM READY ─────────────────────────────────────────────────────
  // Greenhouse renders via React — we wait for #first_name OR at least 3 text inputs
  function waitForFormReady(timeout = 15000) {
    return new Promise((resolve) => {
      const isReady = () => {
        const byId =
          document.getElementById("first_name") ||
          document.getElementById("email");
        const byCount =
          document.querySelectorAll('input[type="text"], input[type="email"]')
            .length >= 2;
        return !!(byId || byCount);
      };
      if (isReady()) return resolve();
      const obs = new MutationObserver(() => {
        if (isReady()) {
          obs.disconnect();
          resolve();
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        obs.disconnect();
        resolve();
      }, timeout);
    });
  }

  // ─── HELPERS ─────────────────────────────────────────────────────────────────
  function cleanLabel(text) {
    return (text || "")
      .toLowerCase()
      .trim()
      .replace(/\s*\*\s*$/, "") // remove trailing asterisk
      .replace(/\s+/g, " ") // normalise whitespace
      .trim();
  }

  function firstName(n) {
    return (n || "").trim().split(/\s+/)[0] || "";
  }

  function lastName(n) {
    const parts = (n || "").trim().split(/\s+/);
    return parts.length > 1 ? parts.slice(1).join(" ") : "";
  }

  function extractCity(location) {
    // "Mumbai, Maharashtra, IN" → "Mumbai"
    // "San Francisco, CA" → "San Francisco"
    if (!location) return "";
    return location.split(",")[0].trim();
  }

  function dataURLtoFile(dataUrl, name, type) {
    const arr = dataUrl.split(","),
      bstr = atob(arr[1]);
    let n = bstr.length;
    const u8 = new Uint8Array(n);
    while (n--) u8[n] = bstr.charCodeAt(n);
    return new File([u8], name, { type });
  }

  function isVisible(el) {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    return (
      s.display !== "none" &&
      s.visibility !== "hidden" &&
      s.opacity !== "0" &&
      el.offsetWidth > 0 &&
      el.offsetHeight > 0
    );
  }

  function isInputEl(el) {
    return el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  function log(...a) {
    console.log("[ResumeAutofill]", ...a);
  }

  // ─── RESULT BANNER ───────────────────────────────────────────────────────────
  function showBanner(r) {
    document.getElementById("__ra_banner")?.remove();
    const skippedReal = r.skipped.filter(
      (s) =>
        ![
          "preferred_first_name",
          "cover_letter_text",
          "why_interested",
          "portfolio",
          "github",
        ].includes(s),
    );
    const b = document.createElement("div");
    b.id = "__ra_banner";
    b.style.cssText = [
      "position:fixed",
      "top:16px",
      "right:16px",
      "z-index:2147483647",
      "background:#0f1f17",
      "color:#d8f3dc",
      "border-radius:10px",
      "padding:14px 18px 12px",
      "font-family:system-ui,sans-serif",
      "font-size:13px",
      "line-height:1.6",
      "box-shadow:0 8px 32px rgba(0,0,0,.55)",
      "max-width:290px",
      "border:1px solid #1b4332",
    ].join(";");

    b.innerHTML = `
      <div style="font-weight:600;color:#52b788;margin-bottom:4px">✅ Resume Autofill Complete</div>
      <div>Filled: <strong style="color:#52b788">${r.filled.length}</strong> field${r.filled.length !== 1 ? "s" : ""}</div>
      ${skippedReal.length ? `<div style="color:#888;font-size:12px;margin-top:2px">Missing data: ${skippedReal.join(", ")}</div>` : ""}
      ${r.errors.length ? `<div style="color:#e07070;font-size:12px;margin-top:2px">Errors: ${r.errors.join(", ")}</div>` : ""}
      <div style="color:#2d6a4f;font-size:11px;margin-top:7px">⚠️ Review all fields — then submit manually</div>
      <button onclick="this.parentElement.remove()" style="position:absolute;top:8px;right:10px;background:none;border:none;color:#2d6a4f;font-size:20px;cursor:pointer;line-height:1">×</button>
    `;
    document.body.appendChild(b);
    setTimeout(() => b?.parentElement && b.remove(), 9000);
  }

  // ─── DYNAMIC AI MAPPING HELPERS ──────────────────────────────────────────────

  function scrapeFormQuestions() {
    const questions = [];
    document.querySelectorAll("label").forEach((label) => {
      const text = cleanLabel(label.textContent);
      const standardFields = ["first name", "last name", "email", "phone"];
      if (text && !questions.includes(text) && !standardFields.includes(text)) {
        questions.push(text);
      }
    });
    return questions;
  }

  function findElementByLabelText(labelText) {
    const targetLabel = cleanLabel(labelText);
    for (const label of document.querySelectorAll("label")) {
      if (cleanLabel(label.textContent) === targetLabel) {
        if (label.htmlFor) {
          const el = document.getElementById(label.htmlFor);
          if (el && isVisible(el)) return el;
        }
        const child = label.parentElement?.querySelector(
          "input, textarea, select",
        );
        if (child && isVisible(child)) return child;
        const sib = label.nextElementSibling;
        if (sib && isVisible(sib) && isInputEl(sib)) return sib;
      }
    }
    return null;
  }

  async function exposeHiddenTextareas() {
    const manualButtons = document.querySelectorAll(
      'button[data-source="paste"]',
    );
    for (const btn of manualButtons) {
      const container = btn.closest(".application-field, .field");
      const textarea = container?.querySelector("textarea");
      if (textarea && !isVisible(textarea)) {
        btn.click();
        await sleep(100);
      }
    }
  }
})();
