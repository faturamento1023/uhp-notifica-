"use strict";

const groupChat = (() => {
  const log = document.getElementById("chat-log");
  const list = document.getElementById("chat-messages");
  const empty = document.getElementById("chat-empty");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const send = document.getElementById("chat-send");
  const older = document.getElementById("chat-older");
  const status = document.getElementById("chat-status");
  let session;

  function messageNode(message, formatTime) {
    const item = document.createElement("li");
    const author = document.createElement("strong");
    const time = document.createElement("time");
    const body = document.createElement("p");
    author.textContent = message.author;
    time.dateTime = message.createdAt;
    time.textContent = formatTime(message.createdAt);
    body.textContent = message.body;
    item.append(author, time, body);
    return item;
  }

  function render(state, data, previous) {
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    const previousHeight = log.scrollHeight;
    const previousTop = log.scrollTop;
    const nodes = document.createDocumentFragment();
    for (const message of data.items) {
      if (state.seen.has(message.id)) continue;
      state.seen.add(message.id);
      nodes.append(messageNode(message, state.formatTime));
    }
    if (previous) {
      list.prepend(nodes);
      log.scrollTop = previousTop + log.scrollHeight - previousHeight;
    } else {
      list.append(nodes);
      if (atBottom) log.scrollTop = log.scrollHeight;
    }
    if (!state.ready || previous) state.before = data.before;
    empty.hidden = state.seen.size > 0;
    empty.textContent = "Ainda não há mensagens.";
    older.hidden = state.before === null;
    state.ready = true;
  }

  async function load(state, previous = false) {
    if (state.loading || state !== session) return;
    state.loading = true;
    older.disabled = true;
    try {
      const path = previous ? "/chat/messages?before=" + state.before : "/chat/messages";
      const data = await state.api(path);
      if (state !== session) return;
      render(state, data, previous);
      if (state.loadError) status.textContent = "";
      state.loadError = false;
    } catch (error) {
      if (state !== session) return;
      if (error.status === 401) return state.onExpired();
      state.loadError = true;
      status.textContent = "Não foi possível atualizar a conversa. Tentaremos novamente.";
      if (!state.ready) empty.textContent = "Histórico temporariamente indisponível.";
    } finally {
      state.loading = false;
      if (state === session) older.disabled = false;
    }
  }

  older.addEventListener("click", () => {
    if (session?.before) void load(session, true);
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const state = session;
    const message = input.value.trim();
    if (!state || state.sending || !message) return;
    state.sending = true;
    input.readOnly = true;
    send.disabled = true;
    status.textContent = "";
    try {
      await state.api("/chat/messages", "POST", { message });
      if (state !== session) return;
      input.value = "";
      if (!state.loading) await load(state);
    } catch (error) {
      if (state !== session) return;
      if (error.status === 401) return state.onExpired();
      state.loadError = false;
      status.textContent = error.message || "Não foi possível enviar. Tente novamente.";
    } finally {
      state.sending = false;
      if (state === session) {
        input.readOnly = false;
        send.disabled = false;
      }
    }
  });

  function stop() {
    if (session) clearInterval(session.timer);
    session = undefined;
    list.replaceChildren();
    input.value = "";
    input.readOnly = false;
    send.disabled = false;
    older.hidden = true;
    older.disabled = false;
    status.textContent = "";
    empty.hidden = false;
    empty.textContent = "Carregando mensagens…";
  }

  function start(api, formatTime, onExpired) {
    stop();
    const state = { api, formatTime, onExpired, seen: new Set(), before: null };
    session = state;
    void load(state);
    state.timer = setInterval(() => {
      if (!document.hidden) void load(state);
    }, 10000);
  }

  return { start, stop };
})();
