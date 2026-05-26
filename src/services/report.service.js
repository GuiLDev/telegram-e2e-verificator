/*
  Serviço responsável por gerar os arquivos de saída do benchmark.

  Responsabilidades:
  1. Garantir que as pastas de relatório existam.
  2. Salvar o texto bruto extraído de cada imagem.
  3. Salvar o relatório final do benchmark em JSON.

  Observação:
  Este serviço não faz OCR e não extrai E2E.
  Ele apenas organiza os resultados gerados pelo benchmark.
*/

const fs = require("fs");
const path = require("path");

const {
  PASTA_RELATORIOS,
  PASTA_TEXTOS_EXTRAIDOS,
  CAMINHO_RELATORIO
} = require("../config/paths");

/*
  Garante que as pastas necessárias para salvar os resultados existam.

  Cria:
  - relatorios/
  - relatorios/textos-extraidos/
*/
function garantirPastasRelatorio() {
  if (!fs.existsSync(PASTA_RELATORIOS)) {
    fs.mkdirSync(PASTA_RELATORIOS);
  }

  if (!fs.existsSync(PASTA_TEXTOS_EXTRAIDOS)) {
    fs.mkdirSync(PASTA_TEXTOS_EXTRAIDOS);
  }
}

/*
  Salva o texto bruto extraído de uma imagem.

  Isso permite revisar depois exatamente o que o OCR leu,
  principalmente nos casos de falha ou falso positivo.
*/
function salvarTextoExtraido(arquivo, textoCru) {
  const nomeBase = path.parse(arquivo).name;
  const caminhoTexto = path.join(PASTA_TEXTOS_EXTRAIDOS, `${nomeBase}.txt`);

  fs.writeFileSync(caminhoTexto, textoCru || "", "utf8");

  return caminhoTexto;
}

/*
  Salva o relatório final do benchmark em JSON.

  O relatório contém:
  - total de imagens processadas;
  - acertos;
  - falhas;
  - taxa de acerto;
  - método de extração;
  - candidatos encontrados;
  - erros, se existirem.
*/
function salvarRelatorioBenchmark(relatorio) {
  fs.writeFileSync(CAMINHO_RELATORIO, JSON.stringify(relatorio, null, 2), "utf8");

  return CAMINHO_RELATORIO;
}

module.exports = {
  garantirPastasRelatorio,
  salvarTextoExtraido,
  salvarRelatorioBenchmark
};