import Link from "next/link";
import { NexosurLogo } from "@/components/ui/NexosurLogo";

export function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-100 px-6 py-4 flex justify-between items-center backdrop-blur-xl bg-deep/75 border-b border-white/4">
      <Link href="/" className="flex items-center gap-2.5 no-underline text-text-primary">
        <NexosurLogo />
      </Link>

      <ul className="hidden md:flex gap-8 list-none items-center">
        <li>
          <Link href="#servicios" className="text-text-secondary text-sm font-medium hover:text-text-primary transition-colors">
            Servicios
          </Link>
        </li>
        <li>
          <Link href="#herramientas" className="text-text-secondary text-sm font-medium hover:text-text-primary transition-colors">
            Herramientas
          </Link>
        </li>
        <li>
          <Link
            href="#contacto"
            className="gradient-bg text-white px-5 py-2 rounded-lg text-sm font-semibold"
          >
            Contacto
          </Link>
        </li>
      </ul>

      {/* Mobile hamburger - funcionalidad para después */}
      <button className="flex md:hidden flex-col gap-[5px] bg-transparent border-none cursor-pointer p-1" aria-label="Menú">
        <span className="w-[22px] h-[2px] bg-text-primary rounded-sm" />
        <span className="w-[22px] h-[2px] bg-text-primary rounded-sm" />
        <span className="w-[22px] h-[2px] bg-text-primary rounded-sm" />
      </button>
    </nav>
  );
}
