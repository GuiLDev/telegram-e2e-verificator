/*
  Serviço responsável por converter a resposta completa da Bloo
  em um JSON simples com apenas os campos que o projeto precisa.

  Campos retornados:
  - id
  - direction
  - status
  - amount
  - amountFormatted (campo atualiza o valor da API dividido por 100)
  - currency
  - processedAt

*/

function extrairPrimeiroRegistroBloo(resultadoValidacao) {
  const resultadosEncontrados = resultadoValidacao?.resultadosEncontrados || [];

  if (!resultadosEncontrados.length) {
    return null;
  }

  const primeiroResultado = resultadosEncontrados[0];
  const data = primeiroResultado?.data;

  if (Array.isArray(data)) {
    return data[0] || null;
  }

  if (data && typeof data === "object") {
    return data;
  }

  return null;
}

function formatarValorBRL(amount) {
  if (typeof amount !== "number") {
    return null;
  }

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(amount / 100);
}

function mapearRespostaBlooParaResumo(resultadoValidacao) {
  const registro = extrairPrimeiroRegistroBloo(resultadoValidacao);

  if (!registro) {
    return {
      id: null,
      direction: null,
      status: null,
      amount: null,
      amountFormatted: null,
      currency: null,
      processedAt: null
    };
  }

  return {
    id: registro.id || null,
    direction: registro.direction || null,
    status: registro.status || null,
    amount: registro.amount ?? null,
    amountFormatted: formatarValorBRL(registro.amount),
    currency: registro.currency || null,
    processedAt: registro.processedAt || null
  };
}

module.exports = {
  mapearRespostaBlooParaResumo
};