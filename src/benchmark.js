/*
  Benchmark local para testar a extração de E2E em imagens de comprovantes Pix.

  Fluxo geral:
  1. Lista imagens locais da pasta comprovantes-teste/.
  2. Envia cada imagem para o Google Cloud Vision.
  3. Recebe o texto bruto extraído por OCR.
  4. Usa o e2e-extractor.service para localizar o melhor E2E.
  5. Salva o texto extraído de cada imagem.
  6. Gera um relatório JSON com acertos, falhas, candidatos e método usado.

  Observação:
  Este arquivo é apenas para teste em lote/local.
  Ele não representa o fluxo final do Telegram em produção.
*/

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

/*
  Processa uma imagem individual usando Google Vision + extrator de E2E.

  Retorna um objeto padronizado com:
  - texto bruto extraído;
  - E2E encontrado, se houver;
  - método de extração;
  - candidatos encontrados;
  - erro, se acontecer.
*/
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

/*
  Executa o benchmark completo.

  Essa função:
  - prepara as pastas de relatório;
  - cria o cliente Google Vision;
  - lista as imagens;
  - processa uma por uma;
  - contabiliza acertos e falhas;
  - salva textos extraídos;
  - gera o resultado-benchmark.json.
*/
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

/*
  Inicializa o benchmark e captura erros globais.

  Se algo falhar fora do fluxo individual das imagens,
  o processo é encerrado com código 1.
*/
rodarBenchmark().catch((error) => {
  console.error("");
  console.error("Erro ao rodar benchmark:");
  console.error(error.message);
  process.exit(1);
});