const path = require("path");

/*
  Pasta onde ficam as imagens locais usadas no benchmark.

  Essas imagens são comprovantes reais de teste e NÃO devem ir para o GitHub.
  Por isso, a pasta comprovantes-teste/ fica protegida no .gitignore.
*/
const PASTA_IMAGENS = path.join(__dirname, "..", "..", "comprovantes-teste");

/*
  Pasta principal onde o benchmark salva todos os arquivos gerados.

  Exemplo:
  relatorios/
*/
const PASTA_RELATORIOS = path.join(__dirname, "..", "..", "relatorios");

/*
  Pasta onde salvamos o texto bruto extraído de cada imagem pelo OCR.

  Isso ajuda a investigar falhas, porque conseguimos abrir o .txt
  e ver exatamente o que o Google Vision leu da imagem.
*/
const PASTA_TEXTOS_EXTRAIDOS = path.join(PASTA_RELATORIOS, "textos-extraidos");

/*
  Caminho do arquivo JSON final do benchmark atual com Google Vision.
*/
const CAMINHO_RELATORIO = path.join(PASTA_RELATORIOS, "resultado-benchmark.json");

/*
  Caminho do arquivo JSON final do benchmark usando somente Gemini.

  Esse relatório é separado para conseguirmos comparar:
  - Google Vision + Regex + Bloo
  - Gemini + JSON + Bloo
*/
const CAMINHO_RELATORIO_GEMINI = path.join(
  PASTA_RELATORIOS,
  "resultado-gemini-benchmark.json"
);

module.exports = {
  PASTA_IMAGENS,
  PASTA_RELATORIOS,
  PASTA_TEXTOS_EXTRAIDOS,
  CAMINHO_RELATORIO,
  CAMINHO_RELATORIO_GEMINI
};