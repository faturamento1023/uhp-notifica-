"use strict";
const $ = id => document.getElementById(id);
const API = "/api/v1";
const areaName = { patient_safety:"Segurança do Paciente", ccih:"CCIH" };
const caseState = { received:"Recebida", in_progress:"Em tratativa", closed:"Finalizada" };
const stepName = {
  draft:"Aguardando parecer", revision:"Parecer para revisão",
  pending_approval:"Parecer para aprovação", actions:"Aguardando ações",
  complement:"Complemento solicitado", pending_validation:"Aguardando validação", validated:"Validada"
};
const eventName = {
  notification_received:"Notificação recebida", assignment_created:"Encaminhada",
  assignment_updated:"Responsável ou prazo alterado", opinion_submitted:"Parecer enviado",
  opinion_approved:"Parecer aprovado", opinion_rejected:"Parecer devolvido",
  action_registered:"Ação registrada", evidence_added:"Evidência anexada", progress_added:"Evolução registrada",
  actions_submitted:"Ações enviadas para validação", actions_validated:"Ações validadas",
  actions_complement_requested:"Complemento solicitado", notification_closed:"Notificação finalizada"
};
const actionIcon = {
  "Enviar evidência":"anexar", "Registrar evolução":"historico", "Salvar rascunho":"rascunho", "Enviar parecer":"enviar",
  "Aprovar parecer":"aprovar", "Devolver para ajuste":"devolver", "Registrar ação":"acoes",
  "Enviar ações para validação":"enviar", "Validar ações":"validar",
  "Pedir complemento":"complemento", "Salvar alteração":"rascunho"
};
const eventIcon = {
  notification_received:"notificacoes", assignment_created:"encaminhar",
  assignment_updated:"editar", opinion_submitted:"parecer", opinion_approved:"aprovar",
  opinion_rejected:"devolver", action_registered:"acoes", evidence_added:"evidencia", progress_added:"historico",
  actions_submitted:"enviar", actions_validated:"validar",
  actions_complement_requested:"complemento", notification_closed:"encerrar"
};
const statusIcon = { received:"pendente", in_progress:"acoes", closed:"sucesso" };
const formatDate = value => value ? value.split("-").reverse().join("/") : "—";
const formatTime = value => value ? new Intl.DateTimeFormat("pt-BR", {
  dateStyle:"short",timeStyle:"short",timeZone:"America/Sao_Paulo"
}).format(new Date(value)) : "—";
const localToday = () => new Intl.DateTimeFormat("en-CA", {
  timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"
}).format(new Date());
const normalize = value => String(value || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu,"");
let account = null, assignees = [], items = [], nextOffset = null, selected = null, current = null, busy = false, photoUrl = null;

function el(tag,text="",className="") {
  const node=document.createElement(tag);
  node.textContent=text;
  if(className) node.className=className;
  return node;
}
function icon(name) {
  const image=document.createElement("img");
  image.className="ui-icon";
  image.src="icons/"+name+".png";
  image.alt="";
  image.width=20;image.height=20;
  return image;
}
function labeled(tag,text,className,name) {
  const node=el(tag,"",className);
  node.append(icon(name),document.createTextNode(text));
  return node;
}
function button(text,action,secondary=false) {
  const node=el("button","",secondary?"secondary":"");
  const name=actionIcon[text];
  if(name) node.append(icon(name));
  node.append(document.createTextNode(text));
  node.type="button";
  node.addEventListener("click",()=>perform(action));
  return node;
}
function inputField(label,value="",type="text") {
  const wrap=el("label",label), input=document.createElement(type==="textarea"?"textarea":"input");
  if(type!=="textarea") input.type=type;
  input.value=value ?? "";
  wrap.append(input);
  return {wrap,input};
}
function message(text,error=false) {
  $("feedback").replaceChildren(icon(error?"erro":"sucesso"),document.createTextNode(text));
  $("feedback").className=error?"notice error":"notice";
  if(error) $("feedback").scrollIntoView({block:"nearest"});
}
async function api(path,method="GET",body) {
  const response=await fetch(API+path,{
    method,credentials:"same-origin",
    headers:body===undefined?{}:{"Content-Type":"application/json"},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  if(!response.ok) {
    const result=await response.json().catch(()=>null);
    const error=new Error(result?.error?.message || "Não foi possível completar a operação.");
    error.status=response.status;
    throw error;
  }
  return response.status===204?null:response.json();
}
async function perform(operation) {
  if(busy) return;
  busy=true;
  document.body.style.cursor="progress";
  const loadingTimer=setTimeout(()=>{ $("loading-overlay").hidden=false;document.body.setAttribute("aria-busy","true"); },280);
  try { await operation() }
  catch(error) {
    message(error.message || "Falha de comunicação. Tente novamente.",true);
    if(error.status===401) showLogin();
    if(error.status===409 && selected) await openCase(selected).catch(()=>{});
  } finally {
    clearTimeout(loadingTimer);
    $("loading-overlay").hidden=true;
    document.body.removeAttribute("aria-busy");
    busy=false;document.body.style.cursor="";
  }
}
function showLogin() {
  account=null; current=null;selected=null;items=[];nextOffset=null;
  $("login").hidden=false;$("workspace").hidden=true;$("logout").hidden=true;$("identity").textContent="";
}
function showWorkspace() {
  $("login").hidden=true;$("workspace").hidden=false;$("logout").hidden=false;
  $("identity").textContent=account.name+" · "+(account.role==="administrator"?"Administrador":canCoordinate()?"Coordenação":areaName[account.role]);
  $("panel-guide").textContent=canCoordinate()
    ?"Veja a fila, encaminhe às áreas e acompanhe as decisões até a finalização."
    :"Consulte as notificações atribuídas a você e registre sua tratativa.";
}
async function loadQueue(reset=true) {
  const offset=reset?0:nextOffset;
  if(offset===null) return;
  const data=await api("/notifications?offset="+offset);
  items=reset?data.items:[...items,...data.items];
  nextOffset=data.nextOffset;
  $("more").hidden=nextOffset===null;
  renderQueue();
}
function renderQueue() {
  const list=$("queue");list.replaceChildren();
  const q=normalize($("query").value);
  const filter=$("status-filter").value;
  const visible=items.filter(item=>(!filter || item.status===filter)
    && (!q || normalize([item.protocol,item.sector,item.subject,item.kind].join(" ")).includes(q)));
  $("queue-empty").hidden=visible.length>0;
  $("queue-empty").textContent=items.length?"Nenhum registro corresponde aos filtros nesta página.":"Nenhuma notificação atribuída.";
  for(const item of visible) {
    const li=document.createElement("li");
    const trigger=el("button");
    trigger.type="button";
    trigger.setAttribute("aria-current",String(selected===item.id));
    const title=el("span","","case-heading");
    title.append(icon(item.kind==="incident"?"evento-adverso":"nao-conformidade"),
      el("strong",item.subject || (item.kind==="incident"?"Incidente ou evento adverso":"Não conformidade")));
    trigger.append(title);
    trigger.append(el("small",item.protocol+" · "+(item.sector||"Setor não informado")));
    trigger.append(labeled("span",caseState[item.status],"pill"+(item.status==="closed"?" done":item.status==="received"?" received":""),statusIcon[item.status]));
    if(item.assignments?.some(a=>a.overdue?.opinion || a.overdue?.actions)) trigger.append(labeled("span","Prazo vencido","pill late","atrasado"));
    trigger.addEventListener("click",()=>perform(()=>openCase(item.id,true)));
    li.append(trigger);list.append(li);
  }
}
function nextAction(record) {
  if(record.status==="closed") return "Caso finalizado. Consulte o histórico para ver as decisões.";
  if(canCoordinate()) {
    if(record.assignments.some(a=>a.status==="pending_approval")) return "Leia o parecer e aprove ou devolva com justificativa.";
    if(record.assignments.some(a=>a.status==="pending_validation")) return "Confira as ações e evidências; valide ou peça complemento.";
    if(!record.assignments.length) return "Encaminhe a notificação à Segurança do Paciente e/ou CCIH.";
    if(record.assignments.every(a=>a.status==="validated")) return "Todas as áreas foram validadas. Registre a conclusão e finalize.";
    return "Acompanhe os prazos e as tratativas das áreas encaminhadas.";
  }
  const assignment=record.assignments[0];
  if(!assignment) return "Aguarde o encaminhamento da Coordenação.";
  if(["draft","revision"].includes(assignment.status)) return "Elabore o parecer e envie para aprovação.";
  if(["actions","complement"].includes(assignment.status)) return "Registre as ações, anexe evidência em cada uma e envie para validação.";
  if(assignment.status==="pending_approval") return "Parecer enviado. Aguarde a decisão da Coordenação.";
  if(assignment.status==="pending_validation") return "Ações enviadas. Aguarde a validação da Coordenação.";
  return "Tratativa validada. A Coordenação poderá finalizar o caso.";
}
async function openCase(id,focus=false) {
  if(selected!==id) {if(photoUrl) URL.revokeObjectURL(photoUrl);photoUrl=null;$("case-photo").removeAttribute("src");$("photo-wrap").open=false;}
  current=await api("/notifications/"+encodeURIComponent(id));
  selected=id;
  renderQueue();
  renderDetail();
  if(focus) $("case-title").focus();
}
function renderDetailsList(record) {
  const list=$("case-fields");list.replaceChildren();
  for(const [label,value] of record.entries || []) {
    list.append(el("dt",label),el("dd",value));
  }
}
async function loadPhoto(record) {
  const image=$("case-photo");
  if(!record.photo || photoUrl) return;
  const id=record.id;
  const response=await fetch(API+"/notifications/"+encodeURIComponent(id)+"/photo",{credentials:"same-origin"});
  if(!response.ok || selected!==id) return;
  const blob=await response.blob();
  if(selected!==id) return;
  photoUrl=URL.createObjectURL(blob);
  image.src=photoUrl;
}
function makeSelect(label,options,selectedValue) {
  const wrap=el("label",label),select=document.createElement("select");
  for(const item of options) select.add(new Option(item.label,item.value));
  if(selectedValue) select.value=selectedValue;
  wrap.append(select);
  return {wrap,input:select};
}
function assigneeOptions(area) {
  return assignees.filter(person=>person.role===area).map(person=>({value:person.id,label:person.name}));
}
function updateAssigneeSelect() {
  const options=assigneeOptions($("area-choice").value);
  $("assignee").replaceChildren();
  $("assignee").add(new Option("Selecione", ""));
  for(const person of options) $("assignee").add(new Option(person.label,person.value));
}
function renderTriage(record) {
  const box=$("triage");
  box.hidden=!canCoordinate() || record.status==="closed" || record.assignments.length===2;
  if(box.hidden) return;
  for(const option of $("area-choice").options) option.disabled=record.assignments.some(a=>a.area===option.value);
  if($("area-choice").selectedOptions[0]?.disabled) {
    $("area-choice").value=["patient_safety","ccih"].find(area=>!record.assignments.some(a=>a.area===area));
  }
  updateAssigneeSelect();
}
function renderAttachment(name, mime, path) {
  const link=el("a",mime==="application/pdf"?"Abrir PDF: "+name:"Abrir imagem em tamanho original");
  link.href=API+path;
  link.target="_blank";
  link.rel="noopener noreferrer";
  link.className="evidence-link";
  if(!["image/png","image/jpeg"].includes(mime)) return link;
  const preview=el("figure","","attachment-preview");
  const image=el("img");
  image.alt=name;
  image.loading="lazy";
  image.decoding="async";
  const caption=el("figcaption","","small muted");
  caption.append(el("span",name),link);
  image.addEventListener("error",()=>{
    image.hidden=true;
    caption.prepend(el("span","Prévia indisponível."));
  });
  image.src=link.href;
  preview.append(image,caption);
  return preview;
}
function renderAction(action,assignment,areaOwner) {
  const container=el("div","","area");
  container.append(labeled("p",formatDate(action.performedOn)+" · "+action.description,"info-line","acoes"));
  for(const evidence of action.evidence) {
    container.append(renderAttachment(evidence.name,evidence.mime,"/evidence/"+encodeURIComponent(evidence.id)+"/preview"));
  }
  if(areaOwner && ["actions","complement"].includes(assignment.status)) {
    const file=inputField("Anexar evidência (PDF, PNG ou JPEG; até 4 MB)","","file");
    file.input.accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";
    container.append(file.wrap);
    container.append(button("Enviar evidência",async()=>{
      const chosen=file.input.files[0];
      if(!chosen) throw Error("Selecione uma evidência.");
      if(!["application/pdf","image/png","image/jpeg"].includes(chosen.type) || chosen.size>4*1024*1024 || !chosen.size) throw Error("Use PDF, PNG ou JPEG de até 4 MB.");
      const data=await fileToBase64(chosen);
      await api("/actions/"+encodeURIComponent(action.id)+"/evidence","POST",{
        name:chosen.name.slice(0,180),mime:chosen.type,contentBase64:data
      });
      await refreshCase("Evidência anexada.");
    }));
  }
  return container;
}
function fileToBase64(file) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(Error("Não foi possível ler o arquivo."));
    reader.onload=()=>resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(file);
  });
}
async function refreshCase(text) {
  await Promise.all([openCase(selected),loadQueue()]);
  if(text) message(text);
}
function renderProgress(assignment,owner) {
  const box=el("section","","section-title");
  box.append(labeled("h3","Evolução da tratativa","","historico"));
  const entries=assignment.progress ?? [];
  if(!entries.length) box.append(el("p","Nenhuma evolução registrada.","small muted"));
  const timeline=el("ol","","progress-timeline");
  for(const entry of [...entries].reverse()) {
    const card=el("li","","progress-entry");
    card.append(el("strong",formatTime(entry.createdAt)+" · "+entry.author,"small"),
      el("p",entry.body,"progress-body"));
    if(entry.fileName) card.append(renderAttachment(entry.fileName,entry.fileMime,"/progress/"+encodeURIComponent(entry.id)+"/attachment"));
    timeline.append(card);
  }
  if(entries.length) box.append(timeline);
  if(owner && current.status!=="closed" && assignment.status!=="validated") {
    const note=inputField("Descreva a evolução (até 5.000 caracteres)","","textarea");
    note.input.maxLength=5000;
    const file=inputField("Anexo opcional: imagem ou PDF (até 4 MB por arquivo)","","file");
    file.input.accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";
    const composer=el("details","","progress-composer");
    composer.append(el("summary","Adicionar evolução (opcional)"),note.wrap,file.wrap,button("Registrar evolução",async()=>{
      const body=note.input.value.trim();
      if(!body) throw Error("Descreva a evolução antes de salvar.");
      const chosen=file.input.files[0];
      if(chosen && (!chosen.size || chosen.size>4*1024*1024 || !["application/pdf","image/png","image/jpeg"].includes(chosen.type)))
        throw Error("Use PDF, PNG ou JPEG de até 4 MB.");
      const attachment=chosen?{name:chosen.name.slice(0,180),mime:chosen.type,contentBase64:await fileToBase64(chosen)}:null;
      await api("/assignments/"+encodeURIComponent(assignment.id)+"/progress","POST",{body,attachment});
      await refreshCase("Evolução registrada.");
    }));
    box.append(composer);
  }
  return box;
}
function renderAssignment(assignment) {
  const owner=account.id===assignment.assigneeId && account.role===assignment.area;
  const coord=canCoordinate();
  const box=el("article","","area");
  const head=el("div","","row");
  head.append(labeled("h3",areaName[assignment.area],"",assignment.area==="ccih"?"ccih":"seguranca-paciente"));
  head.append(labeled("span",stepName[assignment.status] || assignment.status,"pill"+(assignment.status==="validated"?" done":""),assignment.status==="validated"?"validar":"pendente"));
  box.append(head,labeled("p","Parecer até "+formatDate(assignment.opinionDue)+" · Ações até "+formatDate(assignment.actionsDue),"small muted info-line","prazo"));
  if(assignment.overdue?.opinion || assignment.overdue?.actions) box.append(labeled("span","Prazo vencido","pill late","atrasado"));
  const person=assignees.find(item=>item.id===assignment.assigneeId);
  if(person) box.append(labeled("p","Responsável: "+person.name,"small muted info-line","responsavel"));
  for(const opinion of assignment.opinions) {
    const op=el("div","","area");
    op.append(labeled("strong","Parecer v"+opinion.version+" · "+(opinion.decision || "Aguardando decisão"),"with-icon","parecer"));
    op.append(el("p",opinion.body));
    if(opinion.reason) op.append(el("p","Justificativa: "+opinion.reason,"small muted"));
    box.append(op);
  }
  if(owner && ["draft","revision"].includes(assignment.status)) {
    const draft=inputField("Parecer",assignment.draft || "","textarea");
    draft.input.maxLength=12000;
    box.append(draft.wrap);
    const actions=el("div","","actions");
    actions.append(button("Salvar rascunho",async()=>{
      await api("/assignments/"+assignment.id+"/draft","POST",{body:draft.input.value});
      await refreshCase("Rascunho salvo.");
    },true));
    actions.append(button("Enviar parecer",async()=>{
      if(!draft.input.value.trim()) throw Error("Preencha o parecer.");
      await api("/assignments/"+assignment.id+"/submit","POST",{body:draft.input.value.trim()});
      await refreshCase("Parecer enviado para aprovação.");
    }));
    box.append(actions);
  }
  if(coord && assignment.status==="pending_approval") {
    const reason=inputField("Justificativa para devolução","");
    box.append(reason.wrap);
    const latest=assignment.opinions.at(-1);
    const actions=el("div","","actions");
    actions.append(button("Aprovar parecer",async()=>{
      await api("/assignments/"+assignment.id+"/decision","POST",{version:latest.version,decision:"approved",reason:""});
      await refreshCase("Parecer aprovado.");
    }));
    actions.append(button("Devolver para ajuste",async()=>{
      if(!reason.input.value.trim()) throw Error("Informe a justificativa.");
      await api("/assignments/"+assignment.id+"/decision","POST",{version:latest.version,decision:"rejected",reason:reason.input.value.trim()});
      await refreshCase("Parecer devolvido.");
    },true));
    box.append(actions);
  }
  if(assignment.actions.length) {
    box.append(labeled("h3","Ações e evidências","","evidencia"));
    for(const action of assignment.actions) box.append(renderAction(action,assignment,owner));
  }
  if(owner && ["actions","complement"].includes(assignment.status)) {
    const description=inputField("Ação realizada","","textarea");
    const performed=inputField("Data da execução",localToday(),"date");
    performed.input.max=localToday();
    description.input.maxLength=5000;
    const form=el("div","","form-grid");
    form.append(description.wrap,performed.wrap);
    box.append(form);
    const actions=el("div","","actions");
    actions.append(button("Registrar ação",async()=>{
      if(!description.input.value.trim() || !performed.input.value) throw Error("Preencha a ação e a data.");
      await api("/assignments/"+assignment.id+"/actions","POST",{description:description.input.value.trim(),performedOn:performed.input.value});
      await refreshCase("Ação registrada. Anexe a evidência.");
    }));
    actions.append(button("Enviar ações para validação",async()=>{
      await api("/assignments/"+assignment.id+"/submit-actions","POST",{});
      await refreshCase("Ações enviadas para validação.");
    },true));
    box.append(actions);
  }
  if(coord && assignment.status==="pending_validation") {
    const submission=current.history.filter(event=>event.assignmentId===assignment.id && event.event==="actions_submitted").at(-1);
    const reason=inputField("Justificativa para complemento","");
    box.append(reason.wrap);
    const actions=el("div","","actions");
    actions.append(button("Validar ações",async()=>{
      await api("/assignments/"+assignment.id+"/validate","POST",{submissionId:submission.id,decision:"validated",reason:""});
      await refreshCase("Ações validadas.");
    }));
    actions.append(button("Pedir complemento",async()=>{
      if(!reason.input.value.trim()) throw Error("Informe o complemento necessário.");
      await api("/assignments/"+assignment.id+"/validate","POST",{submissionId:submission.id,decision:"complement",reason:reason.input.value.trim()});
      await refreshCase("Complemento solicitado.");
    },true));
    box.append(actions);
  }
  if(coord && assignment.status!=="validated" && current.status!=="closed") {
    const change=document.createElement("details");
    change.append(labeled("summary"," Alterar responsável ou prazos","","editar"));
    const user=makeSelect("Novo responsável",[{value:"",label:"Selecione"},...assigneeOptions(assignment.area)],assignment.assigneeId);
    const opinion=inputField("Prazo do parecer",assignment.opinionDue,"date");
    const due=inputField("Prazo das ações",assignment.actionsDue,"date");
    const reason=inputField("Motivo da alteração","");
    const grid=el("div","","form-grid section-title");
    grid.append(user.wrap,opinion.wrap,due.wrap,reason.wrap);
    change.append(grid);
    change.append(button("Salvar alteração",async()=>{
      if(!user.input.value || !opinion.input.value || !due.input.value || !reason.input.value.trim()) throw Error("Preencha responsável, prazos e motivo.");
      await api("/assignments/"+assignment.id+"/reassign","POST",{
        assigneeId:user.input.value,opinionDue:opinion.input.value,actionsDue:due.input.value,reason:reason.input.value.trim()
      });
      await refreshCase("Responsável e prazos atualizados.");
    }));
    box.append(change);
  }
  box.append(renderProgress(assignment,owner));
  return box;
}
function renderDetail() {
  const record=current;
  $("detail").hidden=false;$("welcome").hidden=true;
  $("case-title").textContent=record.protocol;
  $("case-meta").textContent=(record.kind==="incident"?"Incidente ou evento adverso":"Não conformidade")+" · "+formatDate(record.occurredOn)+" · "+(record.sector||"Setor não informado");
  $("case-state").replaceChildren(icon(statusIcon[record.status]),document.createTextNode(caseState[record.status]));
  $("case-state").className="pill"+(record.status==="closed"?" done":record.status==="received"?" received":"");
  $("case-summary").textContent=record.description || record.subject;
  const pdfLink=$("pdf-link");
  pdfLink.hidden=false;
  $("pdf-hint").hidden=pdfLink.hidden;
  pdfLink.href="/notificacao-pdf.html?id="+encodeURIComponent(record.id);
  $("next-step").textContent=nextAction(record);
  renderDetailsList(record);
  $("photo-wrap").hidden=!record.photo;
  if(record.photo && $("photo-wrap").open) loadPhoto(record).catch(()=>{});
  renderTriage(record);
  const areas=$("areas");areas.replaceChildren();
  if(!record.assignments.length) areas.append(el("p","Aguardando encaminhamento da Coordenação.","muted section-title"));
  for(const assignment of record.assignments) areas.append(renderAssignment(assignment));
  const closure=$("closure");
  closure.hidden=!canCoordinate();
  $("go-closure").hidden=closure.hidden || record.status==="closed";
  const ready=record.assignments.length>0 && record.assignments.every(item=>item.status==="validated");
  $("close-case").hidden=record.status==="closed";
  $("close-case").disabled=!ready || record.status==="closed";
  const checklist=$("closure-checklist");
  checklist.replaceChildren();
  const pendingText={
    draft:"A área precisa enviar o parecer.",
    revision:"A área precisa ajustar e reenviar o parecer.",
    pending_approval:"A Coordenação precisa aprovar o parecer.",
    actions:"A área precisa registrar as ações, anexar as evidências e enviá-las para validação.",
    complement:"A área precisa complementar as ações e reenviá-las.",
    pending_validation:"A Coordenação precisa validar as ações e evidências.",
    validated:"Tratativa validada."
  };
  for(const assignment of record.assignments) {
    const row=el("li");
    row.append(el("strong",areaName[assignment.area]+" — "),document.createTextNode(pendingText[assignment.status] ?? stepName[assignment.status] ?? assignment.status));
    checklist.append(row);
  }
  $("close-hint").textContent=record.status==="closed"
    ?"Finalizada em "+formatTime(record.closedAt)+". Conclusão: "+record.closure
    :ready?"Todas as tratativas foram validadas."
    :record.assignments.length?"Confira a pendência de cada área abaixo.":"Primeiro, encaminhe a notificação para uma área.";
  $("conclusion").parentElement.hidden=!ready || record.status==="closed";
  const history=$("history");history.replaceChildren();
  for(const entry of record.history) {
    history.append(labeled("li",formatTime(entry.createdAt)+" · "+(eventName[entry.event] || entry.event)+
      (entry.detail?.reason?" · "+entry.detail.reason:""),"",eventIcon[entry.event] || "historico"));
  }
}
$("login-form").addEventListener("submit",event=>{
  event.preventDefault();
  perform(async()=>{
    const email=$("email").value.trim(),password=$("password").value;
    account=await api("/session","POST",{email,password});
    $("password").value="";
    showWorkspace();
    await Promise.all([loadQueue(),canCoordinate()?api("/assignees").then(data=>{assignees=data.items}):Promise.resolve()]);
    message("Sessão iniciada.");
  });
});
$("logout").addEventListener("click",()=>perform(async()=>{
  await api("/session","DELETE");showLogin();message("Sessão encerrada.");
}));
$("refresh").addEventListener("click",()=>perform(async()=>{
  await Promise.all([loadQueue(),selected?openCase(selected):Promise.resolve()]);message("Painel atualizado.");
}));
$("more").addEventListener("click",()=>perform(()=>loadQueue(false)));
$("query").addEventListener("input",renderQueue);
$("status-filter").addEventListener("change",renderQueue);
$("area-choice").addEventListener("change",updateAssigneeSelect);
$("photo-wrap").addEventListener("toggle",()=>{if($( "photo-wrap").open && current) loadPhoto(current).catch(()=>message("Não foi possível carregar a foto.",true));});
$("assign").addEventListener("click",()=>perform(async()=>{
  if(!current || !canCoordinate()) return;
  const area=$("area-choice").value,assigneeId=$("assignee").value;
  const opinionDue=$("opinion-due").value,actionsDue=$("actions-due").value;
  if(!assigneeId || !opinionDue || !actionsDue) throw Error("Preencha responsável e os dois prazos.");
  if(actionsDue<opinionDue) throw Error("O prazo das ações não pode anteceder o parecer.");
  await api("/notifications/"+current.id+"/assignments","POST",{area,assigneeId,opinionDue,actionsDue});
  $("opinion-due").value="";$("actions-due").value="";
  await refreshCase("Encaminhamento registrado.");
}));
$("close-case").addEventListener("click",()=>perform(async()=>{
  const conclusion=$("conclusion").value.trim();
  if(!conclusion) throw Error("Registre a conclusão do caso.");
  await api("/notifications/"+current.id+"/close","POST",{conclusion});
  await refreshCase("Notificação finalizada.");
}));
perform(async()=>{
  try {
    account=await api("/session");
    showWorkspace();
    await Promise.all([loadQueue(),canCoordinate()?api("/assignees").then(data=>{assignees=data.items}):Promise.resolve()]);
  } catch(error) {
    if(error.status!==401) message(error.message,true);
    showLogin();
  }
});

function canCoordinate() { return account?.role === 'coordination' || account?.role === 'administrator'; }
