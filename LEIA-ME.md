# Espetaria: mesas, comandas, estoque e conta (versão com Firebase)

Aplicativo para celular (PWA). Vários celulares enxergam as mesmas mesas e comandas. Cada pessoa entra com o seu login:
- **Dono:** tudo (estoque, vendas, configurações, equipe).
- **Equipe (garçom/caixa):** abre e fecha mesas, lança pedidos, imprime comanda e conta. Não vê vendas nem edita preços ou estoque (o estoque baixa sozinho com os pedidos).

## 1. Arquivos
Todos na mesma pasta: `index.html`, `style.css`, `app.js`, `banco-nuvem.js`, `firebase-config.js`, `sw.js`, `manifest.webmanifest`, `logo.png`, `icon-192.png`, `icon-512.png`.
`banco.js` é a versão antiga (só no aparelho) e não é usado.
`firestore.rules` e `firebase.json` ficam só no seu computador (não vão para o ar).

## 2. Firebase (projeto espetaria-cavalcante)
1. **Authentication:** método E-mail/senha ativado. O usuário do dono já criado.
2. **Firestore:** criado em southamerica-east1, modo produção.
3. **Regras:** no console, Firestore > Regras, cole o conteúdo de `firestore.rules` e **Publique**. Refaça isto sempre que o arquivo mudar.
4. **firebase-config.js:** configuração do app web e `LOJA_ID`. Não tem `import` nem `initializeApp`.

## 3. Primeira vez
1. Abra o app, entre com o e-mail e a senha do dono.
2. O app cria sozinho as configurações e um cardápio de exemplo (só no primeiro acesso do dono).
3. Estoque > **Configurações**: nome da loja, mesas, % de serviço.
4. Estoque > **Equipe**: cadastre cada garçom (nome, e-mail de login e senha). O e-mail pode ser inventado (ex.: maria@cavalcante.app). **Desativar** corta o acesso na hora.
5. Para testar e começar do zero: Configurações > **Apagar todas as vendas e mesas** (precisa de internet; o estoque volta ao que era antes das vendas).

## 4. Internet
- Precisa de internet na primeira abertura de cada aparelho e para o login.
- Sem internet o app abre e deixa lançar pedidos. As alterações ficam guardadas no aparelho e seguem sozinhas quando a conexão volta. Aparece um aviso amarelo no topo.
- Dois aparelhos sem internet ao mesmo tempo podem abrir a mesma mesa ou fechar a mesma conta. Quando a conexão voltar, confira.

## 5. Publicar
Firebase Hosting (grátis), GitHub Pages ou Vercel. Com Firebase: `firebase login`, `firebase init hosting` (public: `.`, não sobrescrever os arquivos), `firebase deploy`.
Antes de publicar, apague da pasta arquivos de backup (`espetaria-backup-*.json`).

## 6. Backup
Os dados ficam no Firebase (nuvem). Em Estoque > **Fazer backup** o dono baixa uma cópia em arquivo (precisa de internet). Não existe "restaurar" por tela nesta versão. O arquivo tem vendas e estoque, então guarde com cuidado.

## 7. Impressão (a definir com a impressora)
Por enquanto cada aparelho imprime sozinho, pelo botão **Impressão** (topo): navegador, app RawBT ou Bluetooth direto. Uma impressora Bluetooth só conversa com um aparelho por vez. Imprimir as comandas dos garçons na churrasqueira e na cozinha vira uma próxima etapa.

## 8. Limites
- A conta é comprovante sem valor fiscal.
- O login protege os dados. As regras do Firebase impedem a equipe de ler vendas ou mudar preços mesmo que alguém tente por fora do app.
- Senha esquecida: o dono usa **Redefinir senha** (só chega se o e-mail for real) ou desativa a pessoa e cadastra de novo com outro e-mail.
