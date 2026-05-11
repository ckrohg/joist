import { Hero } from "@/components/home/Hero";
import { Discipline } from "@/components/home/Discipline";
import { Pipeline } from "@/components/home/Pipeline";
import { Bento } from "@/components/home/Bento";
import { InstallTeaser } from "@/components/home/InstallTeaser";
import { FinalCta } from "@/components/home/FinalCta";

export default function Home() {
  return (
    <>
      <Hero />
      <Discipline />
      <Pipeline />
      <Bento />
      <InstallTeaser />
      <FinalCta />
    </>
  );
}
