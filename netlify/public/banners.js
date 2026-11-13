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

const bannerDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "numeric",
  day: "numeric"
});

for (const root of document.querySelectorAll("[data-banner-carousel]")) {
  const image = document.createElement("img");
  image.className = "banner-image";
  image.loading = "lazy";
  image.decoding = "async";
  root.append(image);

  let previousDay;
  function render() {
    const date = Object.fromEntries(bannerDate.formatToParts(new Date()).map(part => [part.type, part.value]));
    const day = Date.UTC(Number(date.year), Number(date.month) - 1, Number(date.day)) / 86400000;
    if (day === previousDay) return;
    previousDay = day;
    const index = day % bannerFiles.length;
    image.src = "banners/" + bannerFiles[index];
    image.alt = "Orientação: " + bannerTitles[index];
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) render();
  });
  setInterval(render, 1000);
  render();
}
