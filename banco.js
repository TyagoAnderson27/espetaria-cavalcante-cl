// Banco de dados local: tudo fica salvo no próprio celular (IndexedDB), sem servidor e sem internet.
// A tela conversa com este arquivo pela função Banco.chamar(), com as mesmas rotas que a versão com servidor tinha.
const Banco = (() => {
  "use strict";
  class Erro extends Error { constructor(status, msg) { super(msg); this.status = status; } }

  const PADRAO = {
    nome: "Espetaria Cavalcante", mesas: 20, extras: ["Balcão"], servicoPct: 10, pinDono: "1234",
    bloquearSemEstoque: false, colunas: 48, setores: ["Churrasqueira", "Cozinha", "Bar"],
    formasPagamento: ["Dinheiro", "Pix", "Débito", "Crédito"], rodape: "Comprovante sem valor fiscal"
  };
  const LOJAS = ["produtos", "contas", "itens", "pagamentos", "movimentos"];
  let S = null, cfg = { ...PADRAO }, idb = null, fila = Promise.resolve();
  const sujos = new Map();

  // ---------- IndexedDB ----------
  function abrir() {
    return new Promise((ok, falha) => {
      const r = indexedDB.open("espetaria", 1);
      r.onupgradeneeded = () => { LOJAS.forEach((l) => r.result.createObjectStore(l, { keyPath: "id" })); r.result.createObjectStore("meta"); };
      r.onsuccess = () => ok(r.result); r.onerror = () => falha(r.error);
    });
  }
  const pedir = (req) => new Promise((ok, falha) => { req.onsuccess = () => ok(req.result); req.onerror = () => falha(req.error); });
  const marcar = (loja, obj, op = "put") => sujos.set(loja === "meta" ? "meta" : `${loja}:${obj.id}`, { loja, obj, op });
  function gravar() {
    if (!sujos.size) return Promise.resolve();
    const lote = [...sujos.values()]; sujos.clear();
    const lojas = [...new Set(lote.map((x) => x.loja))];
    return new Promise((ok, falha) => {
      const tx = idb.transaction(lojas, "readwrite");
      lote.forEach((x) => {
        const os = tx.objectStore(x.loja);
        if (x.op === "del") os.delete(x.obj.id); else if (x.loja === "meta") os.put(x.obj, "m"); else os.put(x.obj);
      });
      tx.oncomplete = ok; tx.onerror = tx.onabort = () => falha(tx.error || new Error("Falha ao gravar"));
    });
  }
  const salvar = () => (fila = fila.then(gravar, gravar));
  const novoId = (loja) => { marcar("meta", S.meta); return ++S.meta.seq[loja]; };

  // ---------- Utilidades ----------
  const pad = (n) => String(n).padStart(2, "0");
  function agora() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
  const hoje = () => agora().slice(0, 10);
  const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
  const inteiro = (v, nome, min = 0) => { const n = Number(v); if (!Number.isInteger(n) || n < min) throw new Erro(400, `${nome} inválido.`); return n; };
  const texto = (v, max, nome, obrig = false) => { const t = String(v ?? "").trim().slice(0, max); if (obrig && !t) throw new Erro(400, `${nome} é obrigatório.`); return t; };
  const mesas = () => Array.from({ length: cfg.mesas }, (_, i) => String(i + 1)).concat(cfg.extras || []);
  const porId = (loja, id) => S[loja].find((x) => x.id === id);
  const itensDe = (cid) => S.itens.filter((i) => i.conta_id === cid).sort((a, b) => a.id - b.id);
  const abertaDaMesa = (m) => S.contas.find((c) => c.mesa === m && c.status === "aberta");
  const soma = (lista, f) => lista.reduce((s, x) => s + f(x), 0);

  // ---------- Dados iniciais ----------
  function semear() {
    [
      ["Espetinho de carne", "Espetinhos", "Churrasqueira", 1000, "un", 1, 60, 12], ["Espetinho de frango", "Espetinhos", "Churrasqueira", 900, "un", 1, 60, 12],
      ["Espetinho de coração", "Espetinhos", "Churrasqueira", 1000, "un", 1, 40, 10], ["Espetinho de linguiça", "Espetinhos", "Churrasqueira", 900, "un", 1, 40, 10],
      ["Queijo coalho", "Espetinhos", "Churrasqueira", 1000, "un", 1, 40, 10], ["Medalhão de frango", "Espetinhos", "Churrasqueira", 1100, "un", 1, 30, 8],
      ["Farofa", "Acompanhamentos", "Cozinha", 600, "un", 1, 30, 6], ["Vinagrete", "Acompanhamentos", "Cozinha", 500, "un", 1, 30, 6],
      ["Mandioca frita", "Acompanhamentos", "Cozinha", 1800, "porção", 1, 15, 4], ["Batata frita", "Acompanhamentos", "Cozinha", 2200, "porção", 1, 15, 4],
      ["Cerveja 600ml", "Bebidas", "Bar", 1400, "un", 1, 48, 12], ["Cerveja long neck", "Bebidas", "Bar", 1000, "un", 1, 48, 12],
      ["Refrigerante lata", "Bebidas", "Bar", 600, "un", 1, 36, 12], ["Refrigerante 2L", "Bebidas", "Bar", 1400, "un", 1, 12, 4],
      ["Água", "Bebidas", "Bar", 400, "un", 1, 36, 12], ["Suco natural", "Bebidas", "Bar", 800, "un", 0, 0, 0]
    ].forEach(([nome, categoria, setor, preco, unidade, controla, estoque, minimo]) => {
      const p = { id: novoId("produtos"), nome, categoria, setor, preco, unidade, controla, estoque: 0, minimo, ativo: 1 };
      S.produtos.push(p); marcar("produtos", p);
      if (controla && estoque) mover(p, estoque, "entrada", "Estoque inicial");
    });
  }
  async function iniciar() {
    idb = await abrir();
    S = {};
    for (const l of LOJAS) S[l] = await pedir(idb.transaction(l).objectStore(l).getAll());
    S.meta = (await pedir(idb.transaction("meta").objectStore("meta").get("m"))) || { seq: {}, config: {}, ultimoBackup: null };
    LOJAS.forEach((l) => (S.meta.seq[l] = Math.max(S.meta.seq[l] || 0, S[l].reduce((m, x) => Math.max(m, x.id), 0))));
    cfg = { ...PADRAO, ...S.meta.config };
    if (!S.produtos.length) semear();
    marcar("meta", S.meta);
    await salvar();
  }

  // ---------- Regras de estoque e conta ----------
  function mover(prod, delta, tipo, obs, contaId, custo) {
    prod.estoque = Math.round((prod.estoque + delta) * 1000) / 1000; marcar("produtos", prod);
    const m = { id: novoId("movimentos"), produto_id: prod.id, tipo, qtd: delta, custo: custo ?? null, obs: obs ?? null, conta_id: contaId ?? null, criado_em: agora() };
    S.movimentos.push(m); marcar("movimentos", m);
  }
  function contaAberta(id) {
    const c = porId("contas", id);
    if (!c) throw new Erro(404, "Conta não encontrada.");
    if (c.status !== "aberta") throw new Erro(409, "Esta conta já foi fechada.");
    return c;
  }
  function visao(id) {
    const c = porId("contas", id);
    if (!c) throw new Erro(404, "Conta não encontrada.");
    const v = { ...c, itens: itensDe(id), pagamentos: S.pagamentos.filter((p) => p.conta_id === id) };
    if (c.status === "aberta") v.subtotal = soma(v.itens, (i) => i.preco * i.qtd);
    return v;
  }
  function adicionar(conta, produto, qtd, obs) {
    if (!produto || !produto.ativo) throw new Erro(404, "Produto não encontrado.");
    let aviso = null;
    if (produto.controla) {
      if (cfg.bloquearSemEstoque && produto.estoque < qtd) throw new Erro(409, `Sem estoque de ${produto.nome}.`);
      if (produto.estoque - qtd < 0) aviso = `Estoque de ${produto.nome} ficou negativo. Confira a contagem.`;
    }
    const igual = S.itens.find((i) => i.conta_id === conta.id && i.produto_id === produto.id && i.obs === obs && !i.impresso);
    if (igual) { igual.qtd += qtd; marcar("itens", igual); }
    else {
      const n = { id: novoId("itens"), conta_id: conta.id, produto_id: produto.id, nome: produto.nome, preco: produto.preco, qtd, obs, setor: produto.setor, impresso: 0, criado_em: agora() };
      S.itens.push(n); marcar("itens", n);
    }
    if (produto.controla) mover(produto, -qtd, "venda", `Mesa ${conta.mesa}`, conta.id);
    return aviso;
  }

  // ---------- Rotas ----------
  const rotas = [];
  const rota = (metodo, padrao, fn, opcoes = {}) =>
    rotas.push({ metodo, re: new RegExp("^" + padrao.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), fn, ...opcoes });

  rota("GET", "/api/estado", () => {
    const abertas = S.contas.filter((c) => c.status === "aberta");
    const ultimo = S.meta.ultimoBackup;
    const dias = ultimo ? Math.floor((Date.now() - new Date(ultimo.replace(" ", "T")).getTime()) / 864e5) : null;
    const temVendas = S.contas.some((c) => c.status === "fechada");
    return {
      config: { nome: cfg.nome, mesas: mesas(), setores: cfg.setores, servicoPct: cfg.servicoPct, formas: cfg.formasPagamento, colunas: cfg.colunas,
        rodape: cfg.rodape, bloquearSemEstoque: cfg.bloquearSemEstoque, pinPadrao: String(cfg.pinDono) === "1234" },
      backup: { ultimo, dias, atrasado: temVendas && (dias === null || dias >= 7) },
      produtos: S.produtos.filter((p) => p.ativo).sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nome.localeCompare(b.nome)),
      contas: abertas.map((c) => {
        const it = itensDe(c.id);
        return { id: c.id, mesa: c.mesa, nome: c.nome, pessoas: c.pessoas, aberta_em: c.aberta_em, subtotal: soma(it, (i) => i.preco * i.qtd),
          qtd_itens: soma(it, (i) => i.qtd), nao_impressos: soma(it.filter((i) => !i.impresso), (i) => i.qtd) };
      })
    };
  });
  rota("POST", "/api/pin", ({ body }) => { if (String(body.pin) !== String(cfg.pinDono)) throw new Erro(401, "PIN incorreto."); return { ok: true }; });

  rota("POST", "/api/contas", ({ body }) => {
    const mesa = texto(body.mesa, 20, "Mesa", true);
    if (!mesas().includes(mesa)) throw new Erro(400, "Mesa inexistente.");
    if (abertaDaMesa(mesa)) throw new Erro(409, "Esta mesa já está aberta.");
    const c = { id: novoId("contas"), mesa, nome: texto(body.nome, 40, "Nome"), pessoas: Math.max(1, inteiro(body.pessoas ?? 1, "Pessoas", 1)), status: "aberta",
      aberta_em: agora(), fechada_em: null, subtotal: null, servico: null, desconto: null, total: null, troco: null };
    S.contas.push(c); marcar("contas", c);
    return visao(c.id);
  });
  rota("GET", "/api/contas/:id", ({ params }) => visao(inteiro(params.id, "Conta")));
  rota("POST", "/api/contas/:id/itens", ({ params, body }) => {
    const conta = contaAberta(inteiro(params.id, "Conta"));
    const produto = porId("produtos", inteiro(body.produto_id, "Produto", 1));
    const qtd = inteiro(body.qtd ?? 1, "Quantidade", 1), obs = texto(body.obs, 80, "Observação");
    const aviso = adicionar(conta, produto, qtd, obs);
    return { ...visao(conta.id), aviso };
  });
  rota("PATCH", "/api/itens/:id", ({ params, body }) => {
    const item = porId("itens", inteiro(params.id, "Item", 1));
    if (!item) throw new Erro(404, "Item não encontrado.");
    const conta = contaAberta(item.conta_id), delta = inteiro(body.delta, "Quantidade", -9999), produto = porId("produtos", item.produto_id);
    let aviso = null;
    if (delta > 0) aviso = adicionar(conta, produto, delta, item.obs);
    else if (delta < 0) {
      const tirar = Math.min(-delta, item.qtd);
      if (tirar === item.qtd) { S.itens.splice(S.itens.indexOf(item), 1); marcar("itens", item, "del"); } else { item.qtd -= tirar; marcar("itens", item); }
      if (produto && produto.controla) mover(produto, tirar, "estorno", `Mesa ${conta.mesa}: ${item.impresso ? "item já enviado" : "item retirado"}`, conta.id);
    }
    return { ...visao(conta.id), aviso };
  });
  rota("PUT", "/api/itens/:id", ({ params, body }) => {
    const item = porId("itens", inteiro(params.id, "Item", 1));
    if (!item) throw new Erro(404, "Item não encontrado.");
    contaAberta(item.conta_id);
    if (item.impresso) throw new Erro(409, "Item já enviado para a cozinha.");
    item.obs = texto(body.obs, 80, "Observação"); marcar("itens", item);
    return visao(item.conta_id);
  });
  rota("GET", "/api/contas/:id/comanda", ({ params }) => {
    const conta = contaAberta(inteiro(params.id, "Conta")), porSetor = {};
    itensDe(conta.id).filter((i) => !i.impresso).forEach((i) => (porSetor[i.setor] = porSetor[i.setor] || []).push({ id: i.id, nome: i.nome, qtd: i.qtd, obs: i.obs, setor: i.setor }));
    return { conta: { id: conta.id, mesa: conta.mesa, nome: conta.nome }, tickets: Object.entries(porSetor).map(([setor, itens]) => ({ setor, itens })) };
  });
  rota("POST", "/api/contas/:id/comanda/ok", ({ params, body }) => {
    const conta = contaAberta(inteiro(params.id, "Conta"));
    const ids = (Array.isArray(body.ids) ? body.ids : []).map((n) => inteiro(n, "Item", 1));
    S.itens.filter((i) => i.conta_id === conta.id && ids.includes(i.id)).forEach((i) => { i.impresso = 1; marcar("itens", i); });
    return visao(conta.id);
  });
  rota("POST", "/api/contas/:id/transferir", ({ params, body }) => {
    const conta = contaAberta(inteiro(params.id, "Conta")), mesa = texto(body.mesa, 20, "Mesa", true);
    if (!mesas().includes(mesa)) throw new Erro(400, "Mesa inexistente.");
    if (abertaDaMesa(mesa)) throw new Erro(409, "A mesa de destino está ocupada.");
    conta.mesa = mesa; marcar("contas", conta);
    return visao(conta.id);
  });
  rota("POST", "/api/contas/:id/liberar", ({ params }) => {
    const conta = contaAberta(inteiro(params.id, "Conta"));
    if (itensDe(conta.id).length) throw new Erro(409, "Retire os itens antes de liberar a mesa.");
    S.contas.splice(S.contas.indexOf(conta), 1); marcar("contas", conta, "del");
    return { ok: true };
  });
  rota("POST", "/api/contas/:id/fechar", ({ params, body }) => {
    const conta = contaAberta(inteiro(params.id, "Conta")), itens = itensDe(conta.id);
    if (!itens.length) throw new Erro(400, "A conta não tem itens.");
    const subtotal = soma(itens, (i) => i.preco * i.qtd);
    const pct = Math.min(30, inteiro(body.servicoPct ?? cfg.servicoPct, "Serviço", 0));
    const servico = Math.round((subtotal * pct) / 100), desconto = Math.min(subtotal, inteiro(body.desconto ?? 0, "Desconto", 0));
    const total = subtotal + servico - desconto;
    const pags = (Array.isArray(body.pagamentos) ? body.pagamentos : []).map((p) => ({ forma: texto(p.forma, 20, "Forma de pagamento", true), valor: inteiro(p.valor, "Valor", 1) }));
    pags.forEach((p) => { if (!cfg.formasPagamento.includes(p.forma)) throw new Erro(400, "Forma de pagamento inválida."); });
    const pago = soma(pags, (p) => p.valor);
    if (pago < total) throw new Erro(400, "O valor pago é menor que o total.");
    const troco = pago - total, dinheiro = soma(pags.filter((p) => p.forma === "Dinheiro"), (p) => p.valor);
    if (troco > dinheiro) throw new Erro(400, "Só é possível dar troco sobre o valor pago em dinheiro.");
    let resto = troco;
    pags.filter((p) => p.forma === "Dinheiro").forEach((p) => { const t = Math.min(resto, p.valor); p.valor -= t; resto -= t; });
    pags.filter((p) => p.valor > 0).forEach((p) => { const n = { id: novoId("pagamentos"), conta_id: conta.id, forma: p.forma, valor: p.valor }; S.pagamentos.push(n); marcar("pagamentos", n); });
    Object.assign(conta, { status: "fechada", fechada_em: agora(), subtotal, servico, desconto, total, troco }); marcar("contas", conta);
    return visao(conta.id);
  });

  // Estoque (exige PIN)
  rota("GET", "/api/produtos/todos", () => [...S.produtos].sort((a, b) => b.ativo - a.ativo || a.categoria.localeCompare(b.categoria) || a.nome.localeCompare(b.nome)), { pin: true });
  function lerProduto(b) {
    return { nome: texto(b.nome, 60, "Nome", true), categoria: texto(b.categoria, 30, "Categoria") || "Outros", setor: cfg.setores.includes(b.setor) ? b.setor : cfg.setores[0],
      preco: inteiro(b.preco, "Preço", 0), unidade: texto(b.unidade, 10, "Unidade") || "un", controla: b.controla ? 1 : 0, minimo: Math.max(0, Number(b.minimo) || 0) };
  }
  rota("POST", "/api/produtos", ({ body }) => {
    const d = lerProduto(body), p = { id: novoId("produtos"), ...d, estoque: 0, ativo: 1 };
    S.produtos.push(p); marcar("produtos", p);
    const inicial = Math.max(0, Number(body.estoque) || 0);
    if (d.controla && inicial > 0) mover(p, inicial, "entrada", "Estoque inicial");
    return p;
  }, { pin: true });
  rota("PUT", "/api/produtos/:id", ({ params, body }) => {
    const p = porId("produtos", inteiro(params.id, "Produto", 1));
    if (!p) throw new Erro(404, "Produto não encontrado.");
    Object.assign(p, lerProduto(body), { ativo: body.ativo === false ? 0 : 1 }); marcar("produtos", p);
    return p;
  }, { pin: true });
  rota("POST", "/api/movimentos", ({ body }) => {
    const p = porId("produtos", inteiro(body.produto_id, "Produto", 1));
    if (!p) throw new Erro(404, "Produto não encontrado.");
    const tipo = body.tipo, qtd = Number(body.qtd), obs = texto(body.obs, 80, "Observação");
    if (!Number.isFinite(qtd) || qtd < 0) throw new Erro(400, "Quantidade inválida.");
    if (tipo === "entrada") { if (qtd <= 0) throw new Erro(400, "Informe a quantidade."); mover(p, qtd, "entrada", obs || "Compra", null, body.custo ? inteiro(body.custo, "Custo", 0) : null); }
    else if (tipo === "perda") { if (qtd <= 0) throw new Erro(400, "Informe a quantidade."); mover(p, -qtd, "perda", obs || "Perda"); }
    else if (tipo === "ajuste") mover(p, qtd - p.estoque, "ajuste", obs || `Contagem: ${qtd}`);
    else throw new Erro(400, "Tipo de movimento inválido.");
    return p;
  }, { pin: true });
  rota("GET", "/api/movimentos", ({ query }) => {
    const pid = Number(query.produto_id) || 0;
    return S.movimentos.filter((m) => !pid || m.produto_id === pid).sort((a, b) => b.id - a.id).slice(0, 150)
      .map((m) => { const p = porId("produtos", m.produto_id) || {}; return { ...m, produto: p.nome || "(removido)", unidade: p.unidade || "" }; });
  }, { pin: true });

  // Vendas
  rota("GET", "/api/vendas", ({ query }) => {
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(query.data || "") ? query.data : hoje();
    const contas = S.contas.filter((c) => c.status === "fechada" && c.fechada_em.slice(0, 10) === dia).sort((a, b) => b.fechada_em.localeCompare(a.fechada_em));
    const r = { dia, contas: contas.length, subtotal: 0, servico: 0, desconto: 0, total: 0, porForma: {}, top: [] }, top = {};
    const lista = contas.map((c) => {
      r.subtotal += c.subtotal; r.servico += c.servico; r.desconto += c.desconto; r.total += c.total;
      const pagamentos = S.pagamentos.filter((p) => p.conta_id === c.id);
      pagamentos.forEach((p) => (r.porForma[p.forma] = (r.porForma[p.forma] || 0) + p.valor));
      itensDe(c.id).forEach((i) => { const t = (top[i.nome] = top[i.nome] || { nome: i.nome, qtd: 0, valor: 0 }); t.qtd += i.qtd; t.valor += i.qtd * i.preco; });
      return { ...c, pagamentos };
    });
    r.top = Object.values(top).sort((a, b) => b.qtd - a.qtd).slice(0, 8);
    return { resumo: r, contas: lista };
  }, { pin: true });

  // Configurações da loja
  rota("GET", "/api/config", () => ({ nome: cfg.nome, mesas: cfg.mesas, extras: (cfg.extras || []).join(", "), servicoPct: cfg.servicoPct, rodape: cfg.rodape, bloquearSemEstoque: cfg.bloquearSemEstoque }), { pin: true });
  rota("PUT", "/api/config", ({ body }) => {
    const novo = { ...cfg, nome: texto(body.nome, 40, "Nome da loja", true), mesas: inteiro(body.mesas, "Número de mesas", 1), servicoPct: inteiro(body.servicoPct, "Serviço", 0),
      rodape: texto(body.rodape, 80, "Rodapé"), bloquearSemEstoque: Boolean(body.bloquearSemEstoque),
      extras: String(body.extras ?? "").split(",").map((x) => x.trim().slice(0, 20)).filter(Boolean).slice(0, 5) };
    if (novo.mesas > 80) throw new Erro(400, "No máximo 80 mesas.");
    if (novo.servicoPct > 30) throw new Erro(400, "Serviço de no máximo 30%.");
    if (body.novoPin) { if (!/^\d{4,8}$/.test(String(body.novoPin))) throw new Erro(400, "O PIN deve ter de 4 a 8 números."); novo.pinDono = String(body.novoPin); }
    const antes = cfg; cfg = novo;
    const lista = mesas();
    const presa = S.contas.find((c) => c.status === "aberta" && !lista.includes(c.mesa));
    if (presa) { cfg = antes; throw new Erro(409, `A mesa ${presa.mesa} tem conta aberta e seria removida. Feche a conta antes.`); }
    S.meta.config = { ...cfg }; marcar("meta", S.meta);
    return { ok: true };
  }, { pin: true });

  // Zerar dados de teste: apaga contas, itens e pagamentos e devolve o estoque movimentado pelas vendas
  rota("POST", "/api/zerar-vendas", () => {
    const porProduto = {};
    S.movimentos.filter((m) => m.conta_id != null).forEach((m) => (porProduto[m.produto_id] = (porProduto[m.produto_id] || 0) + m.qtd));
    Object.entries(porProduto).forEach(([id, soma]) => {
      const p = porId("produtos", Number(id)); if (!p) return;
      p.estoque = Math.round((p.estoque - soma) * 1000) / 1000; marcar("produtos", p);
    });
    const apagar = (loja, filtro) => { const sai = S[loja].filter(filtro); S[loja] = S[loja].filter((x) => !filtro(x)); sai.forEach((x) => marcar(loja, x, "del")); return sai.length; };
    const contas = apagar("contas", () => true);
    apagar("itens", () => true); apagar("pagamentos", () => true); apagar("movimentos", (m) => m.conta_id != null);
    return { contas };
  }, { pin: true });

  // ---------- Entrada única ----------
  async function chamar(metodo, url, corpo, pin) {
    const u = new URL(url, "http://local"), r = rotas.find((x) => x.metodo === metodo && x.re.test(u.pathname));
    if (!r) throw new Erro(404, "Rota não encontrada.");
    if (r.pin && String(pin) !== String(cfg.pinDono)) throw new Erro(401, "PIN do dono necessário.");
    let saida;
    try { saida = r.fn({ params: u.pathname.match(r.re).groups || {}, body: corpo || {}, query: Object.fromEntries(u.searchParams) }); }
    catch (e) { if (e instanceof Erro) throw e; console.error(e); throw new Erro(500, "Erro interno."); }
    saida = clone(saida);
    if (metodo !== "GET") {
      try { await salvar(); } catch (e) { console.error(e); throw new Erro(500, "Não foi possível salvar no aparelho. Confira o espaço de armazenamento."); }
    }
    return saida;
  }

  // ---------- Backup ----------
  async function exportar(pin) {
    if (String(pin) !== String(cfg.pinDono)) throw new Erro(401, "PIN do dono necessário.");
    S.meta.ultimoBackup = agora(); marcar("meta", S.meta); await salvar();
    return { app: "espetaria", versao: 1, exportado_em: agora(), dados: clone(S) };
  }
  async function restaurar(arquivo, pin) {
    if (String(pin) !== String(cfg.pinDono)) throw new Erro(401, "PIN do dono necessário.");
    const d = arquivo && arquivo.app === "espetaria" && arquivo.dados;
    if (!d || !LOJAS.every((l) => Array.isArray(d[l])) || !d.meta) throw new Erro(400, "Este arquivo não é um backup da espetaria.");
    S = { ...clone(d) };
    LOJAS.forEach((l) => (S.meta.seq[l] = Math.max(S.meta.seq[l] || 0, S[l].reduce((m, x) => Math.max(m, x.id), 0))));
    cfg = { ...PADRAO, ...S.meta.config };
    await new Promise((ok, falha) => {
      const tx = idb.transaction([...LOJAS, "meta"], "readwrite");
      LOJAS.forEach((l) => { const os = tx.objectStore(l); os.clear(); S[l].forEach((x) => os.put(x)); });
      tx.objectStore("meta").put(S.meta, "m");
      tx.oncomplete = ok; tx.onerror = tx.onabort = () => falha(tx.error);
    });
    sujos.clear();
    return { contas: S.contas.length, produtos: S.produtos.length };
  }

  return { iniciar, chamar, exportar, restaurar, Erro };
})();