// Banco de dados na nuvem (Firebase Firestore) com cache no aparelho.
// Vários celulares enxergam as mesmas mesas, comandas e estoque. Sem internet o app continua funcionando
// e envia as alterações sozinho quando a conexão voltar.
// A tela conversa com este arquivo pela função Banco.chamar(), com as mesmas rotas da versão que usava só o aparelho.
const Banco = (() => {
  "use strict";
  class Erro extends Error { constructor(status, msg) { super(msg); this.status = status; } }

  const PADRAO = {
    nome: "Espetaria Cavalcante", mesas: 20, extras: ["Balcão"], servicoPct: 10,
    bloquearSemEstoque: false, colunas: 48, setores: ["Churrasqueira", "Cozinha", "Bar"],
    formasPagamento: ["Dinheiro", "Pix", "Débito", "Crédito"], rodape: "Comprovante sem valor fiscal"
  };

  let auth = null, db = null, base = null;
  let S = { produtos: [], contas: [], itens: [] }, cfg = { ...PADRAO };
  let usuario = null, papel = null, nomeUsuario = "";
  let desligar = [];
  const ouvintesMudanca = new Set(), ouvintesErro = new Set(), ouvintesSaida = new Set();

  const col = (nome) => base.collection(nome);
  const ref = (nome, id) => col(nome).doc(String(id));
  const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
  const lembrar = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

  // ---------- Utilidades ----------
  const pad = (n) => String(n).padStart(2, "0");
  function agora() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
  const hoje = () => agora().slice(0, 10);
  const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
  const inteiro = (v, nome, min = 0) => { const n = Number(v); if (!Number.isInteger(n) || n < min) throw new Erro(400, `${nome} inválido.`); return n; };
  const texto = (v, max, nome, obrig = false) => { const t = String(v ?? "").trim().slice(0, max); if (obrig && !t) throw new Erro(400, `${nome} é obrigatório.`); return t; };
  const mesas = () => Array.from({ length: cfg.mesas }, (_, i) => String(i + 1)).concat(cfg.extras || []);
  const porId = (lista, id) => S[lista].find((x) => x.id === id);
  const itensDe = (cid) => S.itens.filter((i) => i.conta_id === cid).sort((a, b) => a.id - b.id);
  const abertaDaMesa = (m) => S.contas.find((c) => c.mesa === m && c.status === "aberta");
  const soma = (lista, f) => lista.reduce((s, x) => s + f(x), 0);
  // Cada aparelho gera os próprios números sem combinar com os outros: tempo + contador aleatório.
  let seq = Math.floor(Math.random() * 1000);
  const novoId = () => Date.now() * 1000 + (seq = (seq + 1) % 1000);

  const textoErroAuth = (e) => {
    const c = e && e.code;
    if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-login-credentials"].includes(c)) return "E-mail ou senha incorretos.";
    if (c === "auth/invalid-email") return "Esse e-mail não parece certo.";
    if (c === "auth/too-many-requests") return "Muitas tentativas. Espere alguns minutos e tente de novo.";
    if (c === "auth/network-request-failed") return "Sem internet. Conecte-se e tente de novo.";
    if (c === "auth/email-already-in-use") return "Já existe um usuário com esse e-mail.";
    if (c === "auth/weak-password") return "A senha precisa ter pelo menos 6 caracteres.";
    if (c === "auth/user-disabled") return "Este usuário foi desativado.";
    return (e && e.message) || "Não foi possível concluir.";
  };

  // ---------- Entrada e papéis ----------
  function preparar() {
    if (typeof firebase === "undefined") return Promise.reject(new Erro(503, "Conecte-se à internet para abrir o app pela primeira vez neste aparelho."));
    if (typeof firebaseConfig === "undefined" || String(firebaseConfig.apiKey).includes("COLE_AQUI")) return Promise.reject(new Erro(500, "O arquivo firebase-config.js ainda não foi preenchido."));
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth(); db = firebase.firestore();
    db.enablePersistence({ synchronizeTabs: true }).catch((e) => console.warn("Cache offline indisponível:", e && e.code));
    base = db.collection("lojas").doc(LOJA_ID);
    return new Promise((ok) => {
      let primeira = true;
      auth.onAuthStateChanged((u) => {
        usuario = u;
        if (primeira) { primeira = false; ok(u); return; }
        if (!u) { sairLocal(); ouvintesSaida.forEach((f) => f()); }
      });
    });
  }
  async function entrar(email, senha) {
    try { await auth.signInWithEmailAndPassword(String(email).trim(), String(senha)); }
    catch (e) { throw new Erro(401, textoErroAuth(e)); }
  }
  function sairLocal() { desligar.forEach((f) => { try { f(); } catch { /* já desligado */ } }); desligar = []; S = { produtos: [], contas: [], itens: [] }; papel = null; nomeUsuario = ""; }
  async function sair() { sairLocal(); await auth.signOut(); }

  async function descobrirPapel(u) {
    const chave = "espetaria.acesso." + u.uid;
    try {
      const m = await ref("membros", u.uid).get();
      if (m.exists) {
        const d = m.data();
        if (d.ativo !== true) throw new Erro(403, "Seu acesso está desativado. Fale com o dono.");
        papel = "equipe"; nomeUsuario = d.nome || u.email;
      } else {
        // Quem não tem cadastro de equipe só entra se for o dono: só ele consegue listar a equipe.
        try { await col("membros").limit(1).get(); papel = "dono"; nomeUsuario = "Dono"; }
        catch (e) {
          if (e && e.code === "permission-denied") throw new Erro(403, "Seu acesso ainda não foi liberado. Peça ao dono para cadastrar seu e-mail.");
          throw e;
        }
      }
      guardar(chave, JSON.stringify({ papel, nome: nomeUsuario }));
    } catch (e) {
      if (e instanceof Erro) { if (e.status === 403) guardar(chave, ""); throw e; }
      const salvo = lembrar(chave);                       // sem internet: usa o último acesso confirmado
      if (!salvo) throw new Erro(503, "Conecte-se à internet para entrar pela primeira vez neste aparelho.");
      ({ papel, nome: nomeUsuario } = JSON.parse(salvo));
    }
  }

  // ---------- Dados em tempo real ----------
  const avisarMudanca = () => ouvintesMudanca.forEach((f) => f());
  // comMeta: também avisa quando o dado passa de "guardado no aparelho" para "confirmado pelo servidor" (usado para criar os dados iniciais só com certeza)
  function ouvir(consulta, aoReceber, comMeta = false) {
    return new Promise((ok, falha) => {
      let primeiro = true;
      const recebeu = (snap) => { aoReceber(snap); if (primeiro) { primeiro = false; ok(); } else avisarMudanca(); };
      const deuErro = (e) => { if (primeiro) { primeiro = false; falha(e); } else ouvintesErro.forEach((f) => f("A conexão com os dados foi recusada. Entre de novo.")); };
      const parar = comMeta ? consulta.onSnapshot({ includeMetadataChanges: true }, recebeu, deuErro) : consulta.onSnapshot(recebeu, deuErro);
      desligar.push(parar);
    });
  }
  async function iniciar() {
    if (!auth || !auth.currentUser) throw new Erro(401, "Entre com seu usuário.");
    await descobrirPapel(auth.currentUser);
    const lista = (snap) => snap.docs.map((d) => d.data());
    const prontos = Promise.all([
      ouvir(col("config").doc("geral"), (snap) => {
        cfg = snap.exists ? { ...PADRAO, ...snap.data() } : { ...PADRAO };
        if (papel === "dono" && !snap.exists && !snap.metadata.fromCache) col("config").doc("geral").set(PADRAO).catch(falhou);
      }, true),
      ouvir(col("produtos"), (snap) => {
        S.produtos = lista(snap);
        if (papel === "dono" && snap.empty && !snap.metadata.fromCache) semear();
      }, true),
      ouvir(col("contas").where("status", "==", "aberta"), (snap) => { S.contas = lista(snap); }),
      ouvir(col("itens").where("conta_aberta", "==", true), (snap) => { S.itens = lista(snap); })
    ]);
    const limite = new Promise((_, falha) => setTimeout(() => falha(new Erro(503, "Sem conexão e sem dados salvos neste aparelho. Conecte-se à internet.")), 12000));
    try { await Promise.race([prontos, limite]); }
    catch (e) {
      sairLocal();
      if (e instanceof Erro) throw e;
      if (e && e.code === "permission-denied") throw new Erro(403, "Seu acesso ainda não foi liberado. Peça ao dono para cadastrar seu e-mail.");
      throw new Erro(503, "Não foi possível abrir os dados. Confira a internet e tente de novo.");
    }
  }
  function semear() {
    const b = db.batch(), t = agora();
    [
      ["Espetinho de carne", "Espetinhos", "Churrasqueira", 1000, "un", 1, 60, 12], ["Espetinho de frango", "Espetinhos", "Churrasqueira", 900, "un", 1, 60, 12],
      ["Espetinho de coração", "Espetinhos", "Churrasqueira", 1000, "un", 1, 40, 10], ["Espetinho de linguiça", "Espetinhos", "Churrasqueira", 900, "un", 1, 40, 10],
      ["Queijo coalho", "Espetinhos", "Churrasqueira", 1000, "un", 1, 40, 10], ["Medalhão de frango", "Espetinhos", "Churrasqueira", 1100, "un", 1, 30, 8],
      ["Farofa", "Acompanhamentos", "Cozinha", 600, "un", 1, 30, 6], ["Vinagrete", "Acompanhamentos", "Cozinha", 500, "un", 1, 30, 6],
      ["Mandioca frita", "Acompanhamentos", "Cozinha", 1800, "porção", 1, 15, 4], ["Batata frita", "Acompanhamentos", "Cozinha", 2200, "porção", 1, 15, 4],
      ["Cerveja 600ml", "Bebidas", "Bar", 1400, "un", 1, 48, 12], ["Cerveja long neck", "Bebidas", "Bar", 1000, "un", 1, 48, 12],
      ["Refrigerante lata", "Bebidas", "Bar", 600, "un", 1, 36, 12], ["Refrigerante 2L", "Bebidas", "Bar", 1400, "un", 1, 12, 4],
      ["Água", "Bebidas", "Bar", 400, "un", 1, 36, 12], ["Suco natural", "Bebidas", "Bar", 800, "un", 0, 0, 0]
    ].forEach(([nome, categoria, setor, preco, unidade, controla, estoque, minimo], i) => {
      const id = i + 1;                                   // números fixos: se dois aparelhos semearem juntos, um só sobrescreve o outro
      b.set(ref("produtos", id), { id, nome, categoria, setor, preco, unidade, controla, estoque: controla ? estoque : 0, minimo, ativo: 1 });
      if (controla && estoque) { const mid = novoId(); b.set(ref("movimentos", mid), { id: mid, produto_id: id, tipo: "entrada", qtd: estoque, custo: null, obs: "Estoque inicial", conta_id: null, criado_em: t }); }
    });
    b.commit().catch(falhou);
  }

  // ---------- Gravação ----------
  // As rotas alteram os dados em memória e anotam o que mudou; no fim tudo vai junto, em um lote.
  // O lote não é esperado: sem internet ele fica guardado no aparelho e segue sozinho depois.
  let ops = new Map(), incs = new Map(), novos = new Set();
  const marcar = (loja, obj, op = "put") => ops.set(loja + "/" + obj.id, { loja, obj, op });
  const descartar = () => { ops = new Map(); incs = new Map(); novos = new Set(); };
  function falhou(e) {
    console.error(e);
    const msg = e && e.code === "permission-denied" ? "O servidor recusou esta alteração. Seu acesso pode ter mudado." : "Não foi possível salvar: " + ((e && e.message) || "erro desconhecido");
    ouvintesErro.forEach((f) => f(msg));
  }
  function enviar() {
    if (!ops.size && !incs.size) return;
    const b = db.batch(), mud = ops, inc = incs, nov = novos;
    descartar();
    for (const { loja, obj, op } of mud.values()) {
      const r = ref(loja, obj.id);
      if (op === "del") b.delete(r);
      else if (loja === "produtos" && !nov.has(obj.id)) { const { estoque, ...resto } = clone(obj); b.set(r, resto, { merge: true }); }   // estoque só muda por soma (abaixo)
      else b.set(r, clone(obj));
    }
    for (const [id, delta] of inc) b.update(ref("produtos", id), { estoque: firebase.firestore.FieldValue.increment(delta) });
    b.commit().catch(falhou);
  }

  // ---------- Regras de estoque e conta ----------
  function mover(prod, delta, tipo, obs, contaId, custo) {
    prod.estoque = Math.round((prod.estoque + delta) * 1000) / 1000;
    if (novos.has(prod.id)) marcar("produtos", prod);
    else incs.set(prod.id, (incs.get(prod.id) || 0) + delta);
    const m = { id: novoId(), produto_id: prod.id, tipo, qtd: delta, custo: custo ?? null, obs: obs ?? null, conta_id: contaId ?? null, criado_em: agora() };
    marcar("movimentos", m);
  }
  function contaAberta(id) {
    const c = porId("contas", id);
    if (!c) throw new Erro(404, "Conta não encontrada ou já fechada.");
    return c;
  }
  function visao(id) {
    const c = porId("contas", id);
    if (!c) throw new Erro(404, "Conta não encontrada.");
    const v = { ...c, itens: itensDe(id), pagamentos: [] };
    if (c.status === "aberta") v.subtotal = soma(v.itens, (i) => i.preco * i.qtd);
    return v;
  }
  async function buscarConta(id) {
    let d;
    try { d = await ref("contas", id).get(); } catch { throw new Erro(503, "Sem conexão para abrir esta conta."); }
    if (!d.exists) throw new Erro(404, "Conta não encontrada.");
    const itens = (await col("itens").where("conta_id", "==", id).get()).docs.map((x) => x.data()).sort((a, b) => a.id - b.id);
    let pagamentos = [];
    if (papel === "dono") pagamentos = (await col("pagamentos").where("conta_id", "==", id).get()).docs.map((x) => x.data());
    return { ...d.data(), itens, pagamentos };
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
      const n = { id: novoId(), conta_id: conta.id, produto_id: produto.id, nome: produto.nome, preco: produto.preco, qtd, obs, setor: produto.setor, impresso: 0, criado_em: agora(), conta_aberta: true };
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
    return {
      config: { nome: cfg.nome, mesas: mesas(), setores: cfg.setores, servicoPct: cfg.servicoPct, formas: cfg.formasPagamento, colunas: cfg.colunas,
        rodape: cfg.rodape, bloquearSemEstoque: cfg.bloquearSemEstoque, pinPadrao: false },
      backup: { ultimo: lembrar("espetaria.ultimoBackup"), dias: null, atrasado: false },
      produtos: S.produtos.filter((p) => p.ativo).sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nome.localeCompare(b.nome)),
      contas: abertas.map((c) => {
        const it = itensDe(c.id);
        return { id: c.id, mesa: c.mesa, nome: c.nome, pessoas: c.pessoas, aberta_em: c.aberta_em, subtotal: soma(it, (i) => i.preco * i.qtd),
          qtd_itens: soma(it, (i) => i.qtd), nao_impressos: soma(it.filter((i) => !i.impresso), (i) => i.qtd) };
      })
    };
  });

  rota("POST", "/api/contas", ({ body }) => {
    const mesa = texto(body.mesa, 20, "Mesa", true);
    if (!mesas().includes(mesa)) throw new Erro(400, "Mesa inexistente.");
    if (abertaDaMesa(mesa)) throw new Erro(409, "Esta mesa já está aberta.");
    const c = { id: novoId(), mesa, nome: texto(body.nome, 40, "Nome"), pessoas: Math.max(1, inteiro(body.pessoas ?? 1, "Pessoas", 1)), status: "aberta",
      aberta_em: agora(), aberta_por: nomeUsuario, fechada_em: null, dia: null, subtotal: null, servico: null, desconto: null, total: null, troco: null };
    S.contas.push(c); marcar("contas", c);
    return visao(c.id);
  });
  rota("GET", "/api/contas/:id", ({ params }) => { const id = inteiro(params.id, "Conta"); return porId("contas", id) ? visao(id) : buscarConta(id); });
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
    const dia = hoje(), gravados = [];
    // Número fixo por conta: se dois aparelhos fecharem a mesma conta ao mesmo tempo, o pagamento não duplica.
    pags.filter((p) => p.valor > 0).forEach((p, n) => { const x = { id: `${conta.id}-${n + 1}`, conta_id: conta.id, forma: p.forma, valor: p.valor, dia }; gravados.push(x); marcar("pagamentos", x); });
    Object.assign(conta, { status: "fechada", fechada_em: agora(), dia, subtotal, servico, desconto, total, troco }); marcar("contas", conta);
    itens.forEach((i) => { i.conta_aberta = false; i.dia = dia; marcar("itens", i); });
    const saida = { ...conta, itens: clone(itens), pagamentos: clone(gravados) };
    S.contas.splice(S.contas.indexOf(conta), 1); S.itens = S.itens.filter((i) => i.conta_id !== conta.id);
    return saida;
  });

  // Estoque (só o dono)
  rota("GET", "/api/produtos/todos", () => [...S.produtos].sort((a, b) => b.ativo - a.ativo || a.categoria.localeCompare(b.categoria) || a.nome.localeCompare(b.nome)), { dono: true });
  function lerProduto(b) {
    return { nome: texto(b.nome, 60, "Nome", true), categoria: texto(b.categoria, 30, "Categoria") || "Outros", setor: cfg.setores.includes(b.setor) ? b.setor : cfg.setores[0],
      preco: inteiro(b.preco, "Preço", 0), unidade: texto(b.unidade, 10, "Unidade") || "un", controla: b.controla ? 1 : 0, minimo: Math.max(0, Number(b.minimo) || 0) };
  }
  rota("POST", "/api/produtos", ({ body }) => {
    const d = lerProduto(body), p = { id: novoId(), ...d, estoque: 0, ativo: 1 };
    novos.add(p.id); S.produtos.push(p); marcar("produtos", p);
    const inicial = Math.max(0, Number(body.estoque) || 0);
    if (d.controla && inicial > 0) mover(p, inicial, "entrada", "Estoque inicial");
    return p;
  }, { dono: true });
  rota("PUT", "/api/produtos/:id", ({ params, body }) => {
    const p = porId("produtos", inteiro(params.id, "Produto", 1));
    if (!p) throw new Erro(404, "Produto não encontrado.");
    Object.assign(p, lerProduto(body), { ativo: body.ativo === false ? 0 : 1 }); marcar("produtos", p);
    return p;
  }, { dono: true });
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
  }, { dono: true });
  rota("GET", "/api/movimentos", async ({ query }) => {
    const pid = Number(query.produto_id) || 0;
    const q = pid ? col("movimentos").where("produto_id", "==", pid) : col("movimentos").orderBy("criado_em", "desc").limit(150);
    const lista = (await q.get()).docs.map((d) => d.data()).sort((a, b) => b.id - a.id).slice(0, 150);
    return lista.map((m) => { const p = porId("produtos", m.produto_id) || {}; return { ...m, produto: p.nome || "(removido)", unidade: p.unidade || "" }; });
  }, { dono: true });

  // Vendas (só o dono): lê do servidor só o dia pedido
  rota("GET", "/api/vendas", async ({ query }) => {
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(query.data || "") ? query.data : hoje();
    const [cs, ps, is] = await Promise.all(["contas", "pagamentos", "itens"].map((n) => col(n).where("dia", "==", dia).get().then((s) => s.docs.map((d) => d.data()))));
    const contas = cs.filter((c) => c.status === "fechada").sort((a, b) => b.fechada_em.localeCompare(a.fechada_em));
    const r = { dia, contas: contas.length, subtotal: 0, servico: 0, desconto: 0, total: 0, porForma: {}, top: [] }, top = {};
    const lista = contas.map((c) => {
      r.subtotal += c.subtotal; r.servico += c.servico; r.desconto += c.desconto; r.total += c.total;
      const pagamentos = ps.filter((p) => p.conta_id === c.id);
      pagamentos.forEach((p) => (r.porForma[p.forma] = (r.porForma[p.forma] || 0) + p.valor));
      is.filter((i) => i.conta_id === c.id).forEach((i) => { const t = (top[i.nome] = top[i.nome] || { nome: i.nome, qtd: 0, valor: 0 }); t.qtd += i.qtd; t.valor += i.qtd * i.preco; });
      return { ...c, pagamentos };
    });
    r.top = Object.values(top).sort((a, b) => b.qtd - a.qtd).slice(0, 8);
    return { resumo: r, contas: lista };
  }, { dono: true });

  // Configurações da loja (só o dono altera)
  rota("GET", "/api/config", () => ({ nome: cfg.nome, mesas: cfg.mesas, extras: (cfg.extras || []).join(", "), servicoPct: cfg.servicoPct, rodape: cfg.rodape, bloquearSemEstoque: cfg.bloquearSemEstoque }), { dono: true });
  rota("PUT", "/api/config", ({ body }) => {
    const novo = { ...cfg, nome: texto(body.nome, 40, "Nome da loja", true), mesas: inteiro(body.mesas, "Número de mesas", 1), servicoPct: inteiro(body.servicoPct, "Serviço", 0),
      rodape: texto(body.rodape, 80, "Rodapé"), bloquearSemEstoque: Boolean(body.bloquearSemEstoque),
      extras: String(body.extras ?? "").split(",").map((x) => x.trim().slice(0, 20)).filter(Boolean).slice(0, 5) };
    if (novo.mesas > 80) throw new Erro(400, "No máximo 80 mesas.");
    if (novo.servicoPct > 30) throw new Erro(400, "Serviço de no máximo 30%.");
    const antes = cfg; cfg = novo;
    const lista = mesas();
    const presa = S.contas.find((c) => c.status === "aberta" && !lista.includes(c.mesa));
    if (presa) { cfg = antes; throw new Erro(409, `A mesa ${presa.mesa} tem conta aberta e seria removida. Feche a conta antes.`); }
    col("config").doc("geral").set(clone(cfg)).catch(falhou);
    return { ok: true };
  }, { dono: true });

  // Zerar dados de teste: apaga contas, itens e pagamentos e devolve o estoque movimentado pelas vendas (precisa de internet)
  rota("POST", "/api/zerar-vendas", async () => {
    if (!navigator.onLine) throw new Erro(503, "Precisa de internet para apagar as vendas.");
    const ler = async (n) => (await col(n).get()).docs.map((d) => d.data());
    const [contas, itens, pags, movs] = await Promise.all([ler("contas"), ler("itens"), ler("pagamentos"), ler("movimentos")]);
    const deVenda = movs.filter((m) => m.conta_id != null), porProduto = {};
    deVenda.forEach((m) => (porProduto[m.produto_id] = (porProduto[m.produto_id] || 0) + m.qtd));
    const tarefas = [
      ...Object.entries(porProduto).filter(([id]) => porId("produtos", Number(id))).map(([id, s]) => (b) => b.update(ref("produtos", id), { estoque: firebase.firestore.FieldValue.increment(-s) })),
      ...contas.map((x) => (b) => b.delete(ref("contas", x.id))), ...itens.map((x) => (b) => b.delete(ref("itens", x.id))),
      ...pags.map((x) => (b) => b.delete(ref("pagamentos", x.id))), ...deVenda.map((x) => (b) => b.delete(ref("movimentos", x.id)))
    ];
    for (let i = 0; i < tarefas.length; i += 400) { const b = db.batch(); tarefas.slice(i, i + 400).forEach((t) => t(b)); await b.commit(); }
    return { contas: contas.length };
  }, { dono: true });

  // ---------- Entrada única ----------
  async function chamar(metodo, url, corpo) {
    if (!papel) throw new Erro(401, "Entre com seu usuário.");
    const u = new URL(url, "http://local"), r = rotas.find((x) => x.metodo === metodo && x.re.test(u.pathname));
    if (!r) throw new Erro(404, "Rota não encontrada.");
    if (r.dono && papel !== "dono") throw new Erro(403, "Só o dono pode fazer isso.");
    const traduz = (e) => { if (e instanceof Erro) return e; console.error(e); return new Erro(500, e && e.code === "permission-denied" ? "O servidor recusou a consulta." : "Erro ao falar com o servidor."); };
    let saida;
    try { saida = r.fn({ params: u.pathname.match(r.re).groups || {}, body: corpo || {}, query: Object.fromEntries(u.searchParams) }); }
    catch (e) { descartar(); throw traduz(e); }
    if (saida && typeof saida.then === "function") { try { saida = await saida; } catch (e) { throw traduz(e); } }
    else if (metodo !== "GET") enviar();
    return clone(saida);
  }

  // ---------- Backup (só o dono): copia de tudo em um arquivo ----------
  async function exportar() {
    if (papel !== "dono") throw new Erro(403, "Só o dono pode fazer isso.");
    if (!navigator.onLine) throw new Erro(503, "Precisa de internet para fazer o backup.");
    const ler = async (n) => (await col(n).get()).docs.map((d) => d.data());
    const [produtos, contas, itens, pagamentos, movimentos] = await Promise.all(["produtos", "contas", "itens", "pagamentos", "movimentos"].map(ler));
    guardar("espetaria.ultimoBackup", agora());
    return { app: "espetaria", versao: 2, exportado_em: agora(), dados: clone({ config: cfg, produtos, contas, itens, pagamentos, movimentos }) };
  }

  // ---------- Equipe (só o dono) ----------
  const soDono = () => { if (papel !== "dono") throw new Erro(403, "Só o dono pode fazer isso."); };
  async function listarEquipe() {
    soDono();
    try { return (await col("membros").get()).docs.map((d) => ({ uid: d.id, ...d.data() })).sort((a, b) => String(a.nome).localeCompare(String(b.nome))); }
    catch { throw new Erro(503, "Não foi possível carregar a equipe. Confira a internet."); }
  }
  async function criarMembro({ nome, email, senha }) {
    soDono();
    nome = texto(nome, 40, "Nome", true); email = texto(email, 80, "E-mail", true).toLowerCase();
    if (String(senha || "").length < 6) throw new Erro(400, "A senha precisa ter pelo menos 6 caracteres.");
    if (!navigator.onLine) throw new Erro(503, "Precisa de internet para cadastrar alguém.");
    // O cadastro usa uma conexão separada, para o dono não ser desconectado ao criar o login da pessoa.
    const outra = firebase.initializeApp(firebaseConfig, "cadastro-" + Date.now());
    let uid;
    try { const c = await outra.auth().createUserWithEmailAndPassword(email, String(senha)); uid = c.user.uid; await outra.auth().signOut(); }
    catch (e) { throw new Erro(400, textoErroAuth(e)); }
    finally { outra.delete().catch(() => {}); }
    try { await ref("membros", uid).set({ nome, email, papel: "equipe", ativo: true, criado_em: agora() }); }
    catch (e) { console.error(e); throw new Erro(500, "O login foi criado, mas não foi possível liberar o acesso. Tente de novo em instantes."); }
    return { uid };
  }
  async function definirAtivo(uid, ativo) {
    soDono();
    try { await ref("membros", uid).update({ ativo: Boolean(ativo) }); }
    catch (e) { console.error(e); throw new Erro(503, "Não foi possível alterar. Confira a internet."); }
  }
  async function redefinirSenha(email) {
    soDono();
    try { await auth.sendPasswordResetEmail(String(email)); }
    catch (e) { throw new Erro(400, textoErroAuth(e)); }
  }

  return {
    preparar, entrar, sair, iniciar, chamar, exportar, Erro,
    papel: () => papel, nome: () => nomeUsuario, email: () => (usuario && usuario.email) || "",
    aoMudar: (f) => ouvintesMudanca.add(f), aoErro: (f) => ouvintesErro.add(f), aoSair: (f) => ouvintesSaida.add(f),
    equipe: { listar: listarEquipe, criar: criarMembro, definirAtivo, redefinirSenha }
  };
})();
