require("dotenv").config();

const path = require("path");

const { PASTA_IMAGENS, PASTA_TEXTOS_EXTRAIDOS } = require("./config/paths");
const { listarImagens } = require("./services/file.service");
const {
  criarClienteGoogleVision,
  extrairTextoDaImagem
} = require("./services/google-vision.service");
const { E2E_REGEX, extrairE2E } = require("./services/e2e-extractor.service");
const {
  garantirPastasRelatorio,
  salvarTextoExtraido,
  salvarRelatorioBenchmark
} = require("./services/report.service");

async function testarGoogleVision(googleClient, caminhoImagem) {
  try {
    const textoCru = await extrairTextoDaImagem(googleClient, caminhoImagem);
    const extracao = extrairE2E(textoCru);

    return {
      textoCru,
      e2e: extracao.e2e,
      metodo: extracao.metodo,
      candidatos: extracao.candidatos,
      erro: null
    };
  } catch (error) {
    return {
      textoCru: "",
      e2e: null,
      metodo: "erro-google-vision",
      candidatos: [],
      erro: error.message
    };
  }
}

async function rodarBenchmark() {
  garantirPastasRelatorio();

  const googleClient = criarClienteGoogleVision();
  const arquivos = listarImagens();

  console.log(`Pasta de imagens: ${PASTA_IMAGENS}`);
  console.log(`Iniciando teste em ${arquivos.length} imagens...`);
  console.log("");

  let acertos = 0;
  let falhas = 0;
  let capturasPorContexto = 0;
  let capturasPorFallback = 0;

  const resultados = [];

  for (const arquivo of arquivos) {
    const caminhoCompleto = path.join(PASTA_IMAGENS, arquivo);
    const resultado = await testarGoogleVision(googleClient, caminhoCompleto);

    const caminhoTextoExtraido = salvarTextoExtraido(arquivo, resultado.textoCru);

    if (resultado.e2e) {
      acertos++;

      if (resultado.metodo === "contexto") {
        capturasPorContexto++;
      }

      if (resultado.metodo === "fallback-regex") {
        capturasPorFallback++;
      }

      console.log(`[OK] ${arquivo}`);
      console.log(`     E2E: ${resultado.e2e}`);
      console.log(`     Método: ${resultado.metodo}`);
    } else {
      falhas++;

      console.log(`[FALHA] ${arquivo}`);
      console.log(`        Método: ${resultado.metodo}`);

      if (resultado.erro) {
        console.log(`        Erro: ${resultado.erro}`);
      } else {
        console.log("        E2E não encontrado no texto extraído");
      }
    }

    resultados.push({
      arquivo,
      sucesso: Boolean(resultado.e2e),
      e2e: resultado.e2e,
      metodo: resultado.metodo,
      candidatos: resultado.candidatos,
      erro: resultado.erro,
      textoExtraidoPath: caminhoTextoExtraido
    });
  }

  const taxaAcerto = arquivos.length
    ? `${((acertos / arquivos.length) * 100).toFixed(2)}%`
    : "0.00%";

  const relatorio = {
    servico: "Google Cloud Vision",
    autenticacao: "Application Default Credentials",
    total: arquivos.length,
    acertos,
    falhas,
    taxaAcerto,
    capturasPorContexto,
    capturasPorFallback,
    regex: E2E_REGEX.toString(),
    geradoEm: new Date().toISOString(),
    resultados
  };

  const caminhoRelatorio = salvarRelatorioBenchmark(relatorio);

  console.log("");
  console.log("--- RESULTADO FINAL ---");
  console.log(`Total: ${arquivos.length}`);
  console.log(`Acertos: ${acertos}`);
  console.log(`Falhas: ${falhas}`);
  console.log(`Taxa de acerto: ${taxaAcerto}`);
  console.log(`Capturas por contexto: ${capturasPorContexto}`);
  console.log(`Capturas por fallback-regex: ${capturasPorFallback}`);
  console.log(`Relatório salvo em: ${caminhoRelatorio}`);
  console.log(`Textos extraídos salvos em: ${PASTA_TEXTOS_EXTRAIDOS}`);

  if (capturasPorFallback > 0) {
    console.log("");
    console.log(
      "Atenção: revise os casos com método fallback-regex no relatório, pois são capturas menos confiáveis."
    );
  }
}

rodarBenchmark().catch((error) => {
  console.error("");
  console.error("Erro ao rodar benchmark:");
  console.error(error.message);
  process.exit(1);
});