import Spine from "@/components/Spine";
import BranchOverlay from "@/components/BranchOverlay";
import AboutContent from "@/components/content/AboutContent";
import PortfolioContent from "@/components/content/PortfolioContent";
import ContactContent from "@/components/content/ContactContent";
import ServicesContent from "@/components/content/ServicesContent";

export default function Experience() {
  return (
    <main>
      <Spine />

      <BranchOverlay node="about" restBackground="#141416">
        <AboutContent />
      </BranchOverlay>
      <BranchOverlay node="portfolio" restBackground="#f2ede4">
        <PortfolioContent />
      </BranchOverlay>
      <BranchOverlay node="contact" restBackground="#0a0a0b">
        <ContactContent />
      </BranchOverlay>
      <BranchOverlay node="services" restBackground="#0a0a0b">
        <ServicesContent />
      </BranchOverlay>
    </main>
  );
}
