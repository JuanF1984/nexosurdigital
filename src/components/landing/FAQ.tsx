const faqs = [
  {
    q: "¿Cuánto sale?",
    a: "Te armamos una propuesta a medida, sin compromiso. Escribinos y te contamos las opciones según lo que necesites.",
  },
  {
    q: "¿Necesito saber de tecnología?",
    a: "Para nada. Nosotros nos encargamos de todo. Vos solo nos contás qué hacés y qué necesitás resolver.",
  },
  {
    q: "¿Cuánto tarda en estar listo?",
    a: "Depende del proyecto, pero una página simple puede estar lista en días. Te damos un plazo concreto apenas hablemos.",
  },
];

export function FAQ() {
  return (
    <section className="py-12 px-6 max-w-[700px] mx-auto">
      <h2 className="font-display text-[clamp(1.6rem,3.5vw,2.4rem)] font-normal italic mb-10 text-center">
        Preguntas frecuentes
      </h2>

      {faqs.map((faq, i) => (
        <div
          key={i}
          className={`py-6 ${i < faqs.length - 1 ? "border-b border-white/6" : ""}`}
        >
          <p className="font-semibold text-[0.95rem] mb-2.5 flex items-start gap-2.5">
            <span className="block w-1.5 h-1.5 rounded-full bg-accent-green shrink-0 mt-[0.45rem]" />
            {faq.q}
          </p>
          <p className="text-text-secondary text-sm font-light pl-4 leading-relaxed">
            {faq.a}
          </p>
        </div>
      ))}
    </section>
  );
}
