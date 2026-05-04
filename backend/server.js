require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Middleware ────────────────────────────────────────────────────────────
app.use(cors({ origin: "http://localhost:3000" }));
app.use(express.json());

// ─── Anthropic client ─────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Helper: build candidate routes from two lat/lng points ───────────────
// In production you'd call OSRM / Google Directions API here.
// For the demo we generate 3 "conceptual" routes by slightly perturbing
// the straight-line midpoints so Leaflet draws visually distinct polylines.
function buildCandidateRoutes(origin, destination) {
  const midLat = (origin.lat + destination.lat) / 2;
  const midLng = (origin.lng + destination.lng) / 2;

  // Three routes: direct, northern detour, southern detour
  return [
    {
      id: "direct",
      label: "Direct route",
      waypoints: [origin, { lat: midLat, lng: midLng }, destination],
    },
    {
      id: "northern",
      label: "Northern detour",
      waypoints: [
        origin,
        { lat: midLat + 0.008, lng: midLng - 0.004 },
        { lat: midLat + 0.005, lng: midLng + 0.005 },
        destination,
      ],
    },
    {
      id: "southern",
      label: "Southern detour",
      waypoints: [
        origin,
        { lat: midLat - 0.006, lng: midLng - 0.006 },
        { lat: midLat - 0.003, lng: midLng + 0.006 },
        destination,
      ],
    },
  ];
}

// ─── POST /api/analyze-routes ─────────────────────────────────────────────
app.post("/api/analyze-routes", async (req, res) => {
  try {
    const { origin, destination, time, originName, destinationName } = req.body;

    if (!origin || !destination || !time) {
      return res.status(400).json({ error: "origin, destination, and time are required." });
    }

    const routes = buildCandidateRoutes(origin, destination);

    // ── Ask Claude to score each route for safety ──────────────────────────
    const prompt = `
You are a women's safety expert for urban navigation. Analyze the following 3 candidate walking routes 
and score each for safety considering the travel time and urban context.

Travel details:
- Origin: ${originName || `${origin.lat.toFixed(4)}, ${origin.lng.toFixed(4)}`}
- Destination: ${destinationName || `${destination.lat.toFixed(4)}, ${destination.lng.toFixed(4)}`}
- Time of day: ${time}
- City context: Urban/semi-urban area

Routes:
1. Direct route – goes straight between the two points via main road/midpoint
2. Northern detour – takes a slightly longer path through the northern part of the area
3. Southern detour – takes a slightly longer path through the southern part of the area

For each route, provide a JSON response with this exact structure (no markdown, raw JSON only):
{
  "routes": [
    {
      "id": "direct",
      "safetyScore": <number 0-100>,
      "classification": "<safe|moderate|risky>",
      "reasons": ["<reason1>", "<reason2>"],
      "recommendation": "<one sentence>",
      "estimatedExtraMinutes": 0
    },
    {
      "id": "northern",
      "safetyScore": <number 0-100>,
      "classification": "<safe|moderate|risky>",
      "reasons": ["<reason1>", "<reason2>"],
      "recommendation": "<one sentence>",
      "estimatedExtraMinutes": <number>
    },
    {
      "id": "southern",
      "safetyScore": <number 0-100>,
      "classification": "<safe|moderate|risky>",
      "reasons": ["<reason1>", "<reason2>"],
      "recommendation": "<one sentence>",
      "estimatedExtraMinutes": <number>
    }
  ],
  "overallAdvice": "<2-3 sentence safety advice for this specific time and journey>",
  "recommendedRouteId": "<id of the safest route>"
}

Base your scoring on:
- Time of day (night/late evening = higher risk on isolated routes)
- Route type (main roads = safer, detours may pass isolated areas)
- General urban safety principles for women walking alone
Be realistic and vary the scores meaningfully. If time is night (after 8pm or before 6am), apply stricter scoring.
`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = message.content[0].text.trim();

    // Strip any accidental markdown fences
    const jsonText = rawText.replace(/```json|```/g, "").trim();
    const analysis = JSON.parse(jsonText);

    // Attach waypoints to each route result so the frontend can draw them
    const enrichedRoutes = analysis.routes.map((r) => {
      const candidate = routes.find((c) => c.id === r.id);
      return { ...r, waypoints: candidate ? candidate.waypoints : [] };
    });

    return res.json({
      routes: enrichedRoutes,
      overallAdvice: analysis.overallAdvice,
      recommendedRouteId: analysis.recommendedRouteId,
    });
  } catch (err) {
    console.error("Error analyzing routes:", err);
    return res.status(500).json({ error: "Failed to analyze routes. " + err.message });
  }
});

// ─── Health check ──────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => console.log(`✅  SafeWalk backend running on http://localhost:${PORT}`));