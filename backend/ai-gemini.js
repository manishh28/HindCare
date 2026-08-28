const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
let discoveredModel = null;

async function findAvailableModel(apiKey, requestedModel) {
  if (discoveredModel) return discoveredModel;

  try {
    const response = await fetch(GEMINI_ENDPOINT, {
      headers: { "x-goog-api-key": apiKey }
    });
    if (!response.ok) return requestedModel;

    const data = await response.json();
    const models = Array.isArray(data.models) ? data.models : [];
    const usable = models
      .filter(model => model.supportedGenerationMethods?.includes("generateContent"))
      .map(model => String(model.name || "").replace(/^models\//, ""));

    const preferred = [requestedModel, "gemini-3.6-flash", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
    discoveredModel = preferred.find(model => usable.includes(model)) || usable.find(model => /flash/i.test(model)) || null;
    return discoveredModel || requestedModel;
  } catch {
    return requestedModel;
  }
}

async function askGemini(message) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const requestedModel = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    let model = requestedModel;
    let response = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{
            text: [
              "You are HindCare's website support assistant.",
              "Answer briefly and clearly for a person who may be stressed.",
              "You may explain HindCare features, booking status, hospital information, and support steps.",
              "Never diagnose a medical condition, promise an ambulance, invent live availability, or claim to contact emergency services.",
              "For a life-threatening emergency, tell the user to call their local emergency number immediately.",
              "Use only information provided in the user's message; do not invent hospital, driver, booking, or GPS data."
            ].join(" ")
          }]
        },
        contents: [{
          role: "user",
          parts: [{ text: String(message || "").slice(0, 2000) }]
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 180
        }
      }),
      signal: controller.signal
    });

    if (response.status === 404) {
      model = await findAvailableModel(apiKey, requestedModel);
      if (model !== requestedModel) {
        response = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify({
            system_instruction: {
              parts: [{ text: "You are HindCare's brief, safe website support assistant. Do not diagnose, promise live ambulance availability, or invent booking/GPS data. For life-threatening emergencies, advise calling local emergency services." }]
            },
            contents: [{ role: "user", parts: [{ text: String(message || "").slice(0, 2000) }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 180 }
          }),
          signal: controller.signal
        });
      }
    }

    if (!response.ok) {
      const detail = await response.text();
      console.error("Gemini request failed with status:", response.status, detail.slice(0, 500));
      return null;
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();
    return text || null;
  } catch (error) {
    console.error("Gemini request failed:", error.name === "AbortError" ? "timeout" : error.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { askGemini };
