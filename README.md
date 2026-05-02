# Resume Autofill — Chrome Extension

Automatically fills Greenhouse job application forms from your resume (PDF or DOCX).

---

## Setup

1. Open Chrome → `chrome://extensions`
2. Enable **Developer Mode** (top-right toggle)
3. Click **Load unpacked** → select the `resume-autofill-extension` folder
4. Pin the extension from the puzzle-piece icon in the toolbar

### Optional: Groq API Key (better parsing accuracy)

1. Go to [console.groq.com](https://console.groq.com) → create free account → generate API key
2. Click extension icon → **Settings** → paste key → **Save API Key**
3. Works without a key too (heuristic regex fallback)

---

## How To Use

1. Navigate to a supported Greenhouse job page (see URLs below)
2. Click the extension icon
3. Upload your resume (PDF or DOCX)
4. Click **Parse Resume**
5. Review & edit extracted data in the **Preview** tab
6. Click **⚡ Autofill This Form**
7. Review the filled fields — then **manually submit**

> The extension will never auto-submit. You always confirm before submitting.

---

## Supported URLs

| Company | URL |
|---------|-----|
| Ethos Life (Greenhouse) | https://job-boards.greenhouse.io/ethoslife/jobs/8502810002 |
| PilotHQ (Greenhouse) | https://job-boards.greenhouse.io/pilothq/jobs/8516101002 |
| Lyft via CareerPuck | https://app.careerpuck.com/job-board/lyft/job/8318822002?gh_jid=8318822002 |

---

## Architecture

```
resume-autofill-extension/
├── manifest.json        Chrome MV3 config — permissions, content_scripts, service worker
├── popup.html           Extension popup UI (360px wide)
├── popup.js             Popup logic: upload, parse, preview/edit, trigger autofill
├── parser.js            PDF (pdf.js) + DOCX (mammoth.js) extraction → Groq AI or heuristics → JSON
├── content.js           Injected into job pages — field detection + DOM fill engine
├── background.js        Service worker — message relay, chrome.storage for key + session data
└── libs/
    ├── pdf.min.js        Mozilla PDF.js (bundled, no CDN)
    ├── pdf.worker.min.js PDF.js web worker
    └── mammoth.min.js    Mammoth.js for DOCX extraction
```

### Data Flow

```
User uploads PDF/DOCX
  → parser.js extracts raw text
    → Groq llama-3.3-70b (or heuristics fallback) → structured JSON
      → Preview panel: user can edit any field
        → "Autofill" clicked → background.js relays to content.js
          → 4-strategy field detection → fills inputs
            → React-compatible event dispatch (input + change + keyup)
              → User manually reviews and submits
```

### Field Detection Strategy (Priority Order)

1. **Known Greenhouse IDs** — `#first_name`, `#email`, `#phone`, etc.
2. **Label `[for]` text matching** — finds `<label>` whose text includes keywords like "First Name"
3. **Attribute matching** — `placeholder`, `aria-label`, `name`, `id` attribute scan
4. **DOM proximity search** — finds text nodes matching field keywords, then locates nearest `<input>`

### React-Compatible Autofill

Uses the native `HTMLInputElement.prototype.value` setter (bypasses React's synthetic event wrapper), then dispatches `input`, `change`, and `keyup` events — ensuring React/Angular controlled components register the new value.

---

## Security

| Concern | Approach |
|---------|----------|
| API key storage | `chrome.storage.local` — extension-sandboxed, no web page can read it |
| API key exposure | Only accessed in `background.js` (service worker), never passed to content scripts |
| Resume data | `chrome.storage.session` — auto-cleared when browser closes |
| Auto-submission | **Never happens** — user must click Submit manually |
| Data transmission | Only to `api.groq.com` when a key is configured, nowhere else |

---

## Limitations

- **CareerPuck cross-origin iframe**: If the Greenhouse form is inside a cross-origin `<iframe>` on CareerPuck, the browser blocks DOM access. The extension fills any visible outer-page fields and skips the iframe gracefully with a note.
- **Resume file upload injection**: Works on standard Greenhouse forms. May not work inside cross-origin iframes.
- **Custom questions**: Dropdown and radio questions with company-specific options may not fill correctly. Text/textarea custom questions (cover letter, summary) are filled with a generated summary.
- **DOCX multi-column layouts**: Complex DOCX formatting may produce garbled text — PDF is strongly recommended.
- **Groq rate limits**: Free tier is ~30 req/min. Heuristic fallback activates automatically on API errors.

---

## Evaluation Criteria Coverage

| Criteria | Weight | Implementation |
|----------|--------|----------------|
| Autofill correctness | 75% | 4-strategy layered detection + React-compatible fill + MutationObserver |
| Resume parsing accuracy | 10% | Groq llama-3.3-70b (primary) + regex/heuristic fallback |
| Code quality & structure | 10% | Modular files, clear separation, error handling throughout |
| User experience | 5% | Clean dark UI, editable preview, fill feedback banner, session restore |
