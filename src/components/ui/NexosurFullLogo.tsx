import Image from "next/image";

interface FullLogoProps {
  className?: string;
  logoWidth?: number;
}

export function NexosurFullLogo({ className = "", logoWidth = 200 }: FullLogoProps) {
  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      {/* Isologo SVG */}
      <Image
        src="/logo-isologo.svg"
        alt="Nexosur Digital"
        width={logoWidth}
        height={Math.round(logoWidth * (136.01 / 226.39))}
        priority
      />

      {/* NEXOSUR text */}
      <div className="flex items-baseline gap-0 select-none">
        <span
          className="font-bold tracking-[0.15em] text-[#e8e6e1]"
          style={{ fontSize: logoWidth * 0.14 }}
        >
          NEXO
        </span>
        <span
          className="font-bold tracking-[0.15em] text-[#3bc79a]"
          style={{ fontSize: logoWidth * 0.14 }}
        >
          SUR
        </span>
      </div>

      {/* Digital with decorative lines */}
      <div className="flex items-center gap-2" style={{ marginTop: -4 }}>
        {/* Left line with dot */}
        <div className="flex items-center gap-1">
          <span
            className="block w-[5px] h-[5px] rounded-full bg-[#1681df]"
          />
          <span
            className="block h-[1.5px] bg-[#1681df]"
            style={{ width: logoWidth * 0.15 }}
          />
        </div>

        <span
          className="text-[#3bc79a] italic font-medium tracking-wide"
          style={{ fontSize: logoWidth * 0.09 }}
        >
          Digital
        </span>

        {/* Right line with dot */}
        <div className="flex items-center gap-1">
          <span
            className="block h-[1.5px] bg-[#3bc79a]"
            style={{ width: logoWidth * 0.15 }}
          />
          <span
            className="block w-[5px] h-[5px] rounded-full bg-[#3bc79a]"
          />
        </div>
      </div>

      {/* Tagline */}
      <p
        className="text-[#9a9bb0] italic font-light tracking-wide"
        style={{ fontSize: logoWidth * 0.07, marginTop: 2 }}
      >
        Hacemos simple lo digital
      </p>
    </div>
  );
}
