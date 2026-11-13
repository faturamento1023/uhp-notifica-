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
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let visible = false;
  let timer;
  const image = document.createElement("img");
  image.className = "banner-image";
  image.loading = "lazy";
  image.decoding = "async";
  function render() {
    image.src = "banners/" + bannerFiles[index];
    image.alt = "Orientação: " + bannerTitles[index];
  }
  function schedule() {
    clearTimeout(timer);
    if (!reducedMotion.matches && visible && !document.hidden) {
      timer = setTimeout(() => {
        index = (index + 1) % bannerFiles.length;
        render();
        schedule();
      }, 8000);
    }
  }
  document.addEventListener("visibilitychange", schedule);
  reducedMotion.addEventListener('change', schedule);
  root.append(image);
  render();
  const observer = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    schedule();
  });
  observer.observe(root);
}
