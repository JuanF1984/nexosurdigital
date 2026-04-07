import { GradientDots } from "@/components/ui/GradientDots";

const services = [
  {
    title: "Turnos online sin complicaciones",
    description: "Sin mensajes. Sin desorden.",
    dots: 20,
  },
  {
    title: "Herramientas simples a tu medida",
    description: "Solo lo que necesitás.",
    dots: 30,
  },
  {
    title: "Páginas simples para mostrar lo que hacés",
    description: "Para que te encuentren y te contacten fácil.",
    dots: 25,
  },
];

export function Services() {
  return (
    <section id="servicios" className="py-24 px-6 max-w-[800px] mx-auto">
      <h2 className="font-display text-[clamp(2rem,4vw,3rem)] font-normal leading-tight mb-12">
        Cómo te ayudamos<br />a ordenar
      </h2>

      {services.map((service, i) => (
        <div
          key={i}
          className={`mb-10 pb-10 ${i < services.length - 1 ? "border-b border-white/6" : ""}`}
        >
          <h3 className="font-body text-base font-semibold mb-1.5">
            {service.title}
          </h3>
          <p className="text-text-secondary text-sm font-light">
            {service.description}
          </p>
          <GradientDots count={service.dots} />
        </div>
      ))}
    </section>
  );
}
