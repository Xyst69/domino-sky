"use client";

/** Every modelling rule, in plain words. Kept in step with the engine and docs/concepts_brief.md. */
export function Assumptions() {
  return (
    <section className="section">
      <details className="assumptions">
        <summary>How the simulation works (assumptions)</summary>
        <ul>
          <li>All times are India Standard Time on one operating day. Times past midnight show as +1d.</li>
          <li>A closure runs from its start up to, but not including, its reopening minute. A flight may leave exactly at reopening.</li>
          <li>No flight leaves a closed airport. A flight that would land at a closed airport waits at its origin and lands at reopening, unless it was already airborne when the closure began, in which case it lands.</li>
          <li>Each aircraft flies its legs in order and needs at least 30 minutes between landing and its next departure. Spare time in the schedule absorbs delay first.</li>
          <li>Flights never wait for connecting passengers unless the dispatcher holds them (at most 60 minutes).</li>
          <li>Crew duty runs from the crew's report time to the landing of its last flight, using the revised times after delays, and may not exceed 600 minutes. The dataset note says "scheduled arrival"; read literally, delays could never break a crew's limit, which contradicts the problem statement, so the revised schedule is used. If a flight would end past the limit, it and the crew's later flights are cancelled.</li>
          <li>A flight's passenger count already includes its connecting passengers. Stranded = passengers on cancelled flights, minus connecting passengers counted on two cancelled flights, plus connecting passengers who miss a connection between two flights that both operated.</li>
          <li>A spare aircraft comes with a standby crew who report 45 minutes before its first departure. In this version a spare can only take over flights leaving its own base (Bengaluru or Delhi), and it flies the rest of that aircraft's day.</li>
          <li>Airport capacity is not a constraint: at every airport, the whole day's movements are fewer than one hour's capacity. The engine checks this in every scenario.</li>
          <li>Late means arriving at least one minute after schedule.</li>
        </ul>
      </details>
    </section>
  );
}
