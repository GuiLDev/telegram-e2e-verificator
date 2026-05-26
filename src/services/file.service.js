const fs = require("fs");
const path = require("path");

const { PASTA_IMAGENS } = require("../config/paths");

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