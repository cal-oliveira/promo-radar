# Promo Radar

Monitora produtos e toca um alarme no navegador quando aparece um preço menor que o menor já visto.

```bash
npm install
npx playwright install chromium
npm start            # http://localhost:4321
```

Clique uma vez na página (ou em "Ativar som do alarme"): o navegador só libera áudio depois de uma interação.

## Como funciona
- Escolha um produto pelas sugestões (vem com filtros prontos: termos obrigatórios, acessórios/usados descartados, preço mínimo plausível) ou digite texto livre.
- A cada `SCAN_INTERVAL_MIN` minutos (padrão 2) o scanner busca em todas as fontes ativas.
- A primeira varredura de um produto só registra o preço de referência. Daí em diante, qualquer oferta abaixo do recorde (por pelo menos `MIN_DROP` reais, padrão 1) dispara o alarme.
- Cupons encontrados (Promobit) aparecem no painel como "não verificados".

## Fontes
| Fonte | Como | Estado |
|---|---|---|
| KaBuM! | página de busca (dados `__NEXT_DATA__`), preço no Pix | ativa |
| AliExpress | JSON embutido na busca (sem navegador), a cada 10 min por produto; ignora patrocinados e preço de novo usuário; cupons AEMEGA vêm do Promobit | ativa |
| Promobit | API JSON do próprio site: ofertas ativas de qualquer loja (Amazon, ML, Magalu, Shopee…) + cupons | ativa |
| Amazon, Pichau, Terabyte, Pelando | extratores prontos em `src/sources/index.ts` | desligadas: bloqueiam navegador automatizado |

Para forçar fontes: `SOURCES=kabum,promobit,amazon npm start`.

## Variáveis
`PORT` (4321) · `SCAN_INTERVAL_MIN` (2) · `MIN_DROP` (1) · `SOURCES`
