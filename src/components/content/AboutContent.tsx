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
    <div className="about-wrap">
      <div className="about-inner about-inner-founders">
        <div className="about-eyebrow">About</div>

        {FOUNDERS.map((f) => (
          <div className="founder-block" key={f.name}>
            <h1 className="font-display founder-name">{f.name}</h1>
            <div className="eyebrow founder-role">{f.role}</div>
            <p className="founder-bio">{f.bio}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
