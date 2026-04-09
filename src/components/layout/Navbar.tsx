"use client";

import { useState } from "react";
import Link from "next/link";
import { NexosurLogo } from "@/components/ui/NexosurLogo";

export function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = () => setMenuOpen(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-100 backdrop-blur-xl bg-deep/75 border-b border-white/4">
      <div className="px-6 py-4 flex justify-between items-center">
        <Link href="/" className="flex items-center gap-2.5 no-underline text-text-primary">
          <NexosurLogo />
        </Link>

        {/* Desktop menu */}
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

        {/* Hamburger button */}
        <button
          className="flex md:hidden flex-col gap-[5px] bg-transparent border-none cursor-pointer p-1"
          aria-label="Menú"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((prev) => !prev)}
        >
          <span className="w-[22px] h-[2px] bg-text-primary rounded-sm" />
          <span className="w-[22px] h-[2px] bg-text-primary rounded-sm" />
          <span className="w-[22px] h-[2px] bg-text-primary rounded-sm" />
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <ul className="flex md:hidden flex-col gap-4 list-none px-6 pb-6">
          <li>
            <Link
              href="#servicios"
              onClick={closeMenu}
              className="text-text-secondary text-sm font-medium hover:text-text-primary transition-colors"
            >
              Servicios
            </Link>
          </li>
          <li>
            <Link
              href="#herramientas"
              onClick={closeMenu}
              className="text-text-secondary text-sm font-medium hover:text-text-primary transition-colors"
            >
              Herramientas
            </Link>
          </li>
          <li>
            <Link
              href="#contacto"
              onClick={closeMenu}
              className="gradient-bg text-white px-5 py-2 rounded-lg text-sm font-semibold inline-block"
            >
              Contacto
            </Link>
          </li>
        </ul>
      )}
    </nav>
  );
}
