---
name: cacar-oferta
description: Caça o menor preço de um produto em várias lojas usando o Chrome do usuário (Claude in Chrome) e envia o que encontrou para o Promo Radar, que passa a monitorar e toca o alarme se bater o recorde. Use quando o usuário disser o que quer comprar ("/cacar-oferta TV 50 polegadas até 2500").
argument-hint: <produto> [até <preço máximo>]
---

# Caçar oferta

Você faz uma varredura única e profunda pelo menor preço de um produto, inclusive nas lojas que o scanner automático do Promo Radar não consegue ler, e alimenta o app com o resultado.

Pedido: `$ARGUMENTS`

API do Promo Radar: `${PROMO_RADAR_URL:-http://localhost:4321}`. Nos exemplos ela aparece como `$API`.

## Regras

- Navegue em **ritmo humano**: uma loja por vez, sem abrir dezenas de abas, sem repetir buscas em loop.
- **Não resolva captcha e não contorne bloqueio.** Se uma loja bloquear, pule para a próxima e cite isso no relatório.
- **Não adicione nada ao carrinho e não faça login.** Esta skill só pesquisa; quem testa checkout é a `/validar-cupom`.
- Use uma aba nova e feche-a no final.

## Passo a passo

1. **Entenda o pedido.** Defina o produto, as variações aceitas (tamanho, capacidade, versão) e o teto de preço, se o usuário deu um. Se o pedido for genérico (ex.: "TV 50 polegadas"), aceite qualquer marca, mas só o produto principal: nada de suporte, painel, capa, peça, usado ou recondicionado.

2. **Carregue as ferramentas do Chrome** numa única chamada ToolSearch:
   `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__find,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_close_mcp`
   Chame `tabs_context_mcp` e crie uma aba nova.

3. **Pesquise nas lojas, nesta ordem.** Use a página de busca de cada uma e leia os resultados com `get_page_text`:
   - Amazon: `https://www.amazon.com.br/s?k=<termo>`
   - Mercado Livre: `https://lista.mercadolivre.com.br/<termo-com-hifens>`
   - Magalu: `https://www.magazineluiza.com.br/busca/<termo>/`
   - Casas Bahia: `https://www.casasbahia.com.br/<termo-com-hifens>/b`
   - KaBuM!: `https://www.kabum.com.br/busca/<termo-com-hifens>`
   - AliExpress: `https://pt.aliexpress.com/w/wholesale-<termo-com-hifens>.html` (ignore anúncios patrocinados e o preço de "Novo usuário"; anote se o envio é do Brasil e o prazo)
   - Pelando: `https://www.pelando.com.br/busca/<termo-com-hifens>` (ofertas e cupons da comunidade)
   - Promobit: `https://www.promobit.com.br/buscar/?q=<termo>`

   Em cada loja, anote os **3 melhores anúncios que realmente são o produto**: título, preço final (à vista/Pix, se a loja mostrar), cupom indicado, vendedor e link direto do anúncio. Descarte vendedor duvidoso, marketplace internacional com prazo longo (cite como observação) e anúncio sem preço.

4. **Cadastre o produto no Promo Radar** (ou reaproveite um que já existe):
   ```bash
   curl -s $API/api/products   # procure um produto com o mesmo nome
   curl -s -X POST $API/api/products -H 'content-type: application/json' \
     -d '{"name":"<nome curto do produto>","category":"<celular|tv|notebook|console|controle|fone|tablet|smartwatch|monitor|placa-de-video|casa>","maxPrice":<teto ou null>}'
   ```
   Se o pedido bater com uma sugestão do catálogo (`curl -s "$API/api/suggest?q=<termo>"`), prefira cadastrar com `{"name":"<nome exato da sugestão>","catalog":true}`: ela já vem com filtros prontos.

5. **Envie as ofertas encontradas** para o produto. Elas passam pela lógica de recorde e disparam o alarme se forem o menor preço:
   ```bash
   curl -s -X POST $API/api/products/<id>/offers -H 'content-type: application/json' -d '{"offers":[
     {"store":"Amazon","title":"...","url":"https://...","price":2599.00,"finalPrice":2399.00,"coupon":"CUPOM10","note":"preço no Pix"}
   ]}'
   ```

6. **Feche a aba e responda** com uma tabela curta: loja, produto, preço final, cupom e link, do mais barato para o mais caro. Diga quais lojas bloquearam, e qual é a recomendação: "comprar agora" ou "esperar, porque o preço está acima do histórico". Mostre o histórico em `curl -s $API/api/products/<id>/offers`, se houver.
