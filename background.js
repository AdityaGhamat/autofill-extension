chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "TRIGGER_AUTOFILL") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!tab?.id) {
          sendResponse({ success: false, error: "No active tab." });
          return;
        }

        chrome.webNavigation.getAllFrames({ tabId: tab.id }, (frames) => {
          let responsesReceived = 0;
          let aggregatedResults = { filled: [], skipped: [], errors: [] };

          frames.forEach((frame) => {
            chrome.tabs.sendMessage(
              tab.id,
              {
                action: "AUTOFILL",
                data: message.resumeData,
                resumeFile: message.resumeFile,
                aiAnswers: message.aiAnswers, // <-- NEW: Passing AI answers
              },
              { frameId: frame.frameId },
              (response) => {
                responsesReceived++;
                if (
                  response &&
                  response.success &&
                  response.result.filled.length > 0
                ) {
                  aggregatedResults = response.result;
                }
                if (responsesReceived === frames.length) {
                  sendResponse({ success: true, result: aggregatedResults });
                }
              },
            );
          });
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // 2. NEW: Relay the Scrape command to all frames to find custom questions
  if (message.action === "SCRAPE_QUESTIONS") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        chrome.webNavigation.getAllFrames({ tabId: tab.id }, (frames) => {
          let responsesReceived = 0;
          let allQuestions = [];
          frames.forEach((frame) => {
            chrome.tabs.sendMessage(
              tab.id,
              { action: "SCRAPE_QUESTIONS" },
              { frameId: frame.frameId },
              (response) => {
                responsesReceived++;
                if (response && response.success && response.questions) {
                  allQuestions = allQuestions.concat(response.questions);
                }
                if (responsesReceived === frames.length) {
                  // Return unique questions
                  sendResponse({
                    success: true,
                    questions: [...new Set(allQuestions)],
                  });
                }
              },
            );
          });
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // 3. Existing Storage/Check code
  if (message.action === "CHECK_TAB") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        const url = tab?.url || "";
        const supported =
          url.includes("greenhouse.io") || url.includes("careerpuck.com");
        sendResponse({ supported, url });
      } catch {
        sendResponse({ supported: false, url: "" });
      }
    })();
    return true;
  }

  if (message.action === "SAVE_API_KEY") {
    chrome.storage.local.set({ groqApiKey: message.key }, () =>
      sendResponse({ success: true }),
    );
    return true;
  }
  if (message.action === "GET_API_KEY") {
    chrome.storage.local.get(["groqApiKey"], (r) =>
      sendResponse({ key: r.groqApiKey || "" }),
    );
    return true;
  }
  if (message.action === "CLEAR_API_KEY") {
    chrome.storage.local.remove("groqApiKey", () =>
      sendResponse({ success: true }),
    );
    return true;
  }
  if (message.action === "SAVE_RESUME_DATA") {
    chrome.storage.local.set(
      {
        resumeData: message.data,
        resumeFile: message.file,
      },
      () => sendResponse({ success: true }),
    );
    return true;
  }
  if (message.action === "GET_RESUME_DATA") {
    chrome.storage.local.get(["resumeData", "resumeFile"], (r) =>
      sendResponse({ data: r.resumeData || null, file: r.resumeFile || null }),
    );
    return true;
  }
  if (message.action === "CLEAR_RESUME_DATA") {
    chrome.storage.local.remove(["resumeData", "resumeFile"], () =>
      sendResponse({ success: true }),
    );
    return true;
  }
});
