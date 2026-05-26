const E2E_REGEX = /[ED]\d{8}\d{8}[A-Za-z0-9]{11,16}/g;

const PALAVRAS_CHAVE_E2E = [
  "e2e",
  "endtoend",
  "endtoendid",
  "endtoendpix",
  "idtransacao",
  "iddatransacao",
  "idtransacao",
  "idpix",
  "idpagamento",
  "idoperacao",
  "identificador",
  "identificadorpix",
  "identificadordatransacao",
  "codigoautenticacao",
  "codigodeautenticacao",
  "autenticacao",
  "codigodatransacao",
  "comprovantepix",
  "transacaopix"
];

function normalizarTexto(texto) {
  if (!texto) return "";

  return texto
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

function limparLinhaParaRegex(linha) {
  if (!linha) return "";

  return linha
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function quebrarTextoEmLinhasUtilizaveis(textoCru) {
  if (!textoCru) return [];

  const linhasOriginais = textoCru.split(/\r?\n/);

  return linhasOriginais
    .map((linha) => ({
      original: linha,
      limpa: limparLinhaParaRegex(linha)
    }))
    .filter((linha) => linha.limpa);
}

function encontrarCandidatosE2E(textoCru) {
  const linhas = quebrarTextoEmLinhasUtilizaveis(textoCru);
  const candidatos = [];

  for (let index = 0; index < linhas.length; index++) {
    const linhaAtual = linhas[index];

    const encontradosNaLinha = linhaAtual.limpa.match(E2E_REGEX) || [];

    for (const candidato of encontradosNaLinha) {
      candidatos.push({
        valor: candidato,
        origem: "linha",
        linha: index + 1,
        textoLinha: linhaAtual.original
      });
    }

    const proximaLinha = linhas[index + 1];

    if (proximaLinha) {
      const duasLinhas = `${linhaAtual.limpa}${proximaLinha.limpa}`;
      const encontradosEmDuasLinhas = duasLinhas.match(E2E_REGEX) || [];

      for (const candidato of encontradosEmDuasLinhas) {
        candidatos.push({
          valor: candidato,
          origem: "duas-linhas",
          linha: index + 1,
          textoLinha: `${linhaAtual.original} ${proximaLinha.original}`
        });
      }
    }
  }

  const candidatosUnicos = new Map();

  for (const candidato of candidatos) {
    if (!candidatosUnicos.has(candidato.valor)) {
      candidatosUnicos.set(candidato.valor, candidato);
    }
  }

  return [...candidatosUnicos.values()];
}

function candidatoPareceE2E(candidato) {
  if (!candidato) return false;

  const comecaComEouD = candidato.startsWith("E") || candidato.startsWith("D");
  const tamanhoValido = candidato.length >= 29 && candidato.length <= 33;
  const formatoPix = /^[ED]\d{8}\d{8}[A-Za-z0-9]+$/.test(candidato);
  const temNumeros = /\d/.test(candidato);
  const temLetras = /[A-Za-z]/.test(candidato);

  return comecaComEouD && tamanhoValido && formatoPix && temNumeros && temLetras;
}

function calcularPontuacaoFormato(candidato) {
  let pontos = 0;

  if (candidato.length >= 29 && candidato.length <= 33) {
    pontos += 8;
  }

  if (/^[ED]\d{8}/.test(candidato)) {
    pontos += 8;
  }

  if (/^[ED]\d{8}\d{8}/.test(candidato)) {
    pontos += 8;
  }

  return pontos;
}

function calcularPontuacaoContexto(textoCru, candidato, metadados) {
  const textoNormalizado = normalizarTexto(textoCru);
  const candidatoNormalizado = normalizarTexto(candidato);

  let pontos = 0;

  const indice = textoNormalizado.indexOf(candidatoNormalizado);

  if (indice !== -1) {
    const inicioJanela = Math.max(0, indice - 160);
    const fimJanela = Math.min(
      textoNormalizado.length,
      indice + candidatoNormalizado.length + 160
    );

    const janela = textoNormalizado.slice(inicioJanela, fimJanela);

    for (const palavra of PALAVRAS_CHAVE_E2E) {
      const palavraNormalizada = normalizarTexto(palavra);

      if (janela.includes(palavraNormalizada)) {
        pontos += 10;
      }
    }

    if (janela.includes("pix")) {
      pontos += 5;
    }

    if (janela.includes("transacao")) {
      pontos += 5;
    }

    if (janela.includes("comprovante")) {
      pontos += 3;
    }
  }

  if (metadados.origem === "linha") {
    pontos += 6;
  }

  if (metadados.origem === "duas-linhas") {
    pontos += 2;
  }

  pontos += calcularPontuacaoFormato(candidato);

  return pontos;
}

function extrairE2E(textoCru) {
  const candidatos = encontrarCandidatosE2E(textoCru)
    .filter((candidato) => candidatoPareceE2E(candidato.valor))
    .map((candidato) => ({
      valor: candidato.valor,
      pontuacao: calcularPontuacaoContexto(textoCru, candidato.valor, candidato),
      tamanho: candidato.valor.length,
      origem: candidato.origem,
      linha: candidato.linha,
      textoLinha: candidato.textoLinha
    }))
    .sort((a, b) => b.pontuacao - a.pontuacao);

  if (!candidatos.length) {
    return {
      e2e: null,
      metodo: "nenhum-candidato",
      candidatos: []
    };
  }

  const melhorCandidato = candidatos[0];

  if (melhorCandidato.pontuacao >= 20) {
    return {
      e2e: melhorCandidato.valor,
      metodo: "contexto",
      candidatos
    };
  }

  return {
    e2e: melhorCandidato.valor,
    metodo: "fallback-regex",
    candidatos
  };
}

module.exports = {
  E2E_REGEX,
  extrairE2E,
  encontrarCandidatosE2E,
  candidatoPareceE2E
};