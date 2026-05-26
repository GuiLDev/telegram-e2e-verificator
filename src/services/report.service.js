const fs = require("fs");
const path = require("path");

const {
  PASTA_RELATORIOS,
  PASTA_TEXTOS_EXTRAIDOS,
  CAMINHO_RELATORIO
} = require("../config/paths");

function garantirPastasRelatorio() {
  if (!fs.existsSync(PASTA_RELATORIOS)) {
    fs.mkdirSync(PASTA_RELATORIOS);
  }

  if (!fs.existsSync(PASTA_TEXTOS_EXTRAIDOS)) {
    fs.mkdirSync(PASTA_TEXTOS_EXTRAIDOS);
  }
}

function salvarTextoExtraido(arquivo, textoCru) {
  const nomeBase = path.parse(arquivo).name;
  const caminhoTexto = path.join(PASTA_TEXTOS_EXTRAIDOS, `${nomeBase}.txt`);

  fs.writeFileSync(caminhoTexto, textoCru || "", "utf8");

  return caminhoTexto;
}

function salvarRelatorioBenchmark(relatorio) {
  fs.writeFileSync(CAMINHO_RELATORIO, JSON.stringify(relatorio, null, 2), "utf8");

  return CAMINHO_RELATORIO;
}

module.exports = {
  garantirPastasRelatorio,
  salvarTextoExtraido,
  salvarRelatorioBenchmark
};