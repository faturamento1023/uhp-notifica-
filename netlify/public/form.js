"use strict";

  const categories = {
    "Assistência ao paciente": [
      "Identificação do paciente ausente ou incorreta",
      "Administração de medicamento ao paciente errado",
      "Medicação administrada em dose, horário ou via incorretos",
      "Evolução de enfermagem ou registros incompletos",
      "Ausência de checagem da prescrição",
      "Curativos realizados sem técnica asséptica",
      "Falta de conferência antes de transfusão sanguínea"
    ],
    "Segurança do paciente": [
      "Paciente sem pulseira de identificação",
      "Grades da cama abaixadas em paciente com risco de queda",
      "Falta de avaliação do risco de queda ou lesão por pressão",
      "Não realização da higiene das mãos nos momentos indicados",
      "Cirurgia sem checklist de segurança"
    ],
    "Medicamentos": [
      "Medicamentos vencidos no posto de enfermagem",
      "Armazenamento inadequado de medicamentos",
      "Carrinho de emergência com itens faltando ou vencidos",
      "Geladeira de medicamentos sem controle de temperatura"
    ],
    "Equipamentos": [
      "Equipamentos sem manutenção preventiva",
      "Bomba de infusão com defeito em uso",
      "Oxigênio sem identificação ou com vazamento",
      "Extintores vencidos"
    ],
    "Controle de infecção": [
      "Descarte incorreto de resíduos hospitalares",
      "Perfurocortantes descartados em recipiente inadequado",
      "Uso incorreto de EPIs",
      "Materiais esterilizados com validade vencida",
      "Uso de adornos",
      "Cabelos soltos"
    ],
    "Documentação": [
      "Prontuário incompleto",
      "Ausência de assinatura e carimbo do profissional",
      "Prescrição médica ilegível",
      "Falta de registro de intercorrências"
    ],
    "Estrutura": [
      "Piso molhado sem sinalização",
      "Iluminação inadequada",
      "Saídas de emergência obstruídas",
      "Falta de materiais essenciais para o atendimento"
    ],
    "Gestão": [
      "Profissionais sem treinamento obrigatório",
      "Escala de pessoal insuficiente",
      "Protocolos desatualizados",
      "Não notificação de eventos adversos"
    ],
    "Profissional": ["Postura ética", "Ruídos", "Vestimenta inadequada"]
  };

  const eventTypes = [
    "Acidente do paciente",
    "Broncoaspiração",
    "Incidentes envolvendo intubação traqueal",
    "Incidentes relacionados a falhas em procedimentos cirúrgicos",
    "Incidentes relacionados a falhas em processo ou procedimento clínico",
    "Incidentes relacionados a falhas na administração de dietas",
    "Incidentes relacionados a falhas na administração de oxigênio",
    "Incidentes relacionados a falhas na assistência ao parto e nascimento",
    "Incidentes relacionados a falhas na assistência radiológica",
    "Incidentes relacionados a falhas na documentação",
    "Incidentes relacionados a falhas na identificação do paciente",
    "Incidentes relacionados a falhas nas atividades administrativas",
    "Incidentes relacionados a falhas no cuidado ou na proteção do paciente",
    "Incidentes relacionados a falhas ocorridas em laboratórios",
    "Incidentes relacionados à assistência à saúde envolvendo cateter, sonda ou outros dispositivos",
    "Lesão por pressão",
    "Queda do paciente",
    "Tromboembolismo venoso (TEV)",
    "Evasão",
    "Outro (descreva no relato)"
  ];

  const factors = [
    "Fatores do profissional — cognitivos",
    "Fatores do profissional — de desempenho",
    "Fatores do profissional — de comportamento",
    "Fatores da comunicação",
    "Fatores dirigidos ao paciente, familiar ou acompanhante",
    "Fatores do trabalho ou do ambiente",
    "Fatores organizacionais",
    "Fatores externos"
  ];

  const get = id => document.getElementById(id);
  const views = ["home", "nonconformity", "incident", "review", "done"];
  const incidentForm = get("incident").querySelector("form");
  let activeForm = null;
  const photoLimit = 2 * 1024 * 1024;
  const photos = new WeakMap();
  let lastProtocol = "";

  get("status-form").addEventListener("submit",async event=>{
    event.preventDefault();
    const result=get("status-result"),button=get("status-submit");
    const protocol=get("status-protocol").value.trim().toUpperCase();
    get("status-protocol").value=protocol;
    result.hidden=true;
    button.disabled=true;
    try {
      const response=await fetch("/api/v1/notifications/status",{
        method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({protocol})
      });
      if(!response.ok) throw Error(response.status===404
        ? "Protocolo não encontrado. Confira o número informado."
        : "Não foi possível consultar agora. Tente novamente.");
      const data=await response.json();
      const labels={received:"Recebida",in_progress:"Em tratativa",closed:"Finalizada"};
      if(!labels[data.status]) throw Error("Não foi possível consultar agora. Tente novamente.");
      const title=document.createElement("strong");title.textContent="Situação: "+labels[data.status];
      const guidance=document.createElement("p");guidance.textContent="Para mais informações, procure a Coordenação de Enfermagem.";
      result.replaceChildren(title,guidance);
      result.classList.remove("error");
    } catch(error) {
      result.textContent=error.message;
      result.classList.add("error");
    } finally {result.hidden=false;button.disabled=false;}
  });

  get("copy-protocol").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(lastProtocol);
      get("receipt-note").textContent = "Protocolo copiado. A Coordenação de Enfermagem recebeu a notificação.";
    } catch {
      get("receipt-note").textContent = "Não foi possível copiar automaticamente. Selecione o protocolo acima para copiar.";
    }
  });

  function readPhoto(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }

  function showReviewPhoto(photo) {
    get("review-photo").hidden = !photo;
    get("review-photo-name").textContent = photo?.name ?? "";
    const image = get("review-photo-image");
    if (photo) image.src = "data:" + photo.mime + ";base64," + photo.contentBase64;
    else image.removeAttribute("src");
  }

  function fillSelect(select, values, placeholder = "Selecione") {
    select.add(new Option(placeholder, ""));
    for (const value of values) select.add(new Option(value, value));
  }

  const selectOptions = {
    "nc-shift": ["Manhã", "Tarde", "Noite", "Madrugada"],
    "event-type": eventTypes,
    "event-harm": ["Nenhum (incidente sem dano)", "Leve", "Moderado", "Grave", "Óbito em decorrência do evento adverso"],
    "event-sector": ["Pronto Socorro", "Internação", "Maternidade", "Centro Cirúrgico", "Outro"],
    "event-period": ["Manhã", "Tarde", "Noite", "Madrugada"],
    "event-sex": ["Feminino", "Masculino", "Não informado"],
    "event-race": ["Branca", "Preta", "Parda", "Amarela", "Indígena", "Não informada"],
    "event-age-unit": ["Anos", "Meses", "Dias", "Horas"]
  };

  for (const [id, options] of Object.entries(selectOptions)) fillSelect(get(id), options);

  Object.entries(categories).forEach(([category, options], index) => {
    const container = document.createElement("div");
    container.className = "field";
    const select = document.createElement("select");
    select.id = "category-" + index;
    select.name = select.id;
    const label = document.createElement("label");
    label.htmlFor = select.id;
    label.textContent = category;
    fillSelect(select, options);
    container.append(label, select);
    get("nc-categories").append(container);
  });

  for (const factor of factors) {
    const label = document.createElement("label");
    label.className = "check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "factors";
    input.value = factor;
    label.append(input, document.createTextNode(factor));
    get("event-factors").append(label);
  }

  function show(view) {
    for (const id of views) get(id).hidden = id !== view;
    get(view + "-title").focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  document.querySelectorAll("[data-view]").forEach(button => {
    button.addEventListener("click", () => show(button.dataset.view));
  });

  document.querySelectorAll("[data-edit]").forEach(button => {
    button.addEventListener("click", () => show(activeForm.closest("section").id));
  });

  function updateIncidentFields() {
    const isOtherSector = get("event-sector").value === "Outro";
    get("other-sector").hidden = !isOtherSector;
    get("event-other-sector").disabled = !isOtherSector;
    get("event-other-sector").required = isOtherSector;
    const ageUnit = get("event-age-unit");
    ageUnit.disabled = get("event-age").value === "";
    ageUnit.required = !ageUnit.disabled;
    if (ageUnit.disabled) ageUnit.value = "";
  }

  get("event-sector").addEventListener("change", updateIncidentFields);
  get("event-age").addEventListener("input", updateIncidentFields);
  updateIncidentFields();

  function reviewEntries(form) {
    const entries = [];
    for (const field of form.elements) {
      if (!field.name || field.disabled || !field.value.trim()) continue;
      if (["ageUnit", "factors", "otherSector"].includes(field.name)) continue;
      let value = field.value.trim();
      if (field.type === "date") value = value.split("-").reverse().join("/");
      if (field.name === "age") value += " " + get("event-age-unit").value.toLowerCase();
      if (field.id === "event-sector" && value === "Outro") value = get("event-other-sector").value.trim();
      const label = field.labels[0].textContent.replace(/ \*$/, "");
      entries.push([label, value]);
    }
    const selectedFactors = new FormData(form).getAll("factors");
    if (selectedFactors.length) entries.push(["Fatores contribuintes", selectedFactors.join("\n")]);
    return entries;
  }

  for (const form of document.querySelectorAll("form")) {
    const photoInput = form.querySelector("[data-photo]");
    const photoError = form.querySelector("[data-photo-error]");
    const removePhoto = form.querySelector("[data-remove-photo]");
    const reviewButton = form.querySelector('button[type="submit"]');

    function clearPhoto() {
      photos.delete(form);
      photoInput.value = "";
      photoError.hidden = true;
      removePhoto.hidden = true;
      reviewButton.disabled = false;
    }

    form.addEventListener("reset", clearPhoto);
    removePhoto.addEventListener("click", () => {
      clearPhoto();
      photoInput.focus();
    });
    photoInput.addEventListener("change", async () => {
      const file = photoInput.files[0];
      photos.delete(form);
      photoError.hidden = true;
      removePhoto.hidden = !file;
      if (!file) {
        reviewButton.disabled = false;
        return;
      }
      reviewButton.disabled = true;
      try {
        if (!["image/jpeg", "image/png"].includes(file.type) || file.size > photoLimit || !file.size) {
          throw new Error("Selecione uma foto JPEG ou PNG de até 2 MB.");
        }
        const data = await readPhoto(file);
        const preview = new Image();
        preview.src = data;
        await preview.decode();
        if (photoInput.files[0] !== file) return;
        photos.set(form, { name: file.name.slice(0, 180), mime: file.type, contentBase64: data.split(",")[1] });
      } catch (error) {
        if (photoInput.files[0] !== file) return;
        photoInput.value = "";
        removePhoto.hidden = true;
        photoError.textContent = error instanceof Error && error.message.startsWith("Selecione")
          ? error.message : "Não foi possível abrir esta imagem. Escolha outra foto.";
        photoError.hidden = false;
      }
      reviewButton.disabled = false;
    });

    const requiredText = form.querySelectorAll("input:not([type]), textarea[required]");
    requiredText.forEach(field => field.addEventListener("input", () => field.setCustomValidity("")));
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (reviewButton.disabled) return;
      const blank = Array.from(requiredText).find(field => field.required && !field.value.trim());
      if (blank) {
        blank.setCustomValidity("Preencha este campo.");
        blank.reportValidity();
        return;
      }
      activeForm = form;
      get("register-error").hidden = true;
      const list = get("review-list");
      list.replaceChildren();
      for (const [label, value] of reviewEntries(form)) {
        const title = document.createElement("dt");
        title.textContent = label;
        const detail = document.createElement("dd");
        detail.textContent = value;
        list.append(title, detail);
      }
      get("review-type").textContent = form.closest("section").querySelector("h1").textContent;
      showReviewPhoto(photos.get(form));
      show("review");
    });
  }


  const intakeToken = new URLSearchParams(location.hash.slice(1)).get("entrada");
  const pending = { requestId: null, body: null };
  let receiptCredentials = null;
  get("receipt-pdf").addEventListener("click",async()=>{
    if(!receiptCredentials) return;
    const tab=window.open("","_blank");
    const button=get("receipt-pdf");button.disabled=true;
    try {
      const response=await fetch("/api/v1/notifications/"+encodeURIComponent(receiptCredentials.id)+"/receipt-pdf",{
        method:"POST",credentials:"same-origin",headers:{"X-Receipt-Token":receiptCredentials.requestId}
      });
      if(!response.ok) throw Error("Não foi possível gerar o PDF. Tente novamente.");
      const url=URL.createObjectURL(await response.blob());
      if(tab) tab.location.href=url;
      else {const link=document.createElement("a");link.href=url;link.download=receiptCredentials.protocol+".pdf";link.click();}
      setTimeout(()=>URL.revokeObjectURL(url),120000);
    } catch(error) {
      if(tab) tab.close();
      get("receipt-note").textContent=error.message;
    } finally {button.disabled=false;}
  });
  get("register").addEventListener("click", async () => {
    if (!activeForm) return;
    const form = activeForm;
    const data = new FormData(form);
    const kind = form.closest("section").id;
    const payload = {
      kind, occurredOn: data.get("date"),
      sector: String(data.get("otherSector") || data.get("sector") || "").trim(),
      period: String(data.get(kind === "incident" ? "period" : "shift") || ""),
      subject: kind === "incident" ? String(data.get("type") || "") : "",
      harm: kind === "incident" ? String(data.get("harm") || "") : "",
      description: String(data.get("description") || "").trim(),
      entries: reviewEntries(form)
    };
    const photo = photos.get(form);
    if (photo) payload.photo = photo;
    const body = JSON.stringify(payload);
    if (pending.body !== body) {
      pending.body = body;
      pending.requestId = crypto.randomUUID();
    }
    const button = get("register");
    button.disabled = true;
    const buttonIcon = button.querySelector("img");
    buttonIcon.src = "icons/carregando.png";
    buttonIcon.classList.add("busy-icon");
    get("register-error").hidden = true;
    try {
      const response = await fetch("/api/v1/notifications", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...(intakeToken ? { "X-Intake-Token": intakeToken } : {}) },
        body: JSON.stringify({ requestId: pending.requestId, ...payload })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "Não foi possível registrar. Tente novamente.");
      lastProtocol = result.protocol;
      receiptCredentials={id:result.id,requestId:pending.requestId,protocol:result.protocol};
      get("receipt").textContent = "Protocolo " + result.protocol;
      get("receipt-note").textContent = "Guarde este protocolo. A Coordenação de Enfermagem recebeu a notificação.";
      form.reset();
      if (form === incidentForm) updateIncidentFields();
      activeForm = null;
      pending.body = null; pending.requestId = null;
      showReviewPhoto();
      get("review-list").replaceChildren();
      get("review-type").textContent = "";
      show("done");
    } catch (error) {
      const notice = get("register-error");
      notice.textContent = error.message || "Falha de comunicação. Tente novamente sem alterar os dados.";
      notice.hidden = false;
    } finally {
      button.disabled = false;
      buttonIcon.src = "icons/enviar.png";
      buttonIcon.classList.remove("busy-icon");
    }
  });

