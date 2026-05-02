async function extractTextFromPDF(arrayBuffer) {
  const pdfjsLib = window["pdfjs-dist/build/pdf"];
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
    "libs/pdf.worker.min.js",
  );
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    fullText += content.items.map((item) => item.str).join(" ") + "\n";
  }
  return fullText.trim();
}

async function extractTextFromDOCX(arrayBuffer) {
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value.trim();
}

async function extractTextFromFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "pdf") return extractTextFromPDF(arrayBuffer);
  if (ext === "docx" || ext === "doc") return extractTextFromDOCX(arrayBuffer);
  throw new Error("Unsupported file type. Please upload PDF or DOCX.");
}

function extractSection(text, headings) {
  const allHeadings = [
    "experience",
    "education",
    "skills",
    "projects",
    "certifications",
    "awards",
    "publications",
    "summary",
    "objective",
    "references",
    "languages",
    "interests",
    "activities",
    "volunteer",
    "technical",
    "work history",
  ];
  const lines = text.split("\n");
  let capturing = false,
    sectionLines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim().toLowerCase();
    if (!capturing) {
      if (
        headings.some(
          (h) =>
            line === h || line.startsWith(h + " ") || line.startsWith(h + ":"),
        )
      ) {
        capturing = true;
        continue;
      }
    } else {
      const isNew = allHeadings.some(
        (h) => line.startsWith(h) && !headings.some((t) => line.includes(t)),
      );
      if (isNew && sectionLines.length > 1) break;
      sectionLines.push(lines[i]);
    }
  }
  return sectionLines.join("\n").trim();
}

function parseEducation(text) {
  if (!text) return [];
  const entries = [];
  const blocks = text.split(/\n{2,}/);
  for (const block of blocks) {
    if (block.trim().length < 5) continue;
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) continue;
    const degreeRx =
      /bachelor|master|phd|b\.?s\.?|m\.?s\.?|b\.?e\.?|m\.?e\.?|b\.?tech|m\.?tech|diploma|associate|doctorate/i;
    const years = block.match(/\b(19|20)\d{2}\b/g);
    entries.push({
      institution: lines[0] || "",
      degree: lines.find((l) => degreeRx.test(l)) || lines[1] || "",
      year: years ? years[years.length - 1] : "",
    });
    if (entries.length >= 5) break;
  }
  return entries;
}

function parseExperience(text) {
  if (!text) return [];
  const entries = [];
  const blocks = text.split(/\n{2,}/);
  for (const block of blocks) {
    if (block.trim().length < 10) continue;
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) continue;
    const years = block.match(/\b(19|20)\d{2}\b/g);
    const dates = block.match(
      /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,]+\d{4}/gi,
    );
    entries.push({
      company: lines[0] || "",
      title: lines[1] || "",
      duration: dates ? dates.join(" – ") : years ? years.join(" – ") : "",
      description: lines.slice(2).join(" ").substring(0, 300),
    });
    if (entries.length >= 8) break;
  }
  return entries;
}

function parseWithHeuristics(text) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const emailMatch = text.match(
    /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/,
  );
  const phoneMatch = text.match(/(\+?[\d][\d\s\-().]{7,}[\d])/);
  const linkedinMatch = text.match(/linkedin\.com\/in\/([^\s,|<>\n/]+)/i);
  const githubMatch = text.match(/github\.com\/([^\s,|<>\n/]+)/i);
  const portfolioMatch = text.match(
    /https?:\/\/(?!.*linkedin)(?!.*github)[a-zA-Z0-9\-.]+\.[a-zA-Z]{2,}[^\s]*/i,
  );

  let name = "";
  for (const line of lines.slice(0, 8)) {
    const cleaned = line.replace(/[^a-zA-Z\s.',-]/g, "").trim();
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (
      words.length >= 2 &&
      words.length <= 5 &&
      !line.includes("@") &&
      !/\d/.test(line)
    ) {
      name = cleaned;
      break;
    }
  }

  const locationMatch = text.match(
    /([A-Z][a-zA-Z\s]+),\s*([A-Z]{2}|[A-Z][a-zA-Z\s]+)/,
  );
  const skillsSection = extractSection(text, [
    "skills",
    "technical skills",
    "core competencies",
    "technologies",
  ]);
  const skills = skillsSection
    ? skillsSection
        .split(/[,|•\n\t\/]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 1 && s.length < 50 && !/^\d+$/.test(s))
        .slice(0, 30)
    : [];

  return {
    name,
    email: emailMatch ? emailMatch[0] : "",
    phone: phoneMatch ? phoneMatch[0].replace(/\s+/g, " ").trim() : "",
    location: locationMatch ? locationMatch[0].trim() : "",
    education: parseEducation(
      extractSection(text, [
        "education",
        "academic background",
        "qualifications",
      ]),
    ),
    experience: parseExperience(
      extractSection(text, [
        "experience",
        "work experience",
        "employment",
        "professional experience",
        "work history",
      ]),
    ),
    skills,
    links: {
      linkedin: linkedinMatch
        ? `https://linkedin.com/in/${linkedinMatch[1]}`
        : "",
      github: githubMatch ? `https://github.com/${githubMatch[1]}` : "",
      portfolio: portfolioMatch ? portfolioMatch[0] : "",
    },
    _rawText: text,
  };
}

async function parseWithGroq(rawText, apiKey) {
  const prompt = `You are a resume parser. Extract structured information and return ONLY valid JSON, no markdown.

Return exactly:
{"name":"","email":"","phone":"","location":"","education":[{"institution":"","degree":"","year":""}],"experience":[{"company":"","title":"","duration":"","description":""}],"skills":[],"links":{"linkedin":"","github":"","portfolio":""}}

Resume:
${rawText.substring(0, 6000)}`;

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 1500,
      }),
    },
  );

  if (!response.ok) throw new Error(`Groq API error: ${response.status}`);
  const data = await response.json();
  const raw = data.choices[0].message.content
    .trim()
    .replace(/^```json?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(raw);
}

async function parseResume(file, groqApiKey = null) {
  const rawText = await extractTextFromFile(file);
  let parsed;

  if (groqApiKey) {
    try {
      parsed = await parseWithGroq(rawText, groqApiKey);
      parsed._rawText = rawText;
      parsed._source = "groq";
    } catch (err) {
      console.warn("Groq failed, using heuristics:", err.message);
      parsed = parseWithHeuristics(rawText);
      parsed._source = "heuristics";
    }
  } else {
    parsed = parseWithHeuristics(rawText);
    parsed._source = "heuristics";
  }

  parsed.name = parsed.name || "";
  parsed.email = parsed.email || "";
  parsed.phone = parsed.phone || "";
  parsed.location = parsed.location || "";
  parsed.education = parsed.education || [];
  parsed.experience = parsed.experience || [];
  parsed.skills = parsed.skills || [];
  parsed.links = parsed.links || {};
  parsed.links.linkedin = parsed.links.linkedin || "";
  parsed.links.github = parsed.links.github || "";
  parsed.links.portfolio = parsed.links.portfolio || "";
  return parsed;
}
