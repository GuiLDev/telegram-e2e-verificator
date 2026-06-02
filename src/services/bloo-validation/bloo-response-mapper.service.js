/*
  Serviço responsável por converter a resposta completa da Bloo
  em um JSON simples com apenas os campos que o projeto precisa.

  Campos retornados:
  - id
  - direction
  - status
  - amount
  - amountFormatted
  - currency
  - processedAt

  Observação:
  A API da Bloo retorna o amount em centavos.
  Exemplo:
  amount: 1000 => R$ 10,00
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

/*
  Formata valor para exibição no terminal.

  Exemplo:
  direction OUT + amount 2000 => - R$20.00
  direction IN  + amount 1000 => R$10.00
*/
function formatarValorTerminal(amount, direction) {
  if (typeof amount !== "number") {
    return "N/A";
  }

  const valor = `R$${(amount / 100).toFixed(2)}`;
  const sinal = direction === "OUT" ? "- " : "";

  return `${sinal}${valor}`;
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

function formatarOrderSummaryTerminal(resumo) {
  if (!resumo || !resumo.id) {
    return null;
  }

  return [
    "Order Summary",
    `ID: ${resumo.id}`,
    `Status: ${resumo.status || "N/A"}`,
    `Direction: ${resumo.direction || "N/A"}`,
    `Amount: ${formatarValorTerminal(resumo.amount, resumo.direction)}`
  ].join("\n");
}

module.exports = {
  mapearRespostaBlooParaResumo,
  formatarOrderSummaryTerminal
};