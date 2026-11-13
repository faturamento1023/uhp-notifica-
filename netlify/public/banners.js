"use strict";

const bannerFiles = [
  "01-notificar-tambem-e-cuidar.webp",
  "02-nsp-transforma-notificacao-em-acao.webp",
  "03-notificacao-tem-prazo.webp",
  "04-protocolos-salvam-vidas.webp",
  "06-incentivo-a-notificacao.webp",
  "07-praticas-de-seguranca-do-paciente.webp",
  "08-rdc-e-normas-sanitarias.webp",
  "09-melhoria-continua.webp",
  "10-direitos-do-paciente.webp",
  "11-identificacao-correta-do-paciente.webp",
  "12-seguranca-no-uso-de-medicamentos.webp",
  "13-prevencao-de-quedas.webp",
  "14-higiene-das-maos.webp",
  "15-comunicacao-segura.webp"
];

const bannerTitles = [
  "Notificar também é cuidar", "O NSP transforma notificação em ação",
  "Notificação tem prazo", "Protocolos salvam vidas",
  "Incentivo à notificação",
  "Práticas de segurança do paciente", "RDC e normas sanitárias",
  "Melhoria contínua", "Direitos do paciente",
  "Identificação correta do paciente", "Segurança no uso de medicamentos",
  "Prevenção de quedas", "Higiene das mãos", "Comunicação segura"
];

for (const root of document.querySelectorAll("[data-banner-carousel]")) {
  let index = 0;
  let paused = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let visible = false;
  let timer;
  const image = document.createElement("img");
  image.className = "banner-image";
  image.loading = "lazy";
  image.decoding = "async";
  const controls = document.createElement("div");
  controls.className = "banner-controls";
  const previous = document.createElement("button");
  previous.type = "button";
  previous.textContent = "Anterior";
  const count = document.createElement("span");
  count.className = "banner-count";
  count.setAttribute("aria-live", "polite");
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "Próximo";
  const pause = document.createElement("button");
  pause.type = "button";
  function render() {
    image.src = "banners/" + bannerFiles[index];
    image.alt = "Orientação: " + bannerTitles[index];
    count.textContent = (index + 1) + " de " + bannerFiles.length;
    pause.textContent = paused ? "Reproduzir" : "Pausar";
    pause.setAttribute("aria-label", paused ? "Reproduzir banners" : "Pausar banners");
  }
  function schedule() {
    clearTimeout(timer);
    if (!paused && visible && !document.hidden) {
      timer = setTimeout(() => {
        index = (index + 1) % bannerFiles.length;
        render();
        schedule();
      }, 8000);
    }
  }
  previous.addEventListener("click", () => { index = (index + bannerFiles.length - 1) % bannerFiles.length; render(); schedule(); });
  next.addEventListener("click", () => { index = (index + 1) % bannerFiles.length; render(); schedule(); });
  pause.addEventListener("click", () => { paused = !paused; render(); schedule(); });
  document.addEventListener("visibilitychange", schedule);
  controls.append(previous, count, next, pause);
  root.append(image, controls);
  render();
  const observer = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    schedule();
  });
  observer.observe(root);
}
