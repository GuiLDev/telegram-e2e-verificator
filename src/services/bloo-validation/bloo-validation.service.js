/*
  Serviço responsável por consultar a API da Bloo usando um E2E.

  Responsabilidades:
  1. Receber um código E2E.
  2. Montar a URL de consulta da API da Bloo.
  3. Fazer a requisição HTTP.
  4. Interpretar resposta com dados como FOUND.
  5. Interpretar [] como NOT_FOUND.
  6. Tratar erros de rede/API como API_ERROR.

  Observação:
  Este serviço não extrai E2E de imagem/texto.
  Ele apenas valida se um E2E existe na API da Bloo.
*/

const BLOO_LOOKUP_BASE_URL =
  "https://txengine.bloobank.com/txengine/v1/events/sync/lookup-by-end-to-end-id";

const BLOO_STATUS = {
  FOUND: "FOUND",
  NOT_FOUND: "NOT_FOUND",
  API_ERROR: "API_ERROR",
  INVALID_E2E: "INVALID_E2E"
};

function validarE2EInput(e2e) {
  return typeof e2e === "string" && e2e.trim().length > 0;
}

function montarUrlConsultaBloo(e2e) {
  const e2eNormalizado = e2e.trim();

  return `${BLOO_LOOKUP_BASE_URL}/${encodeURIComponent(e2eNormalizado)}`;
}

function respostaTemDados(data) {
  if (Array.isArray(data)) {
    return data.length > 0;
  }

  if (data && typeof data === "object") {
    return Object.keys(data).length > 0;
  }

  return Boolean(data);
}

async function consultarE2ENaBloo(e2e) {
  if (!validarE2EInput(e2e)) {
    return {
      status: BLOO_STATUS.INVALID_E2E,
      e2e,
      encontrado: false,
      data: null,
      erro: "E2E inválido ou vazio"
    };
  }

  const e2eNormalizado = e2e.trim();
  const url = montarUrlConsultaBloo(e2eNormalizado);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

    let data = null;

    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      return {
        status: BLOO_STATUS.API_ERROR,
        e2e: e2eNormalizado,
        encontrado: false,
        httpStatus: response.status,
        data,
        erro: `Erro HTTP ${response.status} ao consultar API da Bloo`
      };
    }

    if (!respostaTemDados(data)) {
      return {
        status: BLOO_STATUS.NOT_FOUND,
        e2e: e2eNormalizado,
        encontrado: false,
        httpStatus: response.status,
        data,
        erro: null
      };
    }

    return {
      status: BLOO_STATUS.FOUND,
      e2e: e2eNormalizado,
      encontrado: true,
      httpStatus: response.status,
      data,
      erro: null
    };
  } catch (error) {
    return {
      status: BLOO_STATUS.API_ERROR,
      e2e: e2eNormalizado,
      encontrado: false,
      data: null,
      erro: error.message
    };
  }
}

module.exports = {
  BLOO_STATUS,
  consultarE2ENaBloo,
  montarUrlConsultaBloo
};