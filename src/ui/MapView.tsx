"use client";

import { useMemo, useRef, useState } from "react";
import { NETWORK, fmt, type Closure, type SimResult } from "@/engine";

// Equirectangular projection around India, scaled by cos(latitude) so distances look right.
const LNG0 = 69.5;
const LNG1 = 95;
const LAT0 = 7;
const LAT1 = 32;
const K = 15; // about one SVG unit per screen pixel at the usual map size, so text stays legible
const KX = Math.cos((20 * Math.PI) / 180) * K;
const W = (LNG1 - LNG0) * KX;
const H = (LAT1 - LAT0) * K;
const px = (lng: number) => (lng - LNG0) * KX;
const py = (lat: number) => (LAT1 - lat) * K;

const AIRPORTS = NETWORK.airports.map((a) => ({ ...a, x: px(a.lng), y: py(a.lat) }));
const AP = new Map(AIRPORTS.map((a) => [a.id, a]));
const SPARES = new Set(NETWORK.spares.map((s) => s.tail));

// Label offsets so nearby labels do not collide (BOM/PNQ, DEL/JAI, BLR/COK/TRV).
const LABEL_DX: Record<string, [number, number]> = {
  BOM: [-30, 0], PNQ: [7, 11], GOI: [-28, 4], AMD: [-30, 4], DEL: [8, -5], JAI: [-27, 10], IXC: [8, -2],
  LKO: [8, 4], BLR: [-29, 6], MAA: [8, 4], COK: [-30, 4], TRV: [8, 6], HYD: [8, -5], CCU: [8, 4], BBI: [8, 8], GAU: [8, 4],
};

const radiusFor = (mins: number) => 10 + mins / 8;
const minsFor = (r: number) => Math.max(10, Math.min(360, Math.round(((r - 10) * 8) / 5) * 5));

interface Props {
  closures: Closure[];
  result: SimResult;
  clock: number;
  selected: string | null;
  pathFlights: Set<string>;
  onSelect: (id: string) => void;
  onChangeClosures: (c: Closure[]) => void;
}

type Drag = { index: number; mode: "move" | "resize"; x: number; y: number; r: number } | null;

export function MapView({ closures, result, clock, selected, pathFlights, onSelect, onChangeClosures }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag>(null);

  const toSvg = (e: React.PointerEvent) => {
    const pt = svg.current!.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(svg.current!.getScreenCTM()!.inverse());
  };

  // One line per airport pair; style by the worst status of its flights.
  const routes = useMemo(() => {
    const m = new Map<string, { a: string; b: string; status: "ok" | "late" | "cancelled"; path: boolean; flights: string[] }>();
    for (const f of NETWORK.flights) {
      const key = [f.origin, f.destination].sort().join("-");
      const s = result.flights[f.id];
      const st = s.status === "cancelled" ? "cancelled" : s.status === "late" ? "late" : "ok";
      const cur = m.get(key) ?? { a: f.origin, b: f.destination, status: "ok" as const, path: false, flights: [] };
      const rank = { ok: 0, late: 1, cancelled: 2 };
      m.set(key, {
        ...cur,
        status: rank[st] > rank[cur.status] ? st : cur.status,
        path: cur.path || pathFlights.has(f.id) || selected === f.id,
        flights: [...cur.flights, f.id],
      });
    }
    return [...m.values()].sort((x, y) => Number(x.path) - Number(y.path) || ["ok", "late", "cancelled"].indexOf(x.status) - ["ok", "late", "cancelled"].indexOf(y.status));
  }, [result, pathFlights, selected]);

  // Aircraft in the air at the current clock time.
  const planes = useMemo(() => {
    const out: { id: string; x: number; y: number; angle: number; cls: string; label: string }[] = [];
    for (const f of NETWORK.flights) {
      const s = result.flights[f.id];
      if (s.status === "cancelled" || clock < s.dep || clock >= s.arr) continue;
      const a = AP.get(f.origin)!;
      const b = AP.get(f.destination)!;
      const t = (clock - s.dep) / (s.arr - s.dep);
      out.push({
        id: f.id,
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
        cls: SPARES.has(s.tail) ? "plane spare" : s.delay > 0 ? "plane late" : "plane",
        label: `${f.id} ${f.origin} to ${f.destination}, ${s.delay > 0 ? `${s.delay} minutes late` : "on time"}`,
      });
    }
    return out;
  }, [result, clock]);

  // Aircraft waiting at their origin because their destination is closed (at the current clock time).
  const holds = useMemo(() => {
    const out: { id: string; from: string; to: string }[] = [];
    for (const f of NETWORK.flights) {
      const s = result.flights[f.id];
      if (s.cause?.kind === "closure_arrival" && clock >= f.dep && clock < s.dep) out.push({ id: f.id, from: f.origin, to: f.destination });
    }
    return out;
  }, [result, clock]);

  const closedAt = new Set(closures.map((c) => c.airport));

  const addStormAt = (airport: string) => {
    if (closedAt.has(airport) || closures.length >= 4) return;
    const start = Math.max(300, Math.min(1320, Math.round(clock / 15) * 15));
    onChangeClosures([...closures, { airport, start, end: start + 90 }]);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toSvg(e);
    if (drag.mode === "move") setDrag({ ...drag, x: p.x, y: p.y });
    else {
      const c = closures[drag.index];
      const a = AP.get(c.airport)!;
      setDrag({ ...drag, r: Math.max(11, Math.min(55, Math.hypot(p.x - a.x, p.y - a.y))) });
    }
  };
  const onPointerUp = () => {
    if (!drag) return;
    const c = closures[drag.index];
    if (drag.mode === "move") {
      let best: string | null = null;
      let bestD = 24;
      for (const a of AIRPORTS) {
        const d = Math.hypot(a.x - drag.x, a.y - drag.y);
        if (d < bestD && (a.id === c.airport || !closedAt.has(a.id))) {
          best = a.id;
          bestD = d;
        }
      }
      if (best && best !== c.airport) onChangeClosures(closures.map((x, i) => (i === drag.index ? { ...x, airport: best! } : x)));
    } else {
      const mins = minsFor(drag.r);
      if (mins !== c.end - c.start) onChangeClosures(closures.map((x, i) => (i === drag.index ? { ...x, end: x.start + mins } : x)));
    }
    setDrag(null);
  };

  const grat = [];
  for (let lng = 70; lng <= 94; lng += 4) grat.push(<line key={`v${lng}`} className="grat" x1={px(lng)} x2={px(lng)} y1={0} y2={H} />);
  for (let lat = 8; lat <= 32; lat += 4) grat.push(<line key={`h${lat}`} className="grat" x1={0} x2={W} y1={py(lat)} y2={py(lat)} />);

  return (
    <div className="map-wrap">
      <svg
        ref={svg}
        viewBox={`-10 -10 ${W + 20} ${H + 20}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label="Route map. Each airport is a button that closes it for ninety minutes."
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <defs>
          <pattern id="storm-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="rgba(245,247,246,0.75)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#17212B" strokeWidth="1.6" />
          </pattern>
        </defs>
        {grat}
        {[8, 16, 24].map((lat) => (
          <text key={`lt${lat}`} className="grat-label" x={4} y={py(lat) - 3}>
            {lat}°N
          </text>
        ))}
        {[74, 82, 90].map((lng) => (
          <text key={`ln${lng}`} className="grat-label" x={px(lng) + 3} y={H - 4}>
            {lng}°E
          </text>
        ))}

        {routes.map((r) => {
          const a = AP.get(r.a)!;
          const b = AP.get(r.b)!;
          // A gentle curve, bending the same way for both directions.
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const bend = Math.min(14, len * 0.12);
          const cx = mx - (dy / len) * bend;
          const cy = my + (dx / len) * bend;
          return (
            <path
              key={`${r.a}-${r.b}`}
              className={`route ${r.status === "ok" ? "" : r.status} ${r.path ? "path" : ""}`}
              d={`M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`}
            />
          );
        })}

        {holds.map((h) => {
          const a = AP.get(h.from)!;
          const b = AP.get(h.to)!;
          return (
            <g key={`hold-${h.id}`}>
              <line className="hold-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
              <circle className="hold-mark" cx={a.x} cy={a.y} r={8} />
            </g>
          );
        })}

        {AIRPORTS.map((a) => {
          const [dx, dy] = LABEL_DX[a.id] ?? [8, 4];
          const closed = closedAt.has(a.id);
          return (
            <g
              key={a.id}
              className={`apt ${a.tier !== "spoke" ? "hub" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={closed ? `${a.city} (${a.id}), closed` : `Close ${a.city} (${a.id}) for ninety minutes`}
              onClick={() => addStormAt(a.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  addStormAt(a.id);
                }
              }}
            >
              <title>{`${a.name}, ${a.city}${closed ? " (closed)" : ". Click to close it for 90 minutes."}`}</title>
              <circle className="dot" cx={a.x} cy={a.y} r={a.tier === "mega_hub" ? 6 : a.tier === "regional_hub" ? 5 : 4} />
              <text x={a.x + dx} y={a.y + dy}>
                {a.id}
              </text>
            </g>
          );
        })}

        {closures.map((c, i) => {
          const a = AP.get(c.airport)!;
          const moving = drag?.index === i && drag.mode === "move";
          const resizing = drag?.index === i && drag.mode === "resize";
          const x = moving ? drag!.x : a.x;
          const y = moving ? drag!.y : a.y;
          const r = resizing ? drag!.r : radiusFor(c.end - c.start);
          const mins = resizing ? minsFor(r) : c.end - c.start;
          const label = `${c.airport} closed ${fmt(c.start)}–${fmt(c.start + mins)}`;
          return (
            <g key={`storm-${i}`}>
              <circle className="storm-ring" cx={x} cy={y} r={r + 6} />
              <g
                className="storm-cell"
                onPointerDown={(e) => {
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  const p = toSvg(e);
                  setDrag({ index: i, mode: "move", x: p.x, y: p.y, r });
                }}
              >
                <title>Drag this storm onto another airport</title>
                <circle className="storm-body" cx={x} cy={y} r={r} />
              </g>
              <circle
                className="storm-handle"
                cx={x + r}
                cy={y}
                r={7}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  setDrag({ index: i, mode: "resize", x, y, r });
                }}
              >
                <title>Drag to change how long the airport is closed</title>
              </circle>
              {(() => {
                // A compact pill directly above the storm: clear of the neighbouring airport labels
                // (PNQ, HYD, COK, GOI sit beside or below their hubs). The exact window is on hover.
                const PW = 62;
                const tx = Math.max(-6, Math.min(W - PW + 6, x - PW / 2));
                const ty = y - r - 19;
                return (
                  <g className="storm-tag" transform={`translate(${tx}, ${ty})`}>
                    <title>{`${AP.get(c.airport)!.city} (${c.airport}) ${label.replace(`${c.airport} closed`, "closed")} IST`}</title>
                    <rect width={PW} height="15" rx="7.5" />
                    <text x={PW / 2} y="11" textAnchor="middle">
                      {c.airport} closed
                    </text>
                  </g>
                );
              })()}
            </g>
          );
        })}

        {planes.map((p) => (
          <g key={p.id} transform={`translate(${p.x},${p.y}) rotate(${p.angle})`} onClick={() => onSelect(p.id)} style={{ cursor: "pointer" }}>
            <title>{p.label}</title>
            <path className={p.cls} d="M7,0 L-5,-4.5 L-3,0 L-5,4.5 Z" />
          </g>
        ))}
      </svg>
      <div className="map-legend">
        <span>
          <svg width="22" height="14" aria-hidden="true">
            <circle cx="8" cy="7" r="6" fill="url(#storm-hatch)" stroke="#17212B" strokeWidth="1.2" />
            <circle cx="15" cy="7" r="2.5" fill="#fff" stroke="#17212B" strokeWidth="1.2" />
          </svg>
          <b style={{ fontWeight: 600 }}>Storm: drag it; pull its handle</b>
        </span>
        <span aria-hidden="true">
          <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#B7C2BD" strokeWidth="1.5" /></svg>On time
        </span>
        <span aria-hidden="true">
          <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#A15C00" strokeWidth="1.8" strokeDasharray="5 3" /></svg>Late
        </span>
        <span>
          <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#B42318" strokeWidth="1.8" strokeDasharray="1.5 3" /></svg>Cancelled
        </span>
        <span>
          <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#1D5FA8" strokeWidth="3" /></svg>Cause path
        </span>
      </div>
    </div>
  );
}
