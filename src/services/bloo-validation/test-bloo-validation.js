/*
  Arquivo manual para testar a validação de E2E na Bloo.

  Uso:
  node src/services/bloo-validation/test-bloo-validation.js SEU_E2E_AQUI

  Exemplo:
  node src/services/bloo-validation/test-bloo-validation.js E22896431202604272136moJE7IYxo0H

  Observação:
  Este arquivo é apenas para teste local/manual.
  Ele não faz parte do fluxo final do benchmark, Telegram ou Gemini.
*/

const {
  validarE2EComCandidatosNaBloo
} = require("./bloo-e2e-validation.service");

const {
  mapearRespostaBlooParaResumo
} = require("./bloo-response-mapper.service");

async function main() {
  const e2e = process.argv[2];

  if (!e2e) {
    console.error("Informe um E2E para testar.");
    console.error("");
    console.error(
      "Exemplo: node src/services/bloo-validation/test-bloo-validation.js E22896431202604272136moJE7IYxo0H"
    );
    process.exit(1);
  }

  console.log("Testando E2E na Bloo:");
  console.log(e2e);
  console.log("");

  const resultado = await validarE2EComCandidatosNaBloo(e2e);
  const resumo = mapearRespostaBlooParaResumo(resultado);

  console.log("Resumo:");
  console.log(JSON.stringify(resumo, null, 2));

  console.log("");
  console.log("Validação:");
  console.log(
    JSON.stringify(
      {
        status: resultado.status,
        encontrado: resultado.encontrado,
        metodo: resultado.metodo,
        e2eOriginal: resultado.e2eOriginal,
        e2eValidado: resultado.e2eValidado,
        candidatosTestados: resultado.candidatosTestados?.length || 0,
        resultadosEncontrados: resultado.resultadosEncontrados?.length || 0
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("");
  console.error("Erro ao testar validação Bloo:");
  console.error(error.message);
  process.exit(1);
});