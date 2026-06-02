/*
  Benchmark local para testar a extração de E2E em imagens de comprovantes Pix.

  Fluxo geral:
  1. Lista imagens locais da pasta comprovantes-teste/.
  2. Envia cada imagem para o Google Cloud Vision.
  3. Recebe o texto bruto extraído por OCR.
  4. Usa o e2e-extractor.service para localizar o melhor E2E.
  5. Se encontrar E2E, consulta a API da Bloo.
  6. Se o E2E original não bater na Bloo, gera candidatos e testa cada um.
  7. Salva o texto extraído de cada imagem.
  8. Gera um relatório JSON com:
     - resultado do OCR;
     - resultado da API;
     - E2E original;
     - E2E validado;
     - resumo da transação;
     - imagens não encontradas.

  Observação:
  Este arquivo é apenas para teste em lote/local.
  Ele ainda não representa o fluxo final do Telegram ou Gemini em produção.
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

const {
  BLOO_E2E_VALIDATION_STATUS,
  validarE2EComCandidatosNaBloo
} = require("./services/bloo-validation/bloo-e2e-validation.service");

const {
  mapearRespostaBlooParaResumo,
  formatarOrderSummaryTerminal
} = require("./services/bloo-validation/bloo-response-mapper.service");

/*
  Processa uma imagem individual usando Google Vision + extrator de E2E.

  Retorna:
  - texto bruto extraído;
  - E2E encontrado, se houver;
  - método de extração OCR;
  - candidatos encontrados no texto;
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
  Consulta a Bloo usando o E2E encontrado pelo OCR.

  Se o E2E original não for encontrado, o service da Bloo gera candidatos
  com variações de caracteres ambíguos, como:
  - o / O / 0
  - l / I / 1

  A resposta da Bloo é convertida em um resumo limpo com:
  - id
  - direction
  - status
  - amount
  - amountFormatted
  - currency
  - processedAt
*/
async function validarE2ENaBloo(e2e, textoOCR) {
  const validacao = await validarE2EComCandidatosNaBloo(e2e, {
    textoOCR
  });

  const resumo = mapearRespostaBlooParaResumo(validacao);

  return {
    validacao,
    resumo
  };
}

/*
  Executa o benchmark completo.

  Agora o benchmark mede duas camadas:

  1. OCR:
     - quantas imagens tiveram E2E encontrado;
     - quantas não tiveram E2E encontrado.

  2. Bloo API:
     - quantos E2Es originais bateram direto;
     - quantos foram ajustados por candidatos;
     - quantos não foram encontrados na API.
*/
async function rodarBenchmark() {
  garantirPastasRelatorio();

  const googleClient = criarClienteGoogleVision();
  const arquivos = listarImagens();

  console.log(`Pasta de imagens: ${PASTA_IMAGENS}`);
  console.log(`Iniciando teste em ${arquivos.length} imagens...`);
  console.log("");

  let totalE2EEncontradosPorImagem = 0;
  let totalE2ENaoEncontradosPorImagem = 0;

  let totalE2EOriginalEncontradosNaAPI = 0;
  let totalE2EAjustadosEncontradosNaAPI = 0;
  let totalE2ENaoEncontradosNaAPI = 0;
  let totalErrosAPI = 0;

  let capturasPorContexto = 0;
  let capturasPorFallback = 0;

  const imagensSemE2ENoOCR = [];
  const e2eNaoEncontradosNaAPI = [];
  const errosAPI = [];

  const resultados = [];

  for (const arquivo of arquivos) {
    const caminhoCompleto = path.join(PASTA_IMAGENS, arquivo);

    console.log(`Processando: ${arquivo}`);

    const resultadoOCR = await testarGoogleVision(googleClient, caminhoCompleto);
    const caminhoTextoExtraido = salvarTextoExtraido(arquivo, resultadoOCR.textoCru);

    let resultadoBloo = null;
    let resumoBloo = null;

    if (resultadoOCR.e2e) {
      totalE2EEncontradosPorImagem++;

      if (resultadoOCR.metodo === "contexto") {
        capturasPorContexto++;
      }

      if (resultadoOCR.metodo === "fallback-regex") {
        capturasPorFallback++;
      }

      console.log(`  [OCR OK] E2E: ${resultadoOCR.e2e}`);
      console.log(`  Método OCR: ${resultadoOCR.metodo}`);

      const validacaoBloo = await validarE2ENaBloo(
        resultadoOCR.e2e,
        resultadoOCR.textoCru
      );

      resultadoBloo = validacaoBloo.validacao;
      resumoBloo = validacaoBloo.resumo;

      if (resultadoBloo.status === BLOO_E2E_VALIDATION_STATUS.FOUND) {
        totalE2EOriginalEncontradosNaAPI++;

        console.log("  [BLOO OK] E2E original encontrado na API");
      } else if (
        resultadoBloo.status === BLOO_E2E_VALIDATION_STATUS.FOUND_BY_CANDIDATE
      ) {
        totalE2EAjustadosEncontradosNaAPI++;

        console.log("  [BLOO OK] E2E ajustado encontrado na API");
        console.log(`  E2E validado: ${resultadoBloo.e2eValidado}`);
      } else if (resultadoBloo.status === BLOO_E2E_VALIDATION_STATUS.NOT_FOUND) {
        totalE2ENaoEncontradosNaAPI++;

        e2eNaoEncontradosNaAPI.push({
          arquivo,
          e2eOCR: resultadoOCR.e2e,
          metodoOCR: resultadoOCR.metodo,
          candidatosTestados: resultadoBloo.candidatosTestados?.length || 0
        });

        console.log("  [BLOO FALHA] E2E não encontrado na API");
      } else {
        totalErrosAPI++;

        errosAPI.push({
          arquivo,
          e2eOCR: resultadoOCR.e2e,
          status: resultadoBloo.status,
          metodo: resultadoBloo.metodo
        });

        console.log(`  [BLOO ERRO] Status: ${resultadoBloo.status}`);
      }

      const orderSummary = formatarOrderSummaryTerminal(resumoBloo);

      if (orderSummary) {
        console.log("");
        console.log(orderSummary);
      }
    } else {
      totalE2ENaoEncontradosPorImagem++;

      imagensSemE2ENoOCR.push({
        arquivo,
        metodoOCR: resultadoOCR.metodo,
        erro: resultadoOCR.erro
      });

      console.log("  [OCR FALHA] E2E não encontrado na imagem");

      if (resultadoOCR.erro) {
        console.log(`  Erro OCR: ${resultadoOCR.erro}`);
      }
    }

    resultados.push({
      arquivo,
      ocr: {
        sucesso: Boolean(resultadoOCR.e2e),
        e2e: resultadoOCR.e2e,
        metodo: resultadoOCR.metodo,
        candidatos: resultadoOCR.candidatos,
        erro: resultadoOCR.erro,
        textoExtraidoPath: caminhoTextoExtraido
      },
      bloo: resultadoBloo
        ? {
            status: resultadoBloo.status,
            encontrado: resultadoBloo.encontrado,
            metodo: resultadoBloo.metodo,
            e2eOriginal: resultadoBloo.e2eOriginal,
            e2eValidado: resultadoBloo.e2eValidado,
            candidatosTestados: resultadoBloo.candidatosTestados,
            totalCandidatosTestados:
              resultadoBloo.candidatosTestados?.length || 0,
            totalResultadosEncontrados:
              resultadoBloo.resultadosEncontrados?.length || 0,
            resumo: resumoBloo
          }
        : null
    });

    console.log("");
  }

  const totalImagens = arquivos.length;

  const taxaOCR = totalImagens
    ? `${((totalE2EEncontradosPorImagem / totalImagens) * 100).toFixed(2)}%`
    : "0.00%";

  const totalConsultasComE2E = totalE2EEncontradosPorImagem;

  const totalEncontradosNaAPI =
    totalE2EOriginalEncontradosNaAPI + totalE2EAjustadosEncontradosNaAPI;

  const taxaBloo = totalConsultasComE2E
    ? `${((totalEncontradosNaAPI / totalConsultasComE2E) * 100).toFixed(2)}%`
    : "0.00%";

  const relatorio = {
    servicoOCR: "Google Cloud Vision",
    autenticacaoOCR: "Application Default Credentials",
    servicoValidacao: "Bloo API",
    regex: E2E_REGEX.toString(),
    geradoEm: new Date().toISOString(),

    resumo: {
      totalDeImagens: totalImagens,
      totalDeE2EEncontradosPorImagem: totalE2EEncontradosPorImagem,
      totalDeE2ENaoEncontradosPorImagem: totalE2ENaoEncontradosPorImagem,
      taxaOCR,

      api: {
        totalDeE2EOriginalEncontradosNaAPI: totalE2EOriginalEncontradosNaAPI,
        totalDeE2EAjustadosEncontradosNaAPI: totalE2EAjustadosEncontradosNaAPI,
        totalDeE2ENaoEncontradosNaAPI: totalE2ENaoEncontradosNaAPI,
        totalDeErrosAPI: totalErrosAPI,
        taxaBloo
      },

      capturasPorContexto,
      capturasPorFallback
    },

    imagensSemE2ENoOCR,
    e2eNaoEncontradosNaAPI,
    errosAPI,
    resultados
  };

  const caminhoRelatorio = salvarRelatorioBenchmark(relatorio);

  console.log("");
  console.log("--- RESULTADO FINAL ---");
  console.log(`Total de imagens: ${totalImagens}`);
  console.log(
    `Total de E2E encontrados por imagem: ${totalE2EEncontradosPorImagem}`
  );
  console.log(
    `Total de E2E não encontrados por imagem: ${totalE2ENaoEncontradosPorImagem}`
  );
  console.log(`Taxa OCR: ${taxaOCR}`);
  console.log("--------------------");
  console.log(
    `Total de E2E original encontrados na API: ${totalE2EOriginalEncontradosNaAPI}`
  );
  console.log(
    `Total de E2E ajustados encontrados na API: ${totalE2EAjustadosEncontradosNaAPI}`
  );
  console.log(
    `Total de E2E não encontrados na API: ${totalE2ENaoEncontradosNaAPI}`
  );
  console.log(`Total de erros API: ${totalErrosAPI}`);
  console.log(`Taxa Bloo: ${taxaBloo}`);

  if (e2eNaoEncontradosNaAPI.length > 0) {
    console.log("");
    console.log("E2Es não encontrados na API:");

    for (const item of e2eNaoEncontradosNaAPI) {
      console.log(`- ${item.arquivo} | ${item.e2eOCR}`);
    }
  }

  if (imagensSemE2ENoOCR.length > 0) {
    console.log("");
    console.log("Imagens sem E2E encontrado pelo OCR:");

    for (const item of imagensSemE2ENoOCR) {
      console.log(`- ${item.arquivo}`);
    }
  }

  if (errosAPI.length > 0) {
    console.log("");
    console.log("Erros na API:");

    for (const item of errosAPI) {
      console.log(`- ${item.arquivo} | ${item.e2eOCR} | ${item.status}`);
    }
  }

  console.log("");
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