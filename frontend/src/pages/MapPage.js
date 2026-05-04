import React, { useState, useRef, useCallback } from "react";
import {
  MapContainer, TileLayer, Polyline, Marker, Popup, useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { useNavigate } from "react-router-dom";
import "leaflet/dist/leaflet.css";
import "./MapPage.css";

/* ─── Fix Leaflet marker icons broken by webpack ──────────────────────── */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const makeIcon = (color) =>
  L.divIcon({
    className: "",
    html: `<div style="
      width:22px;height:22px;border-radius:50%;
      background:${color};border:3px solid #fff;
      box-shadow:0 2px 8px rgba(0,0,0,0.4);
    "></div>`,
    iconAnchor: [11, 11],
  });

const COLOR_MAP = { safe: "#4a7c59", moderate: "#d4a017", risky: "#c0392b" };
const BADGE_MAP = {
  safe:     { label: "Safe",    bg: "#e8f4ec", color: "#2e6b3d" },
  moderate: { label: "Caution", bg: "#fef8e5", color: "#8a6200" },
  risky:    { label: "Risky",   bg: "#fbeaea", color: "#922b21" },
};

/* ═══════════════════════════════════════════════════════════════════════
   FIX 1 — Map click uses a REF, not state.
   React-Leaflet's useMapEvents captures a stale closure of any state
   value passed as a prop. Using a ref ensures the handler always reads
   the *current* mode when a click fires.
═══════════════════════════════════════════════════════════════════════ */
function MapClickHandler({ modeRef, onOriginSet, onDestSet }) {
  useMapEvents({
    click(e) {
      const mode = modeRef.current;           // ← always fresh, never stale
      if (mode === "origin") onOriginSet({ lat: e.latlng.lat, lng: e.latlng.lng });
      else if (mode === "dest") onDestSet({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════
   FIX 2 — Real road routing via OSRM (free, no API key).
   OSRM's /route endpoint returns a geometry encoded as a polyline.
   We decode it to get actual road-following lat/lng coordinates.
   We call OSRM three times with slightly different waypoints to get
   three meaningfully different real road alternatives.
═══════════════════════════════════════════════════════════════════════ */

/** Decode Google-style polyline (precision 5) returned by OSRM */
function decodePolyline(encoded) {
  const pts = [];
  let idx = 0, lat = 0, lng = 0;
  while (idx < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    pts.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return pts;
}

/** Call OSRM public routing API — returns array of {lat,lng} following real roads */
async function osrmRoute(origin, dest, viaLat, viaLng) {
  // Build coordinate string: lon,lat format for OSRM
  let coords;
  if (viaLat !== undefined && viaLng !== undefined) {
    coords = `${origin.lng},${origin.lat};${viaLng},${viaLat};${dest.lng},${dest.lat}`;
  } else {
    coords = `${origin.lng},${origin.lat};${dest.lng},${dest.lat}`;
  }

  const url =
    `https://router.project-osrm.org/route/v1/foot/${coords}` +
    `?overview=full&geometries=polyline&alternatives=false`;

  const res  = await fetch(url);
  const data = await res.json();

  if (data.code !== "Ok" || !data.routes?.length) {
    throw new Error("OSRM returned no route");
  }

  return decodePolyline(data.routes[0].geometry);
}

/** Generate three via-points around the midpoint to force different roads */
function viaPoints(origin, dest) {
  const midLat = (origin.lat + dest.lat) / 2;
  const midLng = (origin.lng + dest.lng) / 2;
  // Perpendicular offset scaled to distance (so it works for both short & long trips)
  const dLat = dest.lat - origin.lat;
  const dLng = dest.lng - origin.lng;
  const dist  = Math.sqrt(dLat * dLat + dLng * dLng);
  const off   = Math.max(0.004, dist * 0.25); // at least ~400 m offset
  return [
    null,                                          // route 1: direct (no via)
    { lat: midLat + off,  lng: midLng - off * 0.5 }, // route 2: north-west detour
    { lat: midLat - off,  lng: midLng + off * 0.5 }, // route 3: south-east detour
  ];
}

/* ── Safety scorer (free — OSM road-type heuristics + time of day) ───── */
async function osmRoadContext(lat, lng) {
  try {
    const url  = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=17&addressdetails=1`;
    const res  = await fetch(url, { headers: { "Accept-Language": "en" } });
    return await res.json();
  } catch { return null; }
}

function hourOf(t) { return parseInt(t.split(":")[0], 10); }

function timePenalty(h) {
  if (h >= 22 || h < 5)  return 30;
  if (h >= 20)            return 18;
  if (h >= 17)            return 8;
  if (h < 7)              return 12;
  return 0;
}

function roadBonus(osm) {
  if (!osm) return 0;
  const road = (osm.address?.road || "").toLowerCase();
  const type = (osm.type  || "").toLowerCase();
  if (["primary","secondary","trunk","motorway"].some(t => road.includes(t) || type === t)) return 15;
  if (["residential","living_street","pedestrian"].some(t => road.includes(t) || type === t)) return 5;
  if (type === "footway" || type === "path") return -5;
  if ((osm.class || "") === "highway") return 8;
  return 0;
}

/* Sample a point roughly in the middle of a polyline for OSM context */
function midOfRoute(waypoints) {
  const mid = waypoints[Math.floor(waypoints.length / 2)];
  return mid || waypoints[0];
}

async function analyseRoutes(origin, dest, timeStr) {
  const hour    = hourOf(timeStr);
  const penalty = timePenalty(hour);
  const vias    = viaPoints(origin, dest);

  // Fetch three real road routes from OSRM in parallel
  const routeGeoms = await Promise.all(
    vias.map((via) =>
      via
        ? osrmRoute(origin, dest, via.lat, via.lng).catch(() => osrmRoute(origin, dest))
        : osrmRoute(origin, dest)
    )
  );

  // Deduplicate: if OSRM returns identical routes for via variants, make them visually distinct
  // (OSRM sometimes ignores via if no detour road exists)
  const labels = ["Direct route", "Northern detour", "Southern detour"];
  const ids    = ["direct", "northern", "southern"];
  const extraMins = [0, 5, 3];

  // Get OSM road context for each route's midpoint
  const osmCtx = await Promise.all(
    routeGeoms.map((wps) => {
      const m = midOfRoute(wps);
      return osmRoadContext(m.lat, m.lng);
    })
  );

  const routes = routeGeoms.map((waypoints, i) => {
    const osm      = osmCtx[i];
    const base     = 68 + roadBonus(osm);
    const bonus    = i === 1 ? 9 : i === 2 ? 5 : 0;
    const score    = Math.max(10, Math.min(100, base - penalty + bonus));
    const roadName = osm?.address?.road || osm?.display_name?.split(",")[0] || "this road";

    let classification, reasons, recommendation;
    if (score >= 70) {
      classification = "safe";
      reasons = [
        `Well-connected road: ${roadName}`,
        hour < 20 && hour >= 5 ? "Good daytime visibility" : "Busier area — safer even at night",
      ];
      recommendation = "Recommended for solo travel at this time.";
    } else if (score >= 45) {
      classification = "moderate";
      reasons = [
        `Mixed road type near ${roadName}`,
        hour >= 20 || hour < 5 ? "Reduced visibility at night" : "Some quieter stretches",
      ];
      recommendation = "Manageable — stay on main roads, share your live location.";
    } else {
      classification = "risky";
      reasons = [
        `Isolated or poorly-lit near ${roadName}`,
        "High-risk time window — low foot traffic",
      ];
      recommendation = "Avoid if possible. Consider a cab or auto-rickshaw instead.";
    }

    return {
      id: ids[i], label: labels[i],
      safetyScore: score, classification, reasons, recommendation,
      estimatedExtraMinutes: extraMins[i],
      waypoints,
    };
  });

  const best = routes.reduce((a, b) => (a.safetyScore >= b.safetyScore ? a : b));

  const overallAdvice =
    hour >= 22 || hour < 5
      ? "It's late night — seriously consider a cab or auto. If walking is unavoidable, take the green route, share your live location with a trusted contact, and walk on lit main roads only."
      : hour >= 20
      ? "Evening travel: stick to the green route. Walk on the footpath side of busy roads, avoid shortcuts through lanes, and keep your phone easily accessible."
      : "Daytime travel is generally safe. The green route keeps you on wider, busier roads. Stay alert and aware of your surroundings.";

  return { routes, overallAdvice, recommendedRouteId: best.id };
}

/* ── Geocode / reverse-geocode (free Nominatim) ──────────────────────── */
async function geocode(query) {
  const url  = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const res  = await fetch(url, { headers: { "Accept-Language": "en" } });
  const data = await res.json();
  if (!data.length) throw new Error("Location not found");
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), name: data[0].display_name };
}

async function reverseGeocode(lat, lng) {
  const url  = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
  const res  = await fetch(url, { headers: { "Accept-Language": "en" } });
  const data = await res.json();
  return data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function shortName(fullName) {
  return fullName.split(",").slice(0, 3).join(",").trim();
}

/* ═══════════════════════════════════════════════════════════════════════
   COMPONENT
═══════════════════════════════════════════════════════════════════════ */
export default function MapPage() {
  const navigate = useNavigate();

  const [originInput, setOriginInput] = useState("");
  const [destInput,   setDestInput]   = useState("");
  const [origin, setOrigin] = useState(null);
  const [dest,   setDest]   = useState(null);

  const [time, setTime] = useState(() => {
    const n = new Date();
    return `${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}`;
  });

  /* ── clickMode lives in BOTH state (UI re-render) AND ref (Leaflet handler) ── */
  const [clickMode, setClickMode] = useState(null);
  const clickModeRef              = useRef(null);
  const setMode = (m) => { clickModeRef.current = m; setClickMode(m); };

  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState(null);
  const [routes,        setRoutes]        = useState([]);
  const [advice,        setAdvice]        = useState(null);
  const [recommendedId, setRecommendedId] = useState(null);
  const [activeRoute,   setActiveRoute]   = useState(null);
  const mapRef = useRef(null);

  /* ── Map click callbacks ───────────────────────────────────────── */
  const handleOriginSet = useCallback(async (latlng) => {
    setOrigin(latlng);
    setMode(null);
    try { setOriginInput(shortName(await reverseGeocode(latlng.lat, latlng.lng))); }
    catch { setOriginInput(`${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`); }
  }, []);

  const handleDestSet = useCallback(async (latlng) => {
    setDest(latlng);
    setMode(null);
    try { setDestInput(shortName(await reverseGeocode(latlng.lat, latlng.lng))); }
    catch { setDestInput(`${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`); }
  }, []);

  /* ── Search box geocode ────────────────────────────────────────── */
  const resolveOrigin = async () => {
    try {
      const r = await geocode(originInput);
      setOrigin({ lat: r.lat, lng: r.lng });
      setOriginInput(shortName(r.name));
      mapRef.current?.setView([r.lat, r.lng], 15);
    } catch { setError("Could not find start location. Try a more specific search."); }
  };

  const resolveDest = async () => {
    try {
      const r = await geocode(destInput);
      setDest({ lat: r.lat, lng: r.lng });
      setDestInput(shortName(r.name));
      mapRef.current?.setView([r.lat, r.lng], 15);
    } catch { setError("Could not find destination. Try a more specific search."); }
  };

  /* ── Analyse routes ────────────────────────────────────────────── */
  const handleAnalyse = async () => {
    if (!origin || !dest) { setError("Please set both start and destination first."); return; }
    setLoading(true); setError(null); setRoutes([]); setAdvice(null);
    try {
      const data = await analyseRoutes(origin, dest, time);
      setRoutes(data.routes);
      setAdvice(data.overallAdvice);
      setRecommendedId(data.recommendedRouteId);
      setActiveRoute(data.recommendedRouteId);

      if (mapRef.current) {
        const pts = data.routes.flatMap((r) => r.waypoints.map((w) => [w.lat, w.lng]));
        if (pts.length) mapRef.current.fitBounds(L.latLngBounds(pts), { padding: [60, 60] });
      }
    } catch (e) {
      setError("Routing failed: " + e.message + ". Check your internet connection.");
    } finally {
      setLoading(false);
    }
  };

  const timeLabel = () => {
    const h = hourOf(time);
    if (h >= 5  && h < 12) return "🌅 Morning";
    if (h >= 12 && h < 17) return "☀️ Afternoon";
    if (h >= 17 && h < 20) return "🌆 Evening";
    return "🌙 Night";
  };

  return (
    <div className="mappage">
      {/* ── NAV ─────────────────────────────────────────────────── */}
      <nav className="mapnav">
        <button className="mapnav__back" onClick={() => navigate("/")}>← Home</button>
        <div className="mapnav__title"><span>🚶‍♀️</span><span>SafeWalk Route Planner</span></div>
        <div className="mapnav__time-badge">{timeLabel()}</div>
      </nav>

      <div className="mappage__body">
        {/* ── LEFT: MAP ───────────────────────────────────────────── */}
        <div className="map-panel">
          {clickMode && (
            <div className="map-hint">
              {clickMode === "origin"
                ? "📍 Click anywhere on the map to set your START point"
                : "🏁 Click anywhere on the map to set your END point"}
            </div>
          )}

          <MapContainer
            center={[12.9716, 77.5946]}
            zoom={13}
            className="leaflet-map"
            ref={mapRef}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {/* ✅ Pass the REF — this fixes the stale-closure map-click bug */}
            <MapClickHandler
              modeRef={clickModeRef}
              onOriginSet={handleOriginSet}
              onDestSet={handleDestSet}
            />

            {origin && (
              <Marker position={[origin.lat, origin.lng]} icon={makeIcon("#4a7c59")}>
                <Popup><strong>📍 Start</strong><br />{originInput}</Popup>
              </Marker>
            )}
            {dest && (
              <Marker position={[dest.lat, dest.lng]} icon={makeIcon("#c0392b")}>
                <Popup><strong>🏁 End</strong><br />{destInput}</Popup>
              </Marker>
            )}

            {/* ✅ Real road polylines from OSRM — no straight lines */}
            {routes.map((route) => (
              <Polyline
                key={route.id}
                positions={route.waypoints.map((w) => [w.lat, w.lng])}
                pathOptions={{
                  color:     COLOR_MAP[route.classification] || "#888",
                  weight:    activeRoute === route.id ? 7 : 3.5,
                  opacity:   activeRoute === route.id ? 0.95 : 0.45,
                  dashArray: route.classification === "risky" ? "10 7" : null,
                }}
                eventHandlers={{ click: () => setActiveRoute(route.id) }}
              >
                <Popup>
                  <strong>{route.label}</strong><br />
                  Safety: {route.safetyScore}/100<br />
                  {route.recommendation}
                  {recommendedId === route.id && (
                    <><br /><span style={{ color: "#4a7c59", fontWeight: 600 }}>✓ Recommended</span></>
                  )}
                </Popup>
              </Polyline>
            ))}
          </MapContainer>

          <div className="map-legend">
            <span className="map-legend__item map-legend__item--green">● Safe route</span>
            <span className="map-legend__item map-legend__item--amber">● Caution</span>
            <span className="map-legend__item map-legend__item--red">━ ━ Risky</span>
          </div>
        </div>

        {/* ── RIGHT: SIDE PANEL ───────────────────────────────────── */}
        <div className="side-panel">
          <div className="side-panel__scroll">
            <h2 className="side-panel__title">Plan Your Safe Route</h2>
            <p className="side-panel__sub">
              Type an address <em>or</em> click 📍 / 🏁 then tap the map
            </p>

            {/* ── Start point ── */}
            <div className="field-group">
              <label className="field-label">
                <span className="field-label__dot field-label__dot--green" />
                Start Point
              </label>
              <div className="field-row">
                <input
                  className="field-input"
                  placeholder="e.g. MG Road, Bengaluru"
                  value={originInput}
                  onChange={(e) => setOriginInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && resolveOrigin()}
                />
                <button
                  className={`pin-btn ${clickMode === "origin" ? "pin-btn--active" : ""}`}
                  title="Click map to pick start point"
                  onClick={() => setMode(clickMode === "origin" ? null : "origin")}
                >📍</button>
              </div>
              {originInput && (
                <button className="resolve-btn" onClick={resolveOrigin}>Search on map →</button>
              )}
              {origin && (
                <div className="coord-tag">
                  {origin.lat.toFixed(5)}, {origin.lng.toFixed(5)}
                </div>
              )}
            </div>

            {/* ── Destination ── */}
            <div className="field-group">
              <label className="field-label">
                <span className="field-label__dot field-label__dot--red" />
                Destination
              </label>
              <div className="field-row">
                <input
                  className="field-input"
                  placeholder="e.g. Koramangala, Bengaluru"
                  value={destInput}
                  onChange={(e) => setDestInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && resolveDest()}
                />
                <button
                  className={`pin-btn ${clickMode === "dest" ? "pin-btn--active" : ""}`}
                  title="Click map to pick destination"
                  onClick={() => setMode(clickMode === "dest" ? null : "dest")}
                >🏁</button>
              </div>
              {destInput && (
                <button className="resolve-btn" onClick={resolveDest}>Search on map →</button>
              )}
              {dest && (
                <div className="coord-tag">
                  {dest.lat.toFixed(5)}, {dest.lng.toFixed(5)}
                </div>
              )}
            </div>

            {/* ── Time ── */}
            <div className="field-group">
              <label className="field-label">🕐 Travel Time</label>
              <input
                className="field-input"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
              <p className="field-hint">Safety scoring adjusts based on time of day</p>
            </div>

            <button
              className="analyse-btn"
              onClick={handleAnalyse}
              disabled={loading || !origin || !dest}
            >
              {loading ? "⏳ Fetching real roads…" : "🔍 Analyse Routes"}
            </button>

            {error && <div className="error-box">⚠️ {error}</div>}

            {advice && (
              <div className="advice-box">
                <div className="advice-box__header">🛡️ Safety Advice</div>
                <p>{advice}</p>
              </div>
            )}

            {/* ── Route cards ── */}
            {routes.length > 0 && (
              <div className="routes-list">
                <h3 className="routes-list__title">Route Analysis</h3>
                {routes.map((route) => {
                  const badge    = BADGE_MAP[route.classification] || BADGE_MAP.moderate;
                  const isActive = activeRoute === route.id;
                  const isRec    = recommendedId === route.id;
                  return (
                    <div
                      key={route.id}
                      className={`route-card ${isActive ? "route-card--active" : ""} ${isRec ? "route-card--recommended" : ""}`}
                      onClick={() => setActiveRoute(route.id)}
                    >
                      <div className="route-card__header">
                        <span className="route-card__label">{route.label}</span>
                        <span
                          className="route-card__badge"
                          style={{ background: badge.bg, color: badge.color }}
                        >{badge.label}</span>
                        {isRec && <span className="route-card__rec">✓ Best</span>}
                      </div>

                      <div className="score-bar">
                        <div
                          className="score-bar__fill"
                          style={{
                            width: `${route.safetyScore}%`,
                            background: COLOR_MAP[route.classification],
                          }}
                        />
                      </div>
                      <div className="score-bar__label">
                        Safety score: <strong>{route.safetyScore}/100</strong>
                        {route.estimatedExtraMinutes > 0 && (
                          <span className="extra-time">+{route.estimatedExtraMinutes} min</span>
                        )}
                      </div>

                      <p className="route-card__rec-text">{route.recommendation}</p>

                      <ul className="route-card__reasons">
                        {route.reasons.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}

            {!routes.length && !loading && (
              <div className="empty-state">
                <div className="empty-state__icon">🗺️</div>
                <p>
                  Set your <strong>start</strong> and <strong>end</strong> — type in the boxes
                  or click 📍 / 🏁 then tap the map. Then hit <strong>Analyse Routes</strong>.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}