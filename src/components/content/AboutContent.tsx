const FOUNDERS = [
  {
    name: "Umesh Pednekar",
    role: "Co Founder",
    bio: "Umesh, a designer/artist turned photo enthusiast. Who likes to capture things in real time. Passion driven cinematographer, editor & producer who understands the project vision and delivers it in his style. Co Founded 1920x1080 films with his partner in the year 2022. Successfully produced over 100+ interior/architectural documentation. Still driven and still personal.",
  },
  {
    name: "Anubhav Aatriy",
    role: "Co Founder",
    bio: "Anubhav, a designer/business owner turned into a film maker. Who believes every thing has a story to tell, and it's on us how we set the narrative to our audience. Passion driven photographer, director & producer, who helps to portray clients vision to the world. Co Founded 1920x1080 films with his partner in the year 2022. Successfully produced over +100 projects. Locked and ready to tell your story.",
  },
];

export default function AboutContent() {
  return (
    <div>
      <div className="about-wrap">
        <div className="about-inner">
          <div className="about-copy-head">
            <div className="about-eyebrow">About</div>
            <h1 className="font-display about-name">Who are we?</h1>
            <hr className="about-rule" />
          </div>

          <div className="about-copy">
            <p>
              We are a team of film enthusiasts, who envision the world around
              us as a narrative driven motion picture.
            </p>
            <p>
              Places, structures, people, we make sure that our work narrates
              a story to the audience. A story for everyone to own.
            </p>
            <p>We specialise in interior / architectural photography.</p>
          </div>
        </div>
      </div>

      <div className="founders-wrap">
        <div className="eyebrow">The Founders</div>
        <div className="founders-grid">
          {FOUNDERS.map((f) => (
            <div className="founder-card" key={f.name}>
              <h2 className="font-display founder-name">{f.name}</h2>
              <div className="eyebrow founder-role">{f.role}</div>
              <p className="founder-bio">{f.bio}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
