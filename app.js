(() => {
  "use strict";
  // ====================== Utilidades ======================
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const brl = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const numBR = (c) => (c / 100).toFixed(2).replace(".", ",");
  function reais(t) {                       // "12,50" ou "1.250,50" ou "12.5" viram centavos
    t = String(t ?? "").trim().replace(/[^\d,.-]/g, "");
    if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
    const n = parseFloat(t);
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  }
  const qtdTxt = (n) => String(Math.round(n * 1000) / 1000).replace(".", ",");
  const hora = (s) => (s || "").slice(11, 16);
  const dataBR = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}` : "");
  const minutosDesde = (s) => Math.max(0, Math.round((Date.now() - new Date(s.replace(" ", "T")).getTime()) / 60000));
  const tempo = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);
  const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  function aviso(msg, tipo = "ok") {
    const t = document.createElement("div");
    t.className = "toast" + (tipo === "erro" ? " erro" : tipo === "aviso" ? " aviso" : "");
    t.textContent = msg;
    $("#toasts").appendChild(t);
    setTimeout(() => t.remove(), tipo === "erro" ? 6500 : 3500);
  }
  const api = (metodo, url, corpo) => Banco.chamar(metodo, url, corpo);
  const erroMsg = (e) => e.message || "Erro inesperado.";

  // ====================== Estado ======================
  let estado = { config: { nome: "Espetaria", mesas: [], setores: [], formas: [], servicoPct: 10, colunas: 48 }, produtos: [], contas: [] };
  let tela = "mesas", contaAtual = null, filtro = { cat: "Todos", q: "" }, produtosTodos = [];
  const config = () => estado.config;

  async function atualizar() {
    try { estado = await api("GET", "/api/estado"); conexao(true); } catch { conexao(false); return; }
    $("#nomeLoja").textContent = config().nome;
    document.title = `${config().nome} | Mesas e estoque`;
    if (tela === "mesas") renderMesas();
    if (tela === "conta") await recarregarConta();
    if (tela === "estoque") carregarEstoque();
  }
  let temporizador;
  const agendar = () => { clearTimeout(temporizador); temporizador = setTimeout(atualizar, 150); };
  function conexao(ok) { $("#semConexao").hidden = ok; }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) agendar(); });
  setInterval(() => { if (tela === "mesas" && !document.hidden) renderMesas(); }, 30000);

  // ====================== Navegação ======================
  // Estoque, vendas e configurações são só do dono (quem manda é o login; o servidor também confere).
  const exigirPin = async () => Banco.papel() === "dono";
  async function rotear() {
    const [t, id] = (location.hash.replace(/^#\/?/, "") || "mesas").split("/");
    if ((t === "estoque" || t === "vendas") && !(await exigirPin())) { location.hash = "#/mesas"; return; }
    tela = ["conta", "estoque", "vendas"].includes(t) ? t : "mesas";
    ["Mesas", "Conta", "Estoque", "Vendas"].forEach((n) => ($("#tela" + n).hidden = n.toLowerCase() !== tela));
    $$(".abas a").forEach((a) => a.removeAttribute("aria-current"));
    $(`.abas a[data-aba="${tela === "conta" ? "mesas" : tela}"]`).setAttribute("aria-current", "page");
    $(".barra-fixa").hidden = tela !== "conta";
    window.scrollTo(0, 0);
    if (tela === "mesas") renderMesas();
    if (tela === "conta") { contaAtual = null; await abrirConta(Number(id)); }
    if (tela === "estoque") carregarEstoque();
    if (tela === "vendas") carregarVendas();
  }
  window.addEventListener("hashchange", rotear);

  // ====================== Mesas ======================
  function renderMesas() {
    const porMesa = Object.fromEntries(estado.contas.map((c) => [c.mesa, c]));
    const ocupadas = estado.contas.length, aberto = estado.contas.reduce((s, c) => s + c.subtotal, 0);
    $("#resumoMesas").textContent = ocupadas ? `${ocupadas} ocupada${ocupadas > 1 ? "s" : ""} de ${config().mesas.length} · Em aberto: ${brl(aberto)}` : `Todas as ${config().mesas.length} mesas livres`;
    const bk = $("#avisoBackup");
    bk.hidden = !estado.backup || !estado.backup.atrasado;
    if (!bk.hidden) $("#avisoBackupTxt").textContent = estado.backup.ultimo ? `Faz ${estado.backup.dias} dias que você não faz backup.` : "Você ainda não fez nenhum backup dos dados.";
    $("#gradeMesas").innerHTML = config().mesas.map((m) => {
      const c = porMesa[m];
      const rotulo = /^\d+$/.test(m) ? "Mesa " : "";
      const num = `<span class="m-num${/^\d+$/.test(m) ? "" : " texto"}">${esc(m)}</span>`;
      if (!c) return `<button type="button" class="mesa" data-acao="mesa" data-mesa="${esc(m)}" aria-label="${rotulo}${esc(m)}, livre">${num}<span class="m-status">Livre</span></button>`;
      return `<button type="button" class="mesa ocupada" data-acao="mesa" data-mesa="${esc(m)}" aria-label="${rotulo}${esc(m)}, ocupada, ${brl(c.subtotal)}">
        ${num}<span class="m-valor">${brl(c.subtotal)}</span>
        <span class="m-status">${c.qtd_itens} ite${c.qtd_itens === 1 ? "m" : "ns"} · ${tempo(minutosDesde(c.aberta_em))}</span>
        ${c.nao_impressos ? `<span class="selo">Falta enviar (${c.nao_impressos})</span>` : ""}</button>`;
    }).join("");
  }
  function clicouMesa(m) {
    const c = estado.contas.find((x) => x.mesa === m);
    if (c) { location.hash = `#/conta/${c.id}`; return; }
    $("#dMesaT").textContent = /^\d+$/.test(m) ? `Abrir mesa ${m}` : `Abrir ${m}`;
    $("#fMesa").dataset.mesa = m; $("#mPessoas").value = 1; $("#mNome").value = "";
    $("#dMesa").showModal(); $("#mPessoas").select();
  }
  $("#fMesa").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const c = await api("POST", "/api/contas", { mesa: e.target.dataset.mesa, pessoas: Number($("#mPessoas").value) || 1, nome: $("#mNome").value });
      $("#dMesa").close(); location.hash = `#/conta/${c.id}`;
    } catch (er) { aviso(erroMsg(er), "erro"); if (er.status === 409) { $("#dMesa").close(); agendar(); } }
  });

  // ====================== Conta / comanda ======================
  async function abrirConta(id) {
    try { contaAtual = await api("GET", `/api/contas/${id}`); }
    catch (e) { aviso(erroMsg(e), "erro"); location.hash = "#/mesas"; return; }
    if (contaAtual.status !== "aberta") { aviso("Esta conta já foi fechada.", "aviso"); location.hash = "#/mesas"; return; }
    filtro = { cat: "Todos", q: "" }; $("#busca").value = "";
    $("#contaGrid").dataset.painel = "cardapio"; painelSeg("cardapio");
    atualizarConta();
  }
  async function recarregarConta() {
    if (!contaAtual) return;
    try {
      const c = await api("GET", `/api/contas/${contaAtual.id}`);
      if (c.status !== "aberta") { aviso("Esta conta foi fechada em outro aparelho.", "aviso"); location.hash = "#/mesas"; return; }
      contaAtual = c; atualizarConta();
    } catch (e) { if (e.status === 404) { aviso("Esta mesa foi liberada.", "aviso"); location.hash = "#/mesas"; } }
  }
  function painelSeg(p) {
    $("#contaGrid").dataset.painel = p;
    $("#segCardapio").setAttribute("aria-selected", String(p === "cardapio"));
    $("#segComanda").setAttribute("aria-selected", String(p === "comanda"));
  }
  $("#segCardapio").onclick = () => painelSeg("cardapio");
  $("#segComanda").onclick = () => painelSeg("comanda");
  $("#busca").addEventListener("input", (e) => { filtro.q = e.target.value; renderProdutos(); });

  function estimativa(sub) { const serv = Math.round((sub * config().servicoPct) / 100); return { serv, total: sub + serv }; }
  function atualizarConta() {
    const c = contaAtual; if (!c) return;
    const sub = c.itens.reduce((s, i) => s + i.preco * i.qtd, 0);
    const qtd = c.itens.reduce((s, i) => s + i.qtd, 0), novos = c.itens.filter((i) => !i.impresso).reduce((s, i) => s + i.qtd, 0);
    $("#contaMesa").textContent = /^\d+$/.test(c.mesa) ? `Mesa ${c.mesa}` : c.mesa;
    $("#contaInfo").textContent = `${c.pessoas} pessoa${c.pessoas > 1 ? "s" : ""}${c.nome ? " · " + c.nome : ""} · aberta há ${tempo(minutosDesde(c.aberta_em))}`;
    $("#bLiberar").hidden = c.itens.length > 0;
    $("#segQtd").textContent = qtd;
    const cats = ["Todos", ...new Set(estado.produtos.map((p) => p.categoria))];
    $("#chips").innerHTML = cats.map((k) => `<button type="button" class="chip" data-acao="cat" data-cat="${esc(k)}" aria-pressed="${k === filtro.cat}">${esc(k)}</button>`).join("");
    renderProdutos();
    $("#itens").innerHTML = c.itens.map((i) => `
      <li class="item" data-id="${i.id}">
        <div class="i-topo"><span class="i-nome">${i.qtd}× ${esc(i.nome)}</span><span class="i-valor">${brl(i.preco * i.qtd)}</span></div>
        ${i.obs ? `<div class="i-obs">${esc(i.obs)}</div>` : ""}
        <div class="i-baixo">
          <button type="button" class="mini" data-acao="menos" data-id="${i.id}" aria-label="Tirar um ${esc(i.nome)}">−</button>
          <span class="qtd" aria-hidden="true">${i.qtd}</span>
          <button type="button" class="mini" data-acao="mais" data-id="${i.id}" aria-label="Mais um ${esc(i.nome)}">+</button>
          ${i.impresso ? "" : `<button type="button" class="mini txt" data-acao="obs" data-id="${i.id}">Obs.</button>`}
          <span class="tag ${i.impresso ? "env" : "novo"}">${i.impresso ? "Enviado" : "Novo"}</span>
        </div>
      </li>`).join("");
    $("#itensVazio").hidden = c.itens.length > 0;
    const e = estimativa(sub);
    $("#totaisConta").innerHTML = `<div><dt>Subtotal</dt><dd>${brl(sub)}</dd></div>
      <div><dt>Serviço (${config().servicoPct}%)</dt><dd>${brl(e.serv)}</dd></div>
      <div class="total"><dt>Total</dt><dd>${brl(e.total)}</dd></div>`;
    $("#barraTotal").textContent = brl(sub);
    $("#bComanda").textContent = novos ? `Enviar comanda (${novos})` : "Enviar comanda";
    $("#bComanda").disabled = !novos;
    $("#bFechar").disabled = !c.itens.length;
  }
  function renderProdutos() {
    const q = filtro.q.trim().toLowerCase(), c = contaAtual;
    const naConta = {};
    (c ? c.itens : []).forEach((i) => (naConta[i.produto_id] = (naConta[i.produto_id] || 0) + i.qtd));
    const lista = estado.produtos.filter((p) => (filtro.cat === "Todos" || p.categoria === filtro.cat) && (!q || p.nome.toLowerCase().includes(q)));
    $("#produtos").innerHTML = lista.length ? lista.map((p) => {
      let est = "", alerta = false;
      if (p.controla) {
        if (p.estoque <= 0) { est = "Sem estoque"; alerta = true; }
        else if (p.estoque <= p.minimo) { est = `Baixo: ${qtdTxt(p.estoque)}`; alerta = true; }
        else est = `Estoque: ${qtdTxt(p.estoque)}`;
      }
      return `<button type="button" class="prod" data-acao="add" data-id="${p.id}">
        ${naConta[p.id] ? `<span class="p-qtd" aria-label="${naConta[p.id]} na conta">${naConta[p.id]}</span>` : ""}
        <span class="p-nome">${esc(p.nome)}</span><span class="p-preco">${brl(p.preco)}</span>
        ${est ? `<span class="p-est${alerta ? " alerta" : ""}">${est}</span>` : ""}</button>`;
    }).join("") : `<p class="vazio">Nenhum item encontrado.</p>`;
  }
  async function mudarConta(promessa) {
    try {
      const r = await promessa; contaAtual = r; atualizarConta();
      if (r.aviso) aviso(r.aviso, "aviso");
      agendar();
    } catch (e) { aviso(erroMsg(e), "erro"); }
  }
  async function enviarComanda() {
    const b = $("#bComanda"); b.disabled = true;
    try {
      const r = await api("GET", `/api/contas/${contaAtual.id}/comanda`);
      if (!r.tickets.length) { aviso("Não há itens novos para enviar.", "aviso"); return; }
      const { cols } = prefsImpressao();
      await imprimir(r.tickets.map((t) => ({ destino: t.setor, linhas: linhasComanda(r.conta, t, cols) })));
      contaAtual = await api("POST", `/api/contas/${contaAtual.id}/comanda/ok`, { ids: r.tickets.flatMap((t) => t.itens.map((i) => i.id)) });
      aviso("Comanda enviada."); agendar();
    } catch (e) { aviso("Não imprimiu: " + erroMsg(e), "erro"); }
    finally { atualizarConta(); }
  }

  // ====================== Impressão ======================
  const prefsImpressao = () => ({
    modo: localStorage.getItem("modoImpressao") || "navegador",
    cols: Number(localStorage.getItem("colsImpressao")) || config().colunas || 48
  });
  const semAcento = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "");
  const lp = (e, d, c, extra = {}) => ({ t: par(e, d, c), e: String(e), d: String(d), ...extra });
  const par = (e, d, c) => { e = String(e); d = String(d); return e.slice(0, Math.max(0, c - d.length - 1)) + " ".repeat(Math.max(1, c - e.length - d.length)) + d; };
  function quebrar(t, larg) {
    const linhas = []; let atual = "";
    String(t).split(/\s+/).forEach((p) => {
      if ((atual + " " + p).trim().length <= larg) atual = (atual + " " + p).trim();
      else { if (atual) linhas.push(atual); atual = p.slice(0, larg); }
    });
    if (atual) linhas.push(atual);
    return linhas.length ? linhas : [""];
  }
  const agoraBR = () => new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  function linhasComanda(conta, ticket, cols) {
    const meia = Math.floor(cols / 2), traco = "-".repeat(cols), L = [];
    L.push({ t: "COMANDA", a: "c", n: true, g: true });
    L.push({ t: /^\d+$/.test(conta.mesa) ? "MESA " + conta.mesa : String(conta.mesa).toUpperCase(), a: "c", n: true, g: true });
    if (conta.nome) quebrar(conta.nome, cols).forEach((x) => L.push({ t: x, a: "c" }));
    L.push({ t: agoraBR(), a: "c" }, { t: traco }, { t: ticket.setor.toUpperCase(), n: true });
    ticket.itens.forEach((i) => {
      quebrar(`${i.qtd}x ${i.nome}`, meia).forEach((x) => L.push({ t: x, g: true }));
      if (i.obs) quebrar(">> " + i.obs, cols).forEach((x) => L.push({ t: x, n: true }));
    });
    L.push({ t: traco }, { t: "" }, { t: "" });
    return L;
  }
  function linhasConta(c, cols, T, opc = {}) {
    const meia = Math.floor(cols / 2), traco = "-".repeat(cols), L = [], nome = config().nome.toUpperCase();
    L.push({ t: nome, a: "c", n: true, g: nome.length <= meia });
    L.push({ t: (/^\d+$/.test(c.mesa) ? "CONTA - MESA " + c.mesa : "CONTA - " + c.mesa.toUpperCase()), a: "c", n: true });
    L.push({ t: `Abertura: ${dataBR(c.aberta_em)}`, a: "c" });
    L.push({ t: `Impressao: ${agoraBR()}`, a: "c" });
    if (c.nome) quebrar("Cliente: " + c.nome, cols).forEach((x) => L.push({ t: x, a: "c" }));
    L.push({ t: traco });
    c.itens.forEach((i) => {
      L.push(lp(`${i.qtd}x ${i.nome}`, brl(i.preco * i.qtd), cols));
      if (i.qtd > 1) L.push({ t: `   ${brl(i.preco)} cada` });
    });
    L.push({ t: traco }, lp("Subtotal", brl(T.sub), cols));
    if (T.serv) L.push(lp(`Servico${T.pct ? " " + T.pct + "%" : ""}`, brl(T.serv), cols));
    if (T.desc) L.push(lp("Desconto", "-" + brl(T.desc), cols));
    L.push(lp("TOTAL", brl(T.total), meia, { n: true, g: true }));
    if (opc.dividir > 1) L.push({ t: `Por pessoa (${opc.dividir}): ${brl(Math.ceil(T.total / opc.dividir))}`, n: true });
    if (opc.pagamentos && opc.pagamentos.length) {
      L.push({ t: traco });
      comTroco(opc.pagamentos, opc.troco).forEach((p) => L.push(lp(p.forma + (p.forma === "Dinheiro" && opc.troco ? " (recebido)" : ""), brl(p.valor), cols)));
      if (opc.troco) L.push(lp("Troco", brl(opc.troco), cols));
    }
    L.push({ t: traco });
    quebrar(config().rodape || "", cols).forEach((x) => L.push({ t: x, a: "c" }));
    L.push({ t: "Obrigado e volte sempre!", a: "c" }, { t: "" }, { t: "" });
    return L;
  }
  const comTroco = (pags, troco) => { let usado = false; return (pags || []).map((p) => (p.forma === "Dinheiro" && troco && !usado ? ((usado = true), { ...p, valor: p.valor + troco }) : p)); };
  function htmlLinhas(L, cols) {
    return L.map((l) => {
      const larg = l.g ? Math.floor(cols / 2) : cols; let t = l.t;
      if (l.a === "c") t = " ".repeat(Math.max(0, Math.floor((larg - t.length) / 2))) + t;
      return `<span class="${l.n ? "n " : ""}${l.g ? "g" : ""}" style="display:block;min-height:1em">${esc(t)}</span>`;
    }).join("");
  }
  function escpos(linhas) {
    const b = [0x1b, 0x40], enc = new TextEncoder();
    linhas.forEach((l) => { b.push(0x1b, 0x61, l.a === "c" ? 1 : l.a === "d" ? 2 : 0, 0x1b, 0x45, l.n ? 1 : 0, 0x1d, 0x21, l.g ? 0x11 : 0, ...enc.encode(semAcento(l.t) + "\n")); });
    b.push(0x1b, 0x61, 0, 0x1b, 0x45, 0, 0x1d, 0x21, 0, 0x1d, 0x56, 0x42, 0x00);
    return b;
  }
  // Bluetooth direto (Chrome no Android, impressoras BLE). Guarda a conexão para as próximas impressões.
  let bleCanal = null;
  async function imprimirBLE(tickets) {
    if (!navigator.bluetooth) throw new Error("Este navegador não tem Bluetooth direto. Use o Chrome no Android ou o modo RawBT.");
    const conectado = () => bleCanal && bleCanal.service.device.gatt.connected;
    if (!conectado()) {
      const dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true,
        optionalServices: ["000018f0-0000-1000-8000-00805f9b34fb", "0000ffe0-0000-1000-8000-00805f9b34fb", "e7810a71-73ae-499d-8c15-faa9aef0c3f2", "49535343-fe7d-4ae5-8fa9-9fafd205e455"] });
      const srv = await dev.gatt.connect();
      bleCanal = null;
      for (const s of await srv.getPrimaryServices()) {
        for (const c of await s.getCharacteristics()) { if (c.properties.write || c.properties.writeWithoutResponse) { bleCanal = c; break; } }
        if (bleCanal) break;
      }
      if (!bleCanal) throw new Error("Esta impressora não aceita impressão direta. Use o modo RawBT.");
    }
    const dados = new Uint8Array(tickets.flatMap((t) => escpos(t.linhas)));
    for (let i = 0; i < dados.length; i += 100) {
      const parte = dados.slice(i, i + 100);
      if (bleCanal.properties.writeWithoutResponse) await bleCanal.writeValueWithoutResponse(parte); else await bleCanal.writeValue(parte);
      await new Promise((r) => setTimeout(r, 30));
    }
  }
  async function imprimir(tickets, forcar) {
    const { modo, cols } = { ...prefsImpressao(), ...(forcar || {}) };
    if (modo === "ble") {
      await imprimirBLE(tickets);
    } else if (modo === "rawbt") {
      const bytes = tickets.flatMap((t) => escpos(t.linhas));
      let bin = ""; bytes.forEach((x) => (bin += String.fromCharCode(x)));
      location.href = "intent:base64," + btoa(bin) + "#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;";
    } else {
      const area = $("#areaImpressao");
      area.className = cols === 32 ? "p58" : "";
      area.innerHTML = tickets.map((t) => `<div class="ticket">${htmlLinhas(t.linhas, cols)}</div>`).join("");
      window.print();
    }
  }
  // Janela de configuração de impressão (por aparelho)
  const dicas = {
    navegador: "Usa a impressora instalada neste aparelho. No computador do caixa, abra o Chrome com --kiosk-printing para imprimir sem confirmar.",
    ble: "Fala direto com a impressora Bluetooth BLE, sem app. Na primeira impressão o Chrome pede para escolher a impressora. Se ela não aparecer, use o RawBT.",
    rawbt: "Instale o app RawBT no Android, pareie a impressora Bluetooth nele e use este modo."
  };
  function dicaConfig() {
    const m = $("#cModo").value; let t = dicas[m];
    $("#cDica").textContent = t;
  }
  $("#bConfig").onclick = () => { const p = prefsImpressao(); $("#cModo").value = p.modo; $("#cCols").value = String(p.cols); dicaConfig(); $("#dConfig").showModal(); };
  $("#cModo").onchange = dicaConfig;
  $("#fConfig").onsubmit = (e) => { e.preventDefault(); localStorage.setItem("modoImpressao", $("#cModo").value); localStorage.setItem("colsImpressao", $("#cCols").value); $("#dConfig").close(); aviso("Configuração salva neste aparelho."); };
  $("#cTeste").onclick = async () => {
    const cols = Number($("#cCols").value);
    const L = [{ t: config().nome.toUpperCase(), a: "c", n: true, g: true }, { t: "TESTE DE IMPRESSAO", a: "c", n: true }, { t: agoraBR(), a: "c" },
      { t: "1234567890".repeat(5).slice(0, cols) }, { t: par("Item de teste", "R$ 10,00", cols) }, { t: "Acentos: ação, coração" }, { t: "" }, { t: "" }];
    try { await imprimir([{ destino: "caixa", linhas: L }], { modo: $("#cModo").value, cols }); } catch (e) { aviso("Não imprimiu: " + erroMsg(e), "erro"); }
  };

  // ====================== Conferência da conta (mostrar ao cliente antes de imprimir) ======================
  let conferida = null;
  // Na tela a conta é redesenhada em letra grande (não precisa caber em 32 ou 48 colunas como no papel).
  function htmlTela(L) {
    return L.map((l) => {
      if (/^-{8,}$/.test(l.t)) return "<hr>";
      const cls = (l.n ? " n" : "") + (l.g ? " g" : "");
      if (l.e !== undefined) return `<div class="lin${cls}"><span>${esc(l.e)}</span><span>${esc(l.d)}</span></div>`;
      const txt = l.t.trim();
      if (!txt) return `<div class="vazio-l"></div>`;
      return `<div class="txt${cls}${l.a === "c" ? " c" : ""}${/^\s/.test(l.t) ? " recuo" : ""}">${esc(txt)}</div>`;
    }).join("");
  }
  function abrirConferencia(linhas, { titulo = "Conta", situacao = "" } = {}) {
    const { cols } = prefsImpressao();
    conferida = linhas;
    $("#dContaT").textContent = titulo;
    $("#cfSit").hidden = !situacao; $("#cfSit").textContent = situacao;
    const papel = $("#cfPapel"); papel.innerHTML = htmlTela(linhas);
    $("#cfImprimir").disabled = false;
    if (!$("#dConta").open) $("#dConta").showModal();
    papel.scrollTop = 0;
  }
  $("#cfFechar").onclick = () => $("#dConta").close();
  $("#cfImprimir").onclick = async () => {
    const bt = $("#cfImprimir"); bt.disabled = true;
    try { await imprimir([{ destino: "caixa", linhas: conferida }]); $("#dConta").close(); aviso("Conta enviada para impressão."); }
    catch (e) { aviso("Não imprimiu: " + erroMsg(e), "erro"); bt.disabled = false; }
  };

  // ====================== Fechar conta ======================
  let F = null;
  function totaisFechar() {
    const sub = contaAtual.itens.reduce((s, i) => s + i.preco * i.qtd, 0);
    const usa = $("#fUsaServico").checked;
    const pct = usa ? Math.max(0, Math.min(30, parseInt($("#fPct").value, 10) || 0)) : 0;
    const serv = Math.round((sub * pct) / 100);
    let desc = reais($("#fDesc").value || "0"); if (!Number.isFinite(desc) || desc < 0) desc = 0; desc = Math.min(desc, sub);
    return { sub, pct, serv, desc, total: sub + serv - desc };
  }
  function abrirFechar() {
    const c = contaAtual, novos = c.itens.filter((i) => !i.impresso).reduce((s, i) => s + i.qtd, 0);
    F = { pagamentos: [{ forma: config().formas[0], valor: "" }], manual: false };
    $("#fUsaServico").checked = config().servicoPct > 0; $("#fPct").value = config().servicoPct; $("#fDesc").value = ""; $("#fPessoas").value = c.pessoas;
    $("#fAviso").hidden = !novos; $("#fAviso").textContent = `Atenção: ${novos} item(ns) ainda não foram enviados para a cozinha.`;
    $("#dFecharT").textContent = /^\d+$/.test(c.mesa) ? `Fechar conta · Mesa ${c.mesa}` : `Fechar conta · ${c.mesa}`;
    montarPagamentos(); recalcularFechar(); $("#dFechar").showModal();
  }
  function montarPagamentos() {
    $("#fPagamentos").innerHTML = F.pagamentos.map((p, i) => `
      <div class="pag" data-i="${i}">
        <label>Forma <select data-campo="forma">${config().formas.map((f) => `<option${f === p.forma ? " selected" : ""}>${esc(f)}</option>`).join("")}</select></label>
        <label>Valor (R$) <input type="text" data-campo="valor" inputmode="decimal" autocomplete="off" value="${esc(p.valor)}"></label>
        ${F.pagamentos.length > 1 ? `<button type="button" class="btn sec pequeno" data-remover="${i}" aria-label="Remover esta forma">Remover</button>` : "<span></span>"}
      </div>`).join("");
  }
  function recalcularFechar() {
    const T = totaisFechar(), n = Math.max(1, parseInt($("#fPessoas").value, 10) || 1);
    $("#fTotais").innerHTML = `<div><dt>Subtotal</dt><dd>${brl(T.sub)}</dd></div>${T.serv ? `<div><dt>Serviço (${T.pct}%)</dt><dd>${brl(T.serv)}</dd></div>` : ""}${T.desc ? `<div><dt>Desconto</dt><dd>-${brl(T.desc)}</dd></div>` : ""}<div class="total"><dt>Total</dt><dd>${brl(T.total)}</dd></div>`;
    $("#fDivisao").textContent = n > 1 ? `Dividido por ${n}: ${brl(Math.ceil(T.total / n))} por pessoa` : "";
    if (F.pagamentos.length === 1 && !F.manual) { F.pagamentos[0].valor = numBR(T.total); const inp = $("#fPagamentos input"); if (inp) inp.value = F.pagamentos[0].valor; }
    const sum = F.pagamentos.reduce((s, p) => s + (reais(p.valor) || 0), 0);
    const dinheiro = F.pagamentos.filter((p) => p.forma === "Dinheiro").reduce((s, p) => s + (reais(p.valor) || 0), 0);
    const sit = $("#fSituacao"); let valido = false;
    if (sum < T.total) { sit.textContent = `Falta ${brl(T.total - sum)}`; sit.className = "situacao falta"; }
    else if (sum - T.total > dinheiro) { sit.textContent = "Valor acima do total só é aceito em dinheiro (troco)."; sit.className = "situacao falta"; }
    else { valido = true; sit.textContent = sum > T.total ? `Troco ${brl(sum - T.total)}` : "Valor conferido"; sit.className = "situacao ok"; }
    $("#fConfirma").disabled = !valido || T.total <= 0;
  }
  ["fUsaServico", "fPct", "fDesc", "fPessoas"].forEach((id) => $("#" + id).addEventListener("input", recalcularFechar));
  $("#fPagamentos").addEventListener("input", (e) => {
    const linha = e.target.closest(".pag"); if (!linha) return;
    const p = F.pagamentos[Number(linha.dataset.i)];
    if (e.target.dataset.campo === "forma") p.forma = e.target.value; else { p.valor = e.target.value; F.manual = true; }
    recalcularFechar();
  });
  $("#fPagamentos").addEventListener("click", (e) => {
    const b = e.target.closest("[data-remover]"); if (!b) return;
    F.pagamentos.splice(Number(b.dataset.remover), 1); montarPagamentos(); recalcularFechar();
  });
  $("#fAddPag").onclick = () => {
    const T = totaisFechar(), sum = F.pagamentos.reduce((s, p) => s + (reais(p.valor) || 0), 0);
    F.manual = true; F.pagamentos.push({ forma: config().formas[1] || config().formas[0], valor: numBR(Math.max(0, T.total - sum)) });
    montarPagamentos(); recalcularFechar();
  };
  $("#fPrevia").onclick = () => {
    const T = totaisFechar(), { cols } = prefsImpressao();
    abrirConferencia(linhasConta(contaAtual, cols, T, { dividir: parseInt($("#fPessoas").value, 10) || 1 }), { titulo: "Conta para conferir" });
  };
  $("#fFechar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const T = totaisFechar(), dividir = parseInt($("#fPessoas").value, 10) || 1, btn = $("#fConfirma"); btn.disabled = true;
    try {
      const r = await api("POST", `/api/contas/${contaAtual.id}/fechar`, {
        servicoPct: T.pct, desconto: T.desc,
        pagamentos: F.pagamentos.map((p) => ({ forma: p.forma, valor: reais(p.valor) })).filter((p) => p.valor > 0)
      });
      $("#dFechar").close();
      location.hash = "#/mesas"; agendar();
      const { cols } = prefsImpressao(), mesaTxt = /^\d+$/.test(r.mesa) ? "Mesa " + r.mesa : r.mesa;
      abrirConferencia(
        linhasConta(r, cols, { sub: r.subtotal, serv: r.servico, pct: T.pct, desc: r.desconto, total: r.total }, { dividir, pagamentos: r.pagamentos, troco: r.troco }),
        { titulo: `Conta fechada · ${mesaTxt}`, situacao: r.troco ? `Pago. Troco: ${brl(r.troco)}` : "Pago. Sem troco." });
    } catch (er) { aviso(erroMsg(er), "erro"); recalcularFechar(); }
  });

  // ====================== Estoque ======================
  async function carregarEstoque() {
    try { produtosTodos = await api("GET", "/api/produtos/todos"); }
    catch (e) { if (e.status === 401) { location.hash = "#/mesas"; } aviso(erroMsg(e), "erro"); return; }
    renderEstoque();
  }
  function renderEstoque() {
    const q = $("#buscaEstoque").value.trim().toLowerCase();
    const baixos = produtosTodos.filter((p) => p.ativo && p.controla && p.estoque <= p.minimo);
    $("#alertaEstoque").hidden = !baixos.length;
    $("#alertaEstoque").innerHTML = baixos.length ? `<strong>Repor:</strong> ${baixos.map((p) => `${esc(p.nome)} (${qtdTxt(p.estoque)})`).join(" · ")}` : "";
    const lista = produtosTodos.filter((p) => !q || (p.nome + " " + p.categoria).toLowerCase().includes(q));
    $("#listaEstoque").innerHTML = lista.map((p) => {
      const cls = !p.controla ? "" : p.estoque <= 0 ? "zero" : p.estoque <= p.minimo ? "baixo" : "";
      return `<div class="prodlinha${p.ativo ? "" : " inativo"}">
        <div><div class="pl-nome">${esc(p.nome)}</div><div class="pl-sub">${esc(p.categoria)} · ${esc(p.setor)} · ${brl(p.preco)}${p.ativo ? "" : " · fora do cardápio"}</div></div>
        <div class="pl-est ${cls}">${p.controla ? qtdTxt(p.estoque) : "—"}<small>${p.controla ? `${esc(p.unidade)} · mín. ${qtdTxt(p.minimo)}${cls === "zero" ? " · sem estoque" : cls === "baixo" ? " · baixo" : ""}` : "sem controle"}</small></div>
        <div class="pl-acoes">
          ${p.controla ? `<button type="button" class="btn pequeno" data-acao="mov" data-id="${p.id}" data-tipo="entrada">Entrada</button><button type="button" class="btn sec pequeno" data-acao="mov" data-id="${p.id}" data-tipo="ajuste">Perda ou contagem</button>` : ""}
          <button type="button" class="btn sec pequeno" data-acao="editar" data-id="${p.id}">Editar</button>
        </div></div>`;
    }).join("") || `<p class="vazio">Nenhum produto.</p>`;
  }
  $("#buscaEstoque").addEventListener("input", renderEstoque);

  let editando = null;
  function abrirProduto(p) {
    editando = p || null;
    $("#dProdutoT").textContent = p ? "Editar produto" : "Novo produto";
    $("#pSetor").innerHTML = config().setores.map((s) => `<option>${esc(s)}</option>`).join("");
    $("#listaCats").innerHTML = [...new Set(produtosTodos.map((x) => x.categoria))].map((c) => `<option value="${esc(c)}">`).join("");
    $("#pNome").value = p ? p.nome : ""; $("#pCat").value = p ? p.categoria : ""; $("#pSetor").value = p ? p.setor : config().setores[0];
    $("#pPreco").value = p ? numBR(p.preco) : ""; $("#pUn").value = p ? p.unidade : "un"; $("#pMin").value = p ? p.minimo : 0;
    $("#pEst").value = 0; $("#pControla").checked = p ? Boolean(p.controla) : true; $("#pAtivo").checked = p ? Boolean(p.ativo) : true;
    $("#pEstLinha").hidden = Boolean(p); $("#pAtivoLinha").hidden = !p; $("#pErro").textContent = "";
    $("#dProduto").showModal(); $("#pNome").focus();
  }
  $("#fProduto").addEventListener("submit", async (e) => {
    e.preventDefault();
    const preco = reais($("#pPreco").value);
    if (!Number.isFinite(preco)) { $("#pErro").textContent = "Informe o preço, por exemplo 12,50."; return; }
    const corpo = { nome: $("#pNome").value, categoria: $("#pCat").value, setor: $("#pSetor").value, preco, unidade: $("#pUn").value,
      minimo: Number($("#pMin").value) || 0, estoque: Number($("#pEst").value) || 0, controla: $("#pControla").checked, ativo: $("#pAtivo").checked };
    try {
      await (editando ? api("PUT", `/api/produtos/${editando.id}`, corpo) : api("POST", "/api/produtos", corpo));
      $("#dProduto").close(); aviso("Produto salvo."); carregarEstoque(); agendar();
    } catch (er) { $("#pErro").textContent = erroMsg(er); }
  });
  let movProd = null;
  function rotulosMov() {
    const t = document.querySelector('input[name="movTipo"]:checked').value;
    $("#movQtdRotulo").textContent = t === "entrada" ? "Quantidade comprada" : t === "perda" ? "Quantidade perdida" : "Quantidade contada agora";
    $("#movCustoLinha").hidden = t !== "entrada";
  }
  $$('input[name="movTipo"]').forEach((r) => r.addEventListener("change", rotulosMov));
  function abrirMov(p, tipo) {
    movProd = p; $("#movProduto").textContent = `${p.nome} · estoque atual: ${qtdTxt(p.estoque)} ${p.unidade}`;
    $$('input[name="movTipo"]').forEach((r) => (r.checked = r.value === tipo));
    $("#movQtd").value = ""; $("#movCusto").value = ""; $("#movObs").value = ""; $("#movErro").textContent = "";
    rotulosMov(); $("#dMov").showModal(); $("#movQtd").focus();
  }
  $("#fMov").addEventListener("submit", async (e) => {
    e.preventDefault();
    const tipo = document.querySelector('input[name="movTipo"]:checked').value;
    const custo = $("#movCusto").value ? reais($("#movCusto").value) : null;
    try {
      await api("POST", "/api/movimentos", { produto_id: movProd.id, tipo, qtd: Number($("#movQtd").value), custo: tipo === "entrada" && Number.isFinite(custo) ? custo : undefined, obs: $("#movObs").value });
      $("#dMov").close(); aviso("Estoque atualizado."); carregarEstoque(); agendar();
    } catch (er) { $("#movErro").textContent = erroMsg(er); }
  });
  async function mostrarHistorico() {
    try {
      const mv = await api("GET", "/api/movimentos");
      const nomes = { entrada: "Entrada", venda: "Venda", estorno: "Devolução", perda: "Perda", ajuste: "Contagem" };
      $("#histCorpo").innerHTML = mv.length ? mv.map((m) => `<div class="linha2"><span>${dataBR(m.criado_em)} · ${esc(m.produto)}</span><span>${nomes[m.tipo] || m.tipo}: <strong class="${m.qtd < 0 ? "neg" : "pos"}">${m.qtd > 0 ? "+" : ""}${qtdTxt(m.qtd)}</strong>${m.obs ? ` · ${esc(m.obs)}` : ""}</span></div>`).join("") : `<p class="vazio">Sem movimentos ainda.</p>`;
      $("#dHist").showModal();
    } catch (e) { aviso(erroMsg(e), "erro"); }
  }
  async function fazerBackup() {
    try {
      const dados = await Banco.exportar();
      const nome = `espetaria-backup-${hojeISO()}.json`, arq = new File([JSON.stringify(dados)], nome, { type: "application/json" });
      let compartilhado = false;
      if (navigator.canShare && navigator.canShare({ files: [arq] })) {
        try { await navigator.share({ files: [arq], title: "Backup da espetaria" }); compartilhado = true; }
        catch (e) { if (e.name === "AbortError") return; }      // se o compartilhamento falhar, baixa o arquivo
      }
      if (!compartilhado) {
        const a = document.createElement("a"); a.href = URL.createObjectURL(arq); a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
      aviso(compartilhado ? "Backup feito. Guarde o arquivo em um lugar seguro." : `Backup salvo na pasta Downloads: ${nome}`); agendar();
    } catch (e) { aviso(erroMsg(e), "erro"); }
  }
  async function abrirConfigLoja() {
    try {
      const c = await api("GET", "/api/config");
      $("#lNome").value = c.nome; $("#lMesas").value = c.mesas; $("#lExtras").value = c.extras; $("#lServico").value = c.servicoPct;
      $("#lRodape").value = c.rodape; $("#lBloqueia").checked = c.bloquearSemEstoque; $("#lErro").textContent = "";
      $("#dLoja").showModal(); $("#lNome").focus();
    } catch (e) { aviso(erroMsg(e), "erro"); }
  }
  $("#lZerar").addEventListener("click", async () => {
    if (!confirm("Apagar TODAS as vendas, as contas e as mesas abertas? O estoque volta ao que era antes das vendas. Isso não pode ser desfeito.")) return;
    if (!confirm("Tem certeza? Faça um backup antes se houver qualquer dado real.")) return;
    try {
      const r = await api("POST", "/api/zerar-vendas");
      $("#dLoja").close(); aviso(`Vendas apagadas (${r.contas} contas). Estoque devolvido.`); await atualizar(); if (tela === "estoque") carregarEstoque();
    } catch (er) { $("#lErro").textContent = erroMsg(er); }
  });
  $("#fLoja").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("PUT", "/api/config", { nome: $("#lNome").value, mesas: Number($("#lMesas").value), extras: $("#lExtras").value, servicoPct: Number($("#lServico").value),
        rodape: $("#lRodape").value, bloquearSemEstoque: $("#lBloqueia").checked });
      $("#dLoja").close(); aviso("Configurações salvas."); await atualizar();
    } catch (er) { $("#lErro").textContent = erroMsg(er); }
  });

  // ====================== Vendas ======================
  async function carregarVendas() {
    if (!$("#dataVendas").value) $("#dataVendas").value = hojeISO();
    try {
      const v = await api("GET", `/api/vendas?data=${$("#dataVendas").value}`), r = v.resumo;
      $("#cardsVendas").innerHTML = [["Vendido no dia", brl(r.total)], ["Contas fechadas", r.contas], ["Ticket médio", brl(r.contas ? Math.round(r.total / r.contas) : 0)], ["Serviço cobrado", brl(r.servico)]]
        .map(([a, b]) => `<div class="cartao"><span>${a}</span><strong>${b}</strong></div>`).join("");
      $("#formasVendas").innerHTML = Object.entries(r.porForma).map(([f, val]) => `<div class="linha2"><span>${esc(f)}</span><strong>${brl(val)}</strong></div>`).join("") || `<p class="vazio">Sem vendas neste dia.</p>`;
      $("#topVendas").innerHTML = r.top.map((t) => `<div class="linha2"><span>${t.qtd}× ${esc(t.nome)}</span><strong>${brl(t.valor)}</strong></div>`).join("") || `<p class="vazio">Sem vendas neste dia.</p>`;
      $("#contasVendas").innerHTML = v.contas.map((c) => `<div class="linha2"><span>${/^\d+$/.test(c.mesa) ? "Mesa " + esc(c.mesa) : esc(c.mesa)} · ${hora(c.fechada_em)} · ${c.pagamentos.map((p) => esc(p.forma)).join(" + ")}</span>
        <span><strong>${brl(c.total)}</strong> <button type="button" class="btn sec pequeno" data-acao="reimprimir" data-id="${c.id}">Reimprimir</button></span></div>`).join("") || `<p class="vazio">Nenhuma conta fechada neste dia.</p>`;
    } catch (e) { if (e.status === 401) location.hash = "#/mesas"; aviso(erroMsg(e), "erro"); }
  }
  $("#dataVendas").addEventListener("change", carregarVendas);
  async function reimprimir(id) {
    try {
      const c = await api("GET", `/api/contas/${id}`), { cols } = prefsImpressao();
      const pct = c.subtotal ? Math.round((c.servico * 100) / c.subtotal) : 0, mesaTxt = /^\d+$/.test(c.mesa) ? "Mesa " + c.mesa : c.mesa;
      abrirConferencia(linhasConta(c, cols, { sub: c.subtotal, serv: c.servico, pct, desc: c.desconto, total: c.total }, { pagamentos: c.pagamentos, troco: c.troco }), { titulo: `Conta · ${mesaTxt}` });
    } catch (e) { aviso(erroMsg(e), "erro"); }
  }

  // ====================== Cliques da tela ======================
  let obsId = null;
  document.addEventListener("click", (e) => {
    const f = e.target.closest("[data-fechar]"); if (f) { f.closest("dialog").close(); return; }
    const b = e.target.closest("[data-acao]"); if (!b) return;
    const id = Number(b.dataset.id), acao = b.dataset.acao;
    if (acao === "mesa") clicouMesa(b.dataset.mesa);
    else if (acao === "voltar") location.hash = "#/mesas";
    else if (acao === "cat") { filtro.cat = b.dataset.cat; atualizarConta(); }
    else if (acao === "add") mudarConta(api("POST", `/api/contas/${contaAtual.id}/itens`, { produto_id: id, qtd: 1 }));
    else if (acao === "mais") mudarConta(api("PATCH", `/api/itens/${id}`, { delta: 1 }));
    else if (acao === "menos") {
      const item = contaAtual.itens.find((i) => i.id === id);
      if (item && item.impresso && !confirm(`Tirar 1 ${item.nome}? O item já foi enviado para a cozinha.`)) return;
      mudarConta(api("PATCH", `/api/itens/${id}`, { delta: -1 }));
    } else if (acao === "obs") {
      const item = contaAtual.itens.find((i) => i.id === id); obsId = id;
      $("#obsItem").textContent = `${item.qtd}× ${item.nome}`; $("#oTexto").value = item.obs; $("#dObs").showModal(); $("#oTexto").focus();
    } else if (acao === "transferir") {
      const livres = config().mesas.filter((m) => !estado.contas.some((c) => c.mesa === m));
      $("#tMesa").innerHTML = livres.map((m) => `<option value="${esc(m)}">${/^\d+$/.test(m) ? "Mesa " : ""}${esc(m)}</option>`).join("");
      if (!livres.length) { aviso("Não há mesas livres.", "aviso"); return; }
      $("#dTrocar").showModal();
    } else if (acao === "liberar") {
      if (!confirm("Liberar esta mesa sem consumo?")) return;
      api("POST", `/api/contas/${contaAtual.id}/liberar`).then(() => { aviso("Mesa liberada."); location.hash = "#/mesas"; agendar(); }).catch((er) => aviso(erroMsg(er), "erro"));
    } else if (acao === "comanda") enviarComanda();
    else if (acao === "fechar") abrirFechar();
    else if (acao === "novoProduto") abrirProduto(null);
    else if (acao === "editar") abrirProduto(produtosTodos.find((p) => p.id === id));
    else if (acao === "mov") abrirMov(produtosTodos.find((p) => p.id === id), b.dataset.tipo);
    else if (acao === "historico") mostrarHistorico();
    else if (acao === "backup" || acao === "backupAgora") exigirPin().then((ok) => ok && fazerBackup());
    else if (acao === "equipe") abrirEquipe();
    else if (acao === "pessoaAtivo") alterarPessoa(b.dataset.uid, b.dataset.ativo === "1");
    else if (acao === "pessoaSenha") redefinirSenha(b.dataset.email);
    else if (acao === "configLoja") abrirConfigLoja();
    else if (acao === "reimprimir") reimprimir(id);
  });
  $("#fObs").addEventListener("submit", (e) => { e.preventDefault(); $("#dObs").close(); mudarConta(api("PUT", `/api/itens/${obsId}`, { obs: $("#oTexto").value })); });
  $("#fTrocar").addEventListener("submit", (e) => { e.preventDefault(); $("#dTrocar").close(); mudarConta(api("POST", `/api/contas/${contaAtual.id}/transferir`, { mesa: $("#tMesa").value })); });

  // ====================== Equipe (só o dono) ======================
  async function listarEquipe() {
    const box = $("#listaEquipe"); box.innerHTML = `<p class="fino">Carregando…</p>`;
    try {
      const lista = await Banco.equipe.listar();
      box.innerHTML = lista.length ? lista.map((p) => `<div class="pessoa${p.ativo ? "" : " inativa"}"><div><strong>${esc(p.nome)}</strong><small>${esc(p.email)}${p.ativo ? "" : " · desativado"}</small></div>
        <div class="acoes"><button type="button" class="btn sec pequeno" data-acao="pessoaAtivo" data-uid="${esc(p.uid)}" data-ativo="${p.ativo ? 0 : 1}">${p.ativo ? "Desativar" : "Ativar"}</button>
        <button type="button" class="btn sec pequeno" data-acao="pessoaSenha" data-email="${esc(p.email)}">Redefinir senha</button></div></div>`).join("") : `<p class="vazio">Ninguém cadastrado ainda.</p>`;
    } catch (e) { box.innerHTML = `<p class="erro">${esc(erroMsg(e))}</p>`; }
  }
  function abrirEquipe() { $("#eErro").textContent = ""; $("#fEquipe").reset(); $("#dEquipe").showModal(); listarEquipe(); }
  async function alterarPessoa(uid, ativo) {
    try { await Banco.equipe.definirAtivo(uid, ativo); aviso(ativo ? "Acesso liberado." : "Acesso desativado."); } catch (e) { aviso(erroMsg(e), "erro"); }
    listarEquipe();
  }
  async function redefinirSenha(email) {
    if (!confirm(`Enviar e-mail de redefinição de senha para ${email}?\nSó chega se o e-mail existir de verdade.`)) return;
    try { await Banco.equipe.redefinirSenha(email); aviso("E-mail enviado."); } catch (e) { aviso(erroMsg(e), "erro"); }
  }
  $("#fEquipe").addEventListener("submit", async (e) => {
    e.preventDefault(); const bt = $("#bEquipeSalvar"); bt.disabled = true; $("#eErro").textContent = "";
    try {
      await Banco.equipe.criar({ nome: $("#eNome").value, email: $("#eEmail").value, senha: $("#eSenha").value });
      aviso("Pessoa cadastrada."); $("#fEquipe").reset(); listarEquipe();
    } catch (er) { $("#eErro").textContent = erroMsg(er); }
    finally { bt.disabled = false; }
  });

  // ====================== Entrada (login) ======================
  const lembrarNome = () => { try { return localStorage.getItem("espetaria.nomeLoja"); } catch { return null; } };
  function mostrarLogin(msg = "") {
    document.body.classList.add("deslogado"); $("#telaLogin").hidden = false;
    $("#loginLoja").textContent = lembrarNome() || "Espetaria Cavalcante";
    $("#carregando").hidden = true; $("#loginCampos").hidden = false; $("#loginErro").textContent = msg;
    $("#bEntrar").disabled = false; $("#lSenha").value = ""; $("#lEmail").focus();
  }
  async function entrarNoApp() {
    await Banco.iniciar();
    const dono = Banco.papel() === "dono";
    $$('.abas a[data-aba="estoque"], .abas a[data-aba="vendas"]').forEach((a) => (a.hidden = !dono));
    $("#usuarioNome").textContent = Banco.nome();
    document.body.classList.remove("deslogado"); $("#telaLogin").hidden = true;
    await atualizar();
    try { localStorage.setItem("espetaria.nomeLoja", config().nome); } catch { /* sem armazenamento */ }
    if (location.hash === "#/estoque" || location.hash === "#/vendas") { if (!dono) location.hash = "#/mesas"; }
    rotear();
  }
  $("#fLogin").addEventListener("submit", async (e) => {
    e.preventDefault(); $("#bEntrar").disabled = true; $("#loginErro").textContent = "";
    try { await Banco.entrar($("#lEmail").value, $("#lSenha").value); await entrarNoApp(); }
    catch (er) { await Banco.sair().catch(() => {}); mostrarLogin(erroMsg(er)); }
  });
  $("#bSair").addEventListener("click", async () => {
    if (!confirm("Sair deste aparelho?")) return;
    await Banco.sair().catch(() => {}); contaAtual = null; location.hash = "#/mesas"; mostrarLogin();
  });
  Banco.aoSair(() => { if (!document.body.classList.contains("deslogado")) mostrarLogin("Você foi desconectado. Entre de novo."); });

  // Alterações feitas em outros aparelhos aparecem aqui sozinhas (sem atrapalhar quem está digitando em uma janela aberta)
  let pendente = false;
  Banco.aoMudar(() => { if (document.querySelector("dialog[open]")) { pendente = true; return; } agendar(); });
  document.addEventListener("close", () => { if (pendente) { pendente = false; agendar(); } }, true);
  Banco.aoErro((m) => aviso(m, "erro"));
  const mostrarOffline = () => { $("#offline").hidden = navigator.onLine; };
  window.addEventListener("online", mostrarOffline); window.addEventListener("offline", mostrarOffline); mostrarOffline();

  // ====================== Início ======================
  (async () => {
    $("#telaLogin").hidden = false; $("#loginLoja").textContent = lembrarNome() || "Espetaria Cavalcante";
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    try {
      const u = await Banco.preparar();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();   // pede ao Android para não apagar os dados
      if (!u) { mostrarLogin(); return; }
      try { await entrarNoApp(); } catch (e) { await Banco.sair().catch(() => {}); mostrarLogin(erroMsg(e)); }
    } catch (e) { console.error(e); $("#carregando").textContent = erroMsg(e); }
  })();
})();
