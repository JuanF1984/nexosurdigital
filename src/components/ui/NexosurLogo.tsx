import Image from "next/image";

interface LogoProps {
  className?: string;
  size?: number;
}

export function NexosurLogo({ className = "", size = 38 }: LogoProps) {
  return (
    <Image
      src="/logo-isologo.svg"
      alt="Nexosur Digital"
      width={size}
      height={Math.round(size * (136.01 / 226.39))}
      className={className}
      priority
    />
  );
}
