const path = require("path");

const PASTA_IMAGENS = path.join(__dirname, "..", "..", "comprovantes-teste");

const PASTA_RELATORIOS = path.join(__dirname, "..", "..", "relatorios");

const PASTA_TEXTOS_EXTRAIDOS = path.join(PASTA_RELATORIOS, "textos-extraidos");

const CAMINHO_RELATORIO = path.join(PASTA_RELATORIOS, "resultado-benchmark.json");

module.exports = {
  PASTA_IMAGENS,
  PASTA_RELATORIOS,
  PASTA_TEXTOS_EXTRAIDOS,
  CAMINHO_RELATORIO
};