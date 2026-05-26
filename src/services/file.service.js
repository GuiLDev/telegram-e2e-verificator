/*
  Serviço responsável por lidar com arquivos locais usados no benchmark.

  Responsabilidades:
  1. Verificar se a pasta de imagens existe.
  2. Listar os arquivos dentro de comprovantes-teste/.
  3. Filtrar somente extensões de imagem aceitas.
  4. Retornar a lista ordenada para o benchmark processar.

  Observação:
  Este serviço não lê o conteúdo da imagem.
  Ele apenas lista quais arquivos devem ser enviados para o OCR.
*/

const fs = require("fs");
const path = require("path");

const { PASTA_IMAGENS } = require("../config/paths");

/*
  Lista as imagens disponíveis para o benchmark.

  Aceita:
  - .jpg
  - .jpeg
  - .png
  - .webp

  Se a pasta não existir, lança erro para evitar rodar benchmark vazio
  sem perceber.
*/
function listarImagens() {
  if (!fs.existsSync(PASTA_IMAGENS)) {
    throw new Error(`Pasta de imagens não encontrada: ${PASTA_IMAGENS}`);
  }

  return fs
    .readdirSync(PASTA_IMAGENS)
    .filter((arquivo) => {
      const ext = path.extname(arquivo).toLowerCase();

      return [".jpg", ".jpeg", ".png", ".webp"].includes(ext);
    })
    .sort();
}

module.exports = {
  listarImagens
};