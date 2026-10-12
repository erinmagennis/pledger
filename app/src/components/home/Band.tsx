const STEPS = [
  "Put the money in place, or link to where it already is.",
  "Set who can claim, how much, and when.",
  "Pledger checks each claim and records every payment in public.",
];

export function Band() {
  return (
    <section className="band" id="how">
      <h2><span>You make the promise.</span><em>We do the admin.</em></h2>
      <div className="steps">
        {STEPS.map((s, i) => (
          <div className="step" key={i}><span className="n">{i + 1}</span><p>{s}</p></div>
        ))}
      </div>
    </section>
  );
}
