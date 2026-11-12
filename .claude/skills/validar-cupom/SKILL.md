---
name: validar-cupom
description: Testa no checkout real quais cupons funcionam numa oferta do Promo Radar e quanto ela custa de fato. Abre a oferta no Chrome do usuário (Claude in Chrome), põe no carrinho, aplica os cupons, lê o total e tira do carrinho o que adicionou — nunca finaliza a compra. Use com o id do alerta ("/validar-cupom 12"), com o id da oferta ("/validar-cupom oferta 169") ou com um link e cupom ("/validar-cupom https://... CUPOM10").
argument-hint: <id do alerta> | oferta <id> | <url> [cupom]
---

# Validar cupom no checkout

Você confirma, no navegador real do usuário, se uma oferta do Promo Radar ainda vale e quanto ela custa de fato no checkout.

Argumentos: `$ARGUMENTS`

API do Promo Radar: `${PROMO_RADAR_URL:-http://localhost:4321}`. Nos exemplos ela aparece como `$API`.

## Regras invioláveis

- **Nunca finalize a compra.** Não clique em "Finalizar", "Fechar pedido", "Pagar", "Comprar agora", "Confirmar pagamento" nem em nada equivalente.
- **Não preencha dados de pagamento, endereço ou CPF**, e não altere nada na conta do usuário.
- **Não resolva captcha e não contorne verificação anti-bot.** Se aparecer uma, pare e reporte `bloqueado`.
- **Se a loja pedir login e o usuário não estiver logado, não faça login.** Reporte `bloqueado` com a mensagem "precisa estar logado na <loja>".
- **No fim, mexa só no que você adicionou.** Antes de adicionar o produto, anote o que já está no carrinho. No final, remova apenas o item que você colocou. Se você aplicou um cupom e o site deixar, remova o cupom também.
- Trabalhe numa **aba nova** e feche essa aba no final.

## Passo a passo

1. **Carregue as ferramentas do Chrome** com uma única chamada ToolSearch:
   `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__find,mcp__claude-in-chrome__form_input,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__tabs_close_mcp`
   Em seguida chame `tabs_context_mcp` e abra uma aba nova com `tabs_create_mcp`.

2. **Descubra o que validar** (se a loja for o AliExpress, siga também a seção "AliExpress" no fim):
   - Se o argumento for só um número, é um alerta: rode `curl -s $API/api/alerts/<id>`.
   - Se for `oferta <id>`, rode `curl -s $API/api/offers/<id>`.
   - Nos dois casos você recebe `url`, `store_name`, `title`, `final_price`, `coupon` (cupom da oferta) e `store_coupons` (cupons conhecidos da loja que cabem nesse preço, já ordenados do maior desconto para o menor, com `discount` e `min_order` quando se sabe).
   - Se o argumento for uma URL, use a URL e o cupom informados.
   - Monte a lista de cupons a testar, nesta ordem: `coupon` da oferta, depois os `store_coupons` (no máximo 5 no total). Não invente códigos.

3. **Chegue na página do produto na loja.** Se a `url` for do Promobit ou do Pelando, abra-a e clique em "Ir à loja", "Pegar promoção" ou equivalente. Confira se o produto da loja bate com o `title` da oferta: mesmo modelo, mesma capacidade, mesmo tamanho de tela.

4. **Verifique o preço e a disponibilidade.** Se o produto estiver esgotado ou indisponível, reporte `invalido` com a mensagem "esgotado". Anote o preço exibido.

5. **Leia o carrinho atual** (para saber o que já estava lá). Depois adicione o produto com quantidade 1 e vá para o carrinho ou para a etapa do checkout onde existe o campo de cupom.

6. **Aplique os cupons, um de cada vez.** Para cada cupom, leia a mensagem da loja ("cupom aplicado", "inválido", "expirado", "não aplicável a este produto", "valor mínimo…") e o total. Reporte cada cupom testado:
   ```bash
   curl -s -X POST $API/api/coupons/check -H 'content-type: application/json' \
     -d '{"store":"<loja>","code":"<CUPOM>","status":"valido|invalido","message":"<mensagem da loja> · total R$ <total> no <produto>"}'
   ```
   - `invalido` só quando a loja disser que o código **não existe, expirou ou esgotou**. Se a recusa for por valor mínimo ou por não valer para aquele produto, **não marque `invalido`** (o código pode valer em outra compra): apenas registre na mensagem final.
   - Se a tela mostrar o mínimo e o desconto do cupom, mande também `"minOrder": 290, "discount": 50`.
   - **Cupons que a própria loja oferece no checkout** (lista "cupons disponíveis", "cupom da loja", "resgatar") também contam: aplique o melhor e reporte com `status: "valido"`, mesmo que não estivessem na lista.
   Fique com a combinação que deu o **menor total**.

7. **Limpe:** remova o item que você adicionou e, se der, o cupom. Feche a aba.

8. **Reporte o resultado.** Para alerta, use `$API/api/alerts/<id>/validation`; para `oferta <id>`, use `$API/api/offers/<id>/validation`. O corpo é o mesmo:
   ```bash
   curl -s -X POST $API/api/offers/<id>/validation -H 'content-type: application/json' \
     -d '{"status":"valido","total":440.77,"code":null,"via":"cupom da loja R$ 60 + desconto AliExpress R$ 39,02",
          "steps":["Abra o anúncio e escolha a variação Z1C Gray, quantidade 1","Na página do produto, clique em Resgatar no cupom da loja R$ 60 acima de R$ 420","Adicione ao carrinho; no carrinho deixe marcado só este item","Clique em Comprar (1); frete Padrão R$ 41,46","Não digite código: os descontos já entram sozinhos","Deixe Moedas desligadas"],
          "breakdown":[{"label":"Subtotal","amount":498.33},{"label":"Cupom da loja","amount":-60},{"label":"Desconto AliExpress","amount":-39.02},{"label":"Frete","amount":41.46},{"label":"Total","amount":440.77}],
          "message":"AEMEGA3 aceito mas pior (R$ 450,77); AEMEGA1 pior (R$ 484,77)"}'
   ```
   - `total`: o **menor** total que você conseguiu, como aparece no checkout antes de escolher a forma de pagamento (com frete e impostos). Se a loja já mostra o preço no Pix, informe isso na mensagem.
   - `code`: o código digitado que deu esse menor total. Use `null` se o menor total veio sem digitar código.
   - `via`: em poucas palavras, **o que gerou o desconto** do menor total: `"cupom AEMEGA3"`, `"cupom automático da loja R$ 60"`, `"cupom AEMEGA3 + moedas"`. Esse texto aparece para o usuário ao lado do preço.
   - `steps` (**obrigatório quando `status` for `valido` ou `sem_cupom`**): a receita para o usuário chegar **no mesmo total** sozinho, em passos curtos e na ordem. Inclua tudo que mudou o preço: variação, quantidade, cupom que você resgatou ("Resgatar", "Obter"), código digitado, frete escolhido, moedas ligadas ou desligadas, e quais itens ficaram marcados no carrinho. Se alguma coisa já estava aplicada na conta antes do teste, diga isso.
   - `breakdown` (**obrigatório** quando houver total): cada linha do resumo de valores do checkout, com o nome que a loja usa e o valor (descontos negativos), terminando no Total. Não junte descontos numa linha só nem escreva "outros": se a loja só mostra o total do desconto, abra o detalhe (ícone de informação, "ver detalhes") e copie as linhas.
   - `message`: uma linha com o resultado de cada cupom testado, para o usuário ver o que funcionou e o que não funcionou.

   Escolha `status` assim:
   - `valido`: o checkout confirmou o preço. Use também quando o desconto veio **sozinho** (cupom da loja aplicado automaticamente, moedas, promoção no carrinho), sem código digitado; nesse caso `code` é `null` e `via` explica o desconto.
   - `sem_cupom`: o preço confere, mas não houve desconto nenhum (nem código, nem automático). Mande o `total`.
   - `invalido`: o preço não está mais disponível, o produto esgotou ou é outro modelo.
   - `bloqueado`: login, captcha ou verificação impediram o teste.
   - `erro`: qualquer outro problema. Explique em `message`.

9. **Responda em uma linha** com o resultado. Exemplo: "✅ KaBuM: total R$ 1.899,90 com PLAY300 (cupom válido)."

## AliExpress

O AliExpress funciona diferente das lojas brasileiras; siga estas regras quando `store_name` for AliExpress:

- **Precisa estar logado.** Se a página pedir login, reporte `bloqueado` ("precisa estar logado no AliExpress").
- **Escolha a variação certa** (cor, versão, "com fio/sem fio") que bate com o `title`. O preço da busca é o da variação mais barata, então confira o preço da variação escolhida.
- **O campo de código fica na tela de confirmação do pedido**, não no carrinho. Para chegar lá, adicione ao carrinho, abra o carrinho, deixe marcado **só** o item que você adicionou e clique no botão "Comprar (1)" ou "Finalizar compra" do carrinho. Essa tela ainda não cria pedido: ela é o resumo, com endereço, frete, impostos e o campo "Código promocional" ou "Cupom do AliExpress".
- **Nessa tela, nunca clique em "Fazer pedido", "Pagar agora", "Confirmar e pagar" nem equivalente.** Leia o total e volte.
- **Não use "Comprar agora" na página do produto**, porque em algumas contas ele usa o cartão salvo e pula etapas.
- **Cupons AEMEGA (e similares) são por faixa de valor.** Cada código só vale acima de um valor mínimo. Teste primeiro os que aparecem como aplicáveis na tela. Se o AliExpress já aplicar sozinho um cupom da loja ou de moedas, anote isso na mensagem.
- **Anote o resumo de valores linha a linha** (Subtotal, Desconto do AliExpress, Cupom da loja, Cupom de código, Moedas, Frete, Impostos, Total) antes de sair da tela. Ele vai para `breakdown`.
- **O carrinho do usuário pode ter outros itens marcados.** Você desmarca os outros para testar só este; diga isso nos `steps`, porque se o usuário fechar com tudo marcado o total muda.
- **Impostos:** registre o total *com* impostos e frete que a tela mostrar. Diga na mensagem se o envio é do Brasil ou internacional e o prazo estimado.
- Ao terminar, volte ao carrinho e remova o item que você adicionou.
