import { Hero } from "@/components/landing/Hero";
import { Services } from "@/components/landing/Services";
import { Tools } from "@/components/landing/Tools";
import { VideoDemo } from "@/components/landing/VideoDemo";
import { WebShowcase } from "@/components/landing/WebShowcase";
import { Trust } from "@/components/landing/Trust";
import { FAQ } from "@/components/landing/FAQ";
import { CTA } from "@/components/landing/CTA";
import { ScrollReveal } from "@/components/ui/ScrollReveal";

export default function HomePage() {
  return (
    <>
      <Hero />
      <ScrollReveal>
        <Services />
      </ScrollReveal>
      <ScrollReveal>
        <Tools />
      </ScrollReveal>
      <ScrollReveal>
        <VideoDemo />
      </ScrollReveal>
      <ScrollReveal>
        <WebShowcase />
      </ScrollReveal>
      <ScrollReveal>
        <Trust />
      </ScrollReveal>
      <FAQ />
      <CTA />
    </>
  );
}
