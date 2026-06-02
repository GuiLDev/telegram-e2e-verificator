/*
  Benchmark local para testar extração de comprovantes Pix usando somente Gemini.

  Fluxo geral:
  1. Lista imagens locais da pasta comprovantes-teste/.
  2. Envia cada imagem para Gemini.
  3. Gemini retorna JSON estruturado.
  4. Pegamos o E2E retornado pelo Gemini.
  5. Consultamos a API da Bloo.
  6. Se o E2E original não bater, geramos candidatos.
  7. Salvamos um relatório separado para medir performance do Gemini.

  Observação:
  Este arquivo NÃO usa Google Vision.
  Ele serve para comparar a performance do Gemini contra o OCR atual.
*/

require("dotenv").config();

const path = require("path");

const { PASTA_IMAGENS, CAMINHO_RELATORIO_GEMINI } = require("./config/paths");

const { listarImagens } = require("./services/file.service");

const {
  garantirPastasRelatorio,
  salvarRelatorioEmArquivo
} = require("./services/report.service");

const {
  extrairDadosComprovanteComGemini
} = require("./services/gemini/gemini-extractor.service");

const {
  BLOO_E2E_VALIDATION_STATUS,
  validarE2EComCandidatosNaBloo
} = require("./services/bloo-validation/bloo-e2e-validation.service");

const {
  mapearRespostaBlooParaResumo,
  formatarOrderSummaryTerminal
} = require("./services/bloo-validation/bloo-response-mapper.service");

function obterNumeroEnv(nome, valorPadrao) {
  const valor = Number(process.env[nome]);

  if (!Number.isFinite(valor)) {
    return valorPadrao;
  }

  return valor;
}

const GEMINI_DELAY_ENTRE_IMAGENS_MS = obterNumeroEnv(
  "GEMINI_DELAY_ENTRE_IMAGENS_MS",
  4000
);

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/*
  Monta um texto auxiliar para o gerador de candidatos.

  No fluxo Google Vision, usamos o texto bruto do OCR.

  No fluxo Gemini, usamos:
  - o E2E retornado;
  - as linhas relevantes que o Gemini conseguiu identificar.

  Isso ajuda no candidate recovery estrutural.
*/
function montarTextoParaCandidatosGemini(dadosGemini) {
  const linhas = [];

  const e2e = dadosGemini?.e2e?.valor;

  if (e2e) {
    linhas.push(e2e);
  }

  if (Array.isArray(dadosGemini?.linhasRelevantes)) {
    linhas.push(...dadosGemini.linhasRelevantes);
  }

  return linhas.filter(Boolean).join("\n");
}

async function validarE2EGeminiNaBloo(e2e, dadosGemini) {
  const textoOCR = montarTextoParaCandidatosGemini(dadosGemini);

  const validacao = await validarE2EComCandidatosNaBloo(e2e, {
    textoOCR
  });

  const resumo = mapearRespostaBlooParaResumo(validacao);

  return {
    validacao,
    resumo
  };
}

async function rodarGeminiBenchmark() {
  garantirPastasRelatorio();

  const arquivos = listarImagens();

  console.log(`Pasta de imagens: ${PASTA_IMAGENS}`);
  console.log(`Modelo Gemini: ${process.env.GEMINI_MODEL || "gemini-2.5-flash"}`);
  console.log(`Delay entre imagens: ${GEMINI_DELAY_ENTRE_IMAGENS_MS}ms`);
  console.log(`Iniciando benchmark Gemini em ${arquivos.length} imagens...`);
  console.log("");

  let totalE2EExtraidosGemini = 0;
  let totalE2ENaoExtraidosGemini = 0;

  let totalE2EOriginalEncontradosNaAPI = 0;
  let totalE2EAjustadosEncontradosNaAPI = 0;
  let totalE2ENaoEncontradosNaAPI = 0;

  let totalErrosGemini = 0;
  let totalErrosAPI = 0;

  const imagensSemE2EGemini = [];
  const e2eNaoEncontradosNaAPI = [];
  const errosGemini = [];
  const errosAPI = [];

  const resultados = [];

  for (let index = 0; index < arquivos.length; index++) {
    const arquivo = arquivos[index];
    const caminhoCompleto = path.join(PASTA_IMAGENS, arquivo);

    console.log(`Processando: ${arquivo}`);

    let resultadoGemini = null;
    let resultadoBloo = null;
    let resumoBloo = null;

    try {
      resultadoGemini = await extrairDadosComprovanteComGemini(caminhoCompleto);

      const dadosGemini = resultadoGemini.dados;
      const e2eGemini = dadosGemini?.e2e?.valor;

      if (!e2eGemini) {
        totalE2ENaoExtraidosGemini++;

        imagensSemE2EGemini.push({
          arquivo,
          motivo: "Gemini não retornou E2E",
          dadosGemini
        });

        console.log("  [GEMINI FALHA] E2E não extraído");
      } else {
        totalE2EExtraidosGemini++;

        console.log(`  [GEMINI OK] E2E: ${e2eGemini}`);
        console.log(`  Confiança: ${dadosGemini.e2e.confianca}`);

        const validacaoBloo = await validarE2EGeminiNaBloo(
          e2eGemini,
          dadosGemini
        );

        resultadoBloo = validacaoBloo.validacao;
        resumoBloo = validacaoBloo.resumo;

        if (resultadoBloo.status === BLOO_E2E_VALIDATION_STATUS.FOUND) {
          totalE2EOriginalEncontradosNaAPI++;

          console.log("  [BLOO OK] E2E original encontrado na API");
        } else if (
          resultadoBloo.status ===
          BLOO_E2E_VALIDATION_STATUS.FOUND_BY_CANDIDATE
        ) {
          totalE2EAjustadosEncontradosNaAPI++;

          console.log("  [BLOO OK] E2E ajustado encontrado na API");
          console.log(`  E2E validado: ${resultadoBloo.e2eValidado}`);
        } else if (
          resultadoBloo.status === BLOO_E2E_VALIDATION_STATUS.NOT_FOUND
        ) {
          totalE2ENaoEncontradosNaAPI++;

          e2eNaoEncontradosNaAPI.push({
            arquivo,
            e2eGemini,
            confiancaGemini: dadosGemini.e2e.confianca,
            candidatosTestados: resultadoBloo.candidatosTestados?.length || 0
          });

          console.log("  [BLOO FALHA] E2E não encontrado na API");
        } else {
          totalErrosAPI++;

          errosAPI.push({
            arquivo,
            e2eGemini,
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
      }
    } catch (error) {
      totalErrosGemini++;

      errosGemini.push({
        arquivo,
        erro: error.message
      });

      console.log(`  [GEMINI ERRO] ${error.message}`);
    }

    resultados.push({
      arquivo,
      gemini: resultadoGemini
        ? {
            model: resultadoGemini.model,
            dados: resultadoGemini.dados
          }
        : null,
      bloo: resultadoBloo
        ? {
            status: resultadoBloo.status,
            encontrado: resultadoBloo.encontrado,
            metodo: resultadoBloo.metodo,
            e2eOriginal: resultadoBloo.e2eOriginal,
            e2eValidado: resultadoBloo.e2eValidado,
            totalCandidatosTestados:
              resultadoBloo.candidatosTestados?.length || 0,
            totalResultadosEncontrados:
              resultadoBloo.resultadosEncontrados?.length || 0,
            resumo: resumoBloo
          }
        : null
    });

    if (index < arquivos.length - 1 && GEMINI_DELAY_ENTRE_IMAGENS_MS > 0) {
      console.log(
        `Aguardando ${GEMINI_DELAY_ENTRE_IMAGENS_MS}ms antes da próxima imagem...`
      );

      await esperar(GEMINI_DELAY_ENTRE_IMAGENS_MS);
    }

    console.log("");
  }

  const totalImagens = arquivos.length;

  const taxaGemini = totalImagens
    ? `${((totalE2EExtraidosGemini / totalImagens) * 100).toFixed(2)}%`
    : "0.00%";

  const totalConsultasComE2E = totalE2EExtraidosGemini;

  const totalEncontradosNaAPI =
    totalE2EOriginalEncontradosNaAPI + totalE2EAjustadosEncontradosNaAPI;

  const taxaBloo = totalConsultasComE2E
    ? `${((totalEncontradosNaAPI / totalConsultasComE2E) * 100).toFixed(2)}%`
    : "0.00%";

  const relatorio = {
    servicoExtracao: "Gemini",
    modelo: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    servicoValidacao: "Bloo API",
    geradoEm: new Date().toISOString(),

    resumo: {
      totalDeImagens: totalImagens,

      gemini: {
        totalDeE2EExtraidos: totalE2EExtraidosGemini,
        totalDeE2ENaoExtraidos: totalE2ENaoExtraidosGemini,
        totalDeErrosGemini: totalErrosGemini,
        taxaGemini
      },

      api: {
        totalDeE2EOriginalEncontradosNaAPI: totalE2EOriginalEncontradosNaAPI,
        totalDeE2EAjustadosEncontradosNaAPI: totalE2EAjustadosEncontradosNaAPI,
        totalDeE2ENaoEncontradosNaAPI: totalE2ENaoEncontradosNaAPI,
        totalDeErrosAPI: totalErrosAPI,
        taxaBloo
      }
    },

    imagensSemE2EGemini,
    e2eNaoEncontradosNaAPI,
    errosGemini,
    errosAPI,
    resultados
  };

  const caminhoRelatorio = salvarRelatorioEmArquivo(
    CAMINHO_RELATORIO_GEMINI,
    relatorio
  );

  console.log("");
  console.log("--- RESULTADO FINAL GEMINI ---");
  console.log(`Total de imagens: ${totalImagens}`);
  console.log(`Total de E2E extraídos pelo Gemini: ${totalE2EExtraidosGemini}`);
  console.log(
    `Total de E2E não extraídos pelo Gemini: ${totalE2ENaoExtraidosGemini}`
  );
  console.log(`Total de erros Gemini: ${totalErrosGemini}`);
  console.log(`Taxa Gemini: ${taxaGemini}`);
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
      console.log(`- ${item.arquivo} | ${item.e2eGemini}`);
    }
  }

  if (imagensSemE2EGemini.length > 0) {
    console.log("");
    console.log("Imagens sem E2E extraído pelo Gemini:");

    for (const item of imagensSemE2EGemini) {
      console.log(`- ${item.arquivo}`);
    }
  }

  if (errosGemini.length > 0) {
    console.log("");
    console.log("Erros Gemini:");

    for (const item of errosGemini) {
      console.log(`- ${item.arquivo} | ${item.erro}`);
    }
  }

  if (errosAPI.length > 0) {
    console.log("");
    console.log("Erros API:");

    for (const item of errosAPI) {
      console.log(`- ${item.arquivo} | ${item.e2eGemini} | ${item.status}`);
    }
  }

  console.log("");
  console.log(`Relatório salvo em: ${caminhoRelatorio}`);
}

rodarGeminiBenchmark().catch((error) => {
  console.error("");
  console.error("Erro ao rodar benchmark Gemini:");
  console.error(error.message);
  process.exit(1);
});