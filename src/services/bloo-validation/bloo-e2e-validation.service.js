/*
  Serviço responsável por validar um E2E contra a API da Bloo usando fallback de candidatos.

  Fluxo geral:
  1. Consulta primeiro o E2E original extraído pelo OCR/Gemini.
  2. Se a Bloo encontrar, retorna validação direta.
  3. Se a Bloo retornar vazio, gera variações com caracteres ambíguos.
  4. Consulta cada candidato gerado na Bloo.
  5. Se exatamente um candidato bater, retorna esse candidato como validado.
  6. Se mais de um candidato bater, marca como revisão.
  7. Se nenhum candidato bater, retorna NOT_FOUND.

  Importante:
  Este serviço não corrige E2E no chute.
  Ele só aceita uma variação se a API da Bloo confirmar.
*/

const {
  BLOO_STATUS,
  consultarE2ENaBloo
} = require("./bloo-validation.service");

const { gerarCandidatosE2E } = require("./e2e-candidates.service");

const BLOO_E2E_VALIDATION_STATUS = {
  FOUND: "FOUND",
  FOUND_BY_CANDIDATE: "FOUND_BY_CANDIDATE",
  NOT_FOUND: "NOT_FOUND",
  API_ERROR: "API_ERROR",
  INVALID_E2E: "INVALID_E2E",
  MULTIPLE_CANDIDATES_FOUND: "MULTIPLE_CANDIDATES_FOUND"
};

/*
  Valida um E2E completo contra a Bloo.

  Primeiro tenta o E2E original.
  Só gera candidatos se o original não for encontrado.

  Retorna sempre um objeto padronizado com:
  - status;
  - e2eOriginal;
  - e2eValidado;
  - encontrado;
  - metodo;
  - resultadoOriginal;
  - candidatosTestados;
  - resultadosEncontrados.
*/
async function validarE2EComCandidatosNaBloo(e2e, opcoes = {}) {
  /*
    1. Consulta original

    Essa é a validação mais forte.
    Se a API encontrar esse E2E, não precisamos gerar variações.
  */
  const resultadoOriginal = await consultarE2ENaBloo(e2e);

  /*
    2. E2E inválido

    Se veio vazio, nulo ou em formato impossível para consulta,
    encerramos aqui.
  */
  if (resultadoOriginal.status === BLOO_STATUS.INVALID_E2E) {
    return {
      status: BLOO_E2E_VALIDATION_STATUS.INVALID_E2E,
      e2eOriginal: e2e,
      e2eValidado: null,
      encontrado: false,
      metodo: "invalid_e2e",
      resultadoOriginal,
      candidatosTestados: [],
      resultadosEncontrados: []
    };
  }

  /*
    3. Erro técnico na API

    Se a consulta original falhar por erro HTTP/rede,
    não seguimos para candidatos porque pode ser instabilidade da API.
  */
  if (resultadoOriginal.status === BLOO_STATUS.API_ERROR) {
    return {
      status: BLOO_E2E_VALIDATION_STATUS.API_ERROR,
      e2eOriginal: e2e,
      e2eValidado: null,
      encontrado: false,
      metodo: "api_error_original_lookup",
      resultadoOriginal,
      candidatosTestados: [],
      resultadosEncontrados: []
    };
  }

  /*
    4. Encontrou o E2E exato

    Melhor cenário:
    o E2E extraído bateu diretamente na Bloo.
  */
  if (resultadoOriginal.status === BLOO_STATUS.FOUND) {
    return {
      status: BLOO_E2E_VALIDATION_STATUS.FOUND,
      e2eOriginal: e2e,
      e2eValidado: resultadoOriginal.e2e,
      encontrado: true,
      metodo: "exact_match",
      resultadoOriginal,
      candidatosTestados: [],
      resultadosEncontrados: [resultadoOriginal]
    };
  }

  /*
    5. E2E original não encontrado

    Aqui a Bloo provavelmente retornou [].
    Então geramos candidatos com variações de caracteres ambíguos,
    como:
    - 0 / o / O
    - 1 / l / I

    Removemos o próprio E2E original para não consultar duas vezes.
  */
  const candidatos = gerarCandidatosE2E(e2e, {
  textoOCR: opcoes.textoOCR
}).filter((candidato) => candidato !== resultadoOriginal.e2e);

  const candidatosTestados = [];
  const resultadosEncontrados = [];

  /*
    6. Consulta candidato por candidato

    Cada candidato é enviado para a Bloo.
    Só será considerado válido se a Bloo retornar dados.
  */
  for (const candidato of candidatos) {
    const resultadoCandidato = await consultarE2ENaBloo(candidato);

    candidatosTestados.push({
      e2e: candidato,
      status: resultadoCandidato.status,
      encontrado: resultadoCandidato.encontrado
    });

    if (resultadoCandidato.status === BLOO_STATUS.FOUND) {
      resultadosEncontrados.push(resultadoCandidato);
    }
  }

  /*
    7. Exatamente um candidato encontrado

    Esse é o melhor cenário de recuperação:
    o OCR/Gemini leu errado, mas uma variação foi confirmada pela Bloo.
  */
  if (resultadosEncontrados.length === 1) {
    const resultadoEncontrado = resultadosEncontrados[0];

    return {
      status: BLOO_E2E_VALIDATION_STATUS.FOUND_BY_CANDIDATE,
      e2eOriginal: e2e,
      e2eValidado: resultadoEncontrado.e2e,
      encontrado: true,
      metodo: "candidate_recovery",
      resultadoOriginal,
      candidatosTestados,
      resultadosEncontrados
    };
  }

  /*
    8. Mais de um candidato encontrado

    Caso raro, mas perigoso.
    Se mais de uma variação existir na Bloo, não escolhemos automaticamente.
    Esse caso precisa de revisão.
  */
  if (resultadosEncontrados.length > 1) {
    return {
      status: BLOO_E2E_VALIDATION_STATUS.MULTIPLE_CANDIDATES_FOUND,
      e2eOriginal: e2e,
      e2eValidado: null,
      encontrado: false,
      metodo: "multiple_candidates_found",
      resultadoOriginal,
      candidatosTestados,
      resultadosEncontrados
    };
  }

  /*
    9. Nenhum candidato encontrado

    O E2E original não bateu e nenhuma variação também.
    Nesse caso o fluxo deve pedir confirmação, nova imagem ou revisão.
  */
  return {
    status: BLOO_E2E_VALIDATION_STATUS.NOT_FOUND,
    e2eOriginal: e2e,
    e2eValidado: null,
    encontrado: false,
    metodo: "no_candidate_matched",
    resultadoOriginal,
    candidatosTestados,
    resultadosEncontrados: []
  };
}

module.exports = {
  BLOO_E2E_VALIDATION_STATUS,
  validarE2EComCandidatosNaBloo
};